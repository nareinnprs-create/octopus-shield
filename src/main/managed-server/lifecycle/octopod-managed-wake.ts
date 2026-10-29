// Octopod exit does not prove terminal exit: the terminal daemon can outlive the server.
import { OCTOPOD_FENCE_OWNER_FILENAME } from '../activation/octopod-activation-fence-scope'
import type { ServeReadiness } from '../../server/serve-readiness'
import { readOctopodActivationRecord } from '../activation/octopod-activation-record-store'
import { randomUUID } from 'node:crypto'
import {
  octopodActivationFenceExists,
  releaseOctopodActivationFence,
  withOctopodActivationLock
} from '../activation/octopod-activation-lock'
import { octopodLivenessProvenExited } from '../install/octopod-remote-launch'
import { readBoundedOctopodRemoteRecord } from '../install/octopod-remote-record-file'
import { octopodActivationFenceLockDir } from '../activation/octopod-activation-transaction'
import { joinRemotePath } from '../../ssh/ssh-remote-platform'

import { readOctopodActivationTransaction } from '../activation/octopod-activation-transaction-store'
import {
  OCTOPOD_RECOVERY_UNVERIFIABLE_CODE,
  recoverInterruptedOctopodActivation
} from '../activation/octopod-activation-recovery'
import {
  ensureOctopodSlotServing,
  octopodSlotDir,
  resolveOctopodSlotIdentity,
  slotLiveness,
  type OctopodSlotOptions
} from '../../ssh/octopod-recovery-slot'

type OctopodManagedWake =
  | { outcome: 'serving' | 'not-activated' | 'unverifiable' }
  | { outcome: 'fenced' }
  | { outcome: 'started'; readiness: ServeReadiness }
  | { outcome: 'recovery-refused'; reason: string }

/** Start only proven-stopped active slots; leave live or unverifiable processes alone. */
export function wakeStoppedManagedOctopod(
  options: OctopodSlotOptions,
  onStarting: () => void = () => {}
): Promise<OctopodManagedWake> {
  const host = wakeHostKey(options)
  // Serialize per host before remote work so reconnect cannot race an earlier wake's unexplained fence.
  const prior = runningWakes.get(host)
  const wake = (async (): Promise<OctopodManagedWake> => {
    await prior?.catch(() => {})
    return wakeAfterPrior(options, host, onStarting)
  })()
  runningWakes.set(host, wake)
  void wake
    .catch(() => {})
    .finally(() => {
      if (runningWakes.get(host) === wake) {
        runningWakes.delete(host)
      }
    })
  return wake
}

async function wakeAfterPrior(
  options: OctopodSlotOptions,
  host: string,
  onStarting: () => void
): Promise<OctopodManagedWake> {
  const before = await readOctopodActivationRecord(options)
  if (!before.active) {
    return { outcome: 'not-activated' }
  }
  const liveness = await slotLiveness(options, octopodSlotDir(options, before.active))
  if (!octopodLivenessProvenExited(liveness)) {
    return { outcome: liveness === 'LIVE' ? 'serving' : 'unverifiable' }
  }
  if (!(await octopodActivationFenceExists(options))) {
    interruptedWakes.delete(host)
  } else if (!(await releaseOwnInterruptedWakeFence(options, host))) {
    const recovered = await recoverAbandonedFence(options, onStarting)
    if (recovered) {
      return recovered
    }
  }
  // Record ownership before acquisition: dropped replies can leave fences only this token can reclaim.
  const token = randomUUID()
  interruptedWakes.set(host, token)
  const result = await withOctopodActivationLock(
    options,
    async (): Promise<OctopodManagedWake> => {
      // Other clients may change the active slot; reread under the fence.
      const active = (await readOctopodActivationRecord(options)).active
      if (!active) {
        return { outcome: 'not-activated' }
      }
      const identity = await resolveOctopodSlotIdentity(options, active)
      onStarting()
      return { outcome: 'started', readiness: await ensureOctopodSlotServing(options, identity) }
    },
    (): OctopodManagedWake => ({ outcome: 'fenced' }),
    token
  )
  if (interruptedWakes.get(host) === token) {
    interruptedWakes.delete(host)
  }
  return result
}

/** Recover abandoned journals under stale, previous-boot or proven-exited fences; busy runs retain ownership. */
async function recoverAbandonedFence(
  options: OctopodSlotOptions,
  onStarting: () => void
): Promise<OctopodManagedWake | null> {
  const recovery = await recoverInterruptedOctopodActivation(options)
  switch (recovery.outcome) {
    case 'none':
      return null
    case 'pending':
      return { outcome: 'fenced' }
    case 'refused':
      // Retry unverifiable recovery at the next fence check, as with a busy owner.
      return recovery.code === OCTOPOD_RECOVERY_UNVERIFIABLE_CODE
        ? { outcome: 'fenced' }
        : { outcome: 'recovery-refused', reason: recovery.reason }
    case 'recovered':
      if (!recovery.readiness) {
        return { outcome: 'not-activated' }
      }
      onStarting()
      return { outcome: 'started', readiness: recovery.readiness }
  }
}

const runningWakes = new Map<string, Promise<OctopodManagedWake>>()

const interruptedWakes = new Map<string, string>()

function wakeOwnerPath(options: OctopodSlotOptions): string {
  return joinRemotePath(
    options.host,
    octopodActivationFenceLockDir(options.host, options.remoteHome),
    OCTOPOD_FENCE_OWNER_FILENAME
  )
}

function wakeHostKey(options: OctopodSlotOptions): string {
  return `${options.conn.getTarget().id}\0${options.remoteHome}`
}

/** Reclaim only this client's journal-free interrupted fence after proving slot exit. */
async function releaseOwnInterruptedWakeFence(
  options: OctopodSlotOptions,
  host: string
): Promise<boolean> {
  const token = interruptedWakes.get(host)
  if (!token || (await readOctopodActivationTransaction(options))) {
    return false
  }
  // A new owner may not have written its token yet; absence cannot prove this fence ours.
  const owner = await readBoundedOctopodRemoteRecord(options, wakeOwnerPath(options), 64)
  if (owner.state !== 'present' || owner.raw.trim() !== token) {
    interruptedWakes.delete(host)
    return false
  }
  await releaseOctopodActivationFence(options, token)
  interruptedWakes.delete(host)
  return true
}
