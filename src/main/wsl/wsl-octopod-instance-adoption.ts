/** Adopt serving unrecorded octopod under the activation fence only when lock, readiness and installed build identify the same process. Never kill it without census; launching another loses the instance lock. Normal update admission handles version changes. */
import {
  OCTOPOD_LOCK_FILE_NAME,
  parseOctopodInstanceLockRecord,
  type OctopodLockRecord
} from '../octopod/octopod-instance-lock'
import { compareOctopodProcessIdentity } from '../octopod/octopod-process-start-time'
import type { OctopodActivationRecord } from '../managed-server/activation/octopod-activation-record'
import {
  readOctopodActivationRecord,
  writeOctopodActivationRecord
} from '../managed-server/activation/octopod-activation-record-store'
import { evaluateOctopodActivation } from '../managed-server/activation/octopod-activation-gate'
import { withOctopodActivationLock } from '../managed-server/activation/octopod-activation-lock'
import { sameOctopodActivationRecord } from '../managed-server/activation/octopod-activation-transaction'
import { readOctopodActivationTransaction } from '../managed-server/activation/octopod-activation-transaction-store'
import { readRemoteOctopodManagedStopTarget } from '../managed-server/lifecycle/octopod-managed-remote-stop'
import {
  octopodSlotDir,
  resolveOctopodSlotIdentity,
  type OctopodSlotOptions
} from '../ssh/octopod-recovery-slot'
import { OCTOPOD_PID_FILENAME } from '../managed-server/install/octopod-remote-host-support'
import {
  parseOctopodReadinessWaitOutput,
  readOctopodReadinessNowCommand
} from '../managed-server/install/octopod-remote-readiness-wait'
import { readBoundedOctopodRemoteRecord } from '../managed-server/install/octopod-remote-record-file'
import { execOctopodRemote } from '../managed-server/install/octopod-remote-runtime-control'
import {
  OCTOPOD_INSTALL_MODEL,
  remoteInstallDirName,
  remoteInstallVersionDirRegex
} from '../managed-server/install/remote-install-model'
import { quotePosixShell } from '../../shared/shell-argument-quoting'
import { joinRemotePath } from '../ssh/ssh-remote-platform'
import { readWslGuestIdentity, wslGuestOctopodIncarnation } from './wsl-guest-process-identity'

const LOCK_RECORD_MAX_BYTES = 64 * 1024
const UNRECORDED_OCTOPOD_CODE = 'wsl_octopod_unrecorded_instance_unverifiable'

export type WslOctopodAdoption =
  | { outcome: 'none' }
  | { outcome: 'adopted'; version: string; pid: number; record: OctopodActivationRecord }

export class WslOctopodUnrecordedInstanceError extends Error {
  readonly code = UNRECORDED_OCTOPOD_CODE
  constructor(message: string) {
    super(message)
    this.name = 'WslOctopodUnrecordedInstanceError'
  }
}

type LockHolder = { pid: number; version: string }

async function readLiveLockHolder(slot: OctopodSlotOptions): Promise<LockHolder | null> {
  const lockPath = joinRemotePath(slot.host, slot.userDataDir, OCTOPOD_LOCK_FILE_NAME)
  const read = await readBoundedOctopodRemoteRecord(slot, lockPath, LOCK_RECORD_MAX_BYTES)
  const lock = read.state === 'present' ? parseOctopodInstanceLockRecord(read.raw) : null
  // Desktop-role or malformed locks identify no octopod to adopt.
  if (!lock || lock.role === 'desktop') {
    return null
  }
  // Adopt only proven-live holders; otherwise let the host's instance lock arbitrate launch.
  return (await lockHolderLiveness(slot, lock)) === 'live'
    ? { pid: lock.pid, version: lock.version }
    : null
}

type LockHolderLiveness = 'live' | 'unverifiable' | 'exited'

/** A PID is no identity after a distro restart reuses it: the lock's boot id and start ticks are. */
async function lockHolderLiveness(
  slot: OctopodSlotOptions,
  lock: OctopodLockRecord
): Promise<LockHolderLiveness> {
  const guest = await readWslGuestIdentity(slot.conn, lock.pid)
  if (!guest) {
    return 'unverifiable'
  }
  const incarnation = wslGuestOctopodIncarnation(guest)
  // The guest answered, and no process has that PID.
  if (!incarnation) {
    return 'exited'
  }
  // Compare boot IDs case-insensitively because readers normalize them.
  const recorded = lock.bootId ? { ...lock, bootId: lock.bootId.toLowerCase() } : lock
  const verdict = compareOctopodProcessIdentity(lock.pid, recorded, {
    incarnation: () => incarnation,
    // Ignore wall-clock starts: guest clocks jump after host sleep.
    startedAtMs: () => null,
    platform: 'linux'
  })
  return verdict === 'matches' ? 'live' : verdict === 'differs' ? 'exited' : 'unverifiable'
}

async function readSlotPid(slot: OctopodSlotOptions, version: string): Promise<number | null> {
  const pidFile = joinRemotePath(slot.host, octopodSlotDir(slot, version), OCTOPOD_PID_FILENAME)
  const raw = await execOctopodRemote(slot, `cat ${quotePosixShell(pidFile)} 2>/dev/null || true`)
  const pid = Number.parseInt(raw.trim(), 10)
  return Number.isSafeInteger(pid) && pid > 0 ? pid : null
}

/** The holder's slot must publish readiness for this pid, from the build installed there. */
async function proveHolderServesItsSlot(slot: OctopodSlotOptions, holder: LockHolder): Promise<void> {
  const label = `An octopod (pid ${holder.pid}, ${holder.version}) is running in this distro but is not the recorded one`
  const dirName = remoteInstallDirName(OCTOPOD_INSTALL_MODEL, holder.version)
  if (!remoteInstallVersionDirRegex(OCTOPOD_INSTALL_MODEL).test(dirName)) {
    throw new WslOctopodUnrecordedInstanceError(`${label}, and its version is not a slot name.`)
  }
  const target = await readRemoteOctopodManagedStopTarget(slot, holder.version)
  if (target.state !== 'ready' || target.context.instance.pid !== holder.pid) {
    throw new WslOctopodUnrecordedInstanceError(
      `${label}, and it cannot be identified: ${target.state === 'refused' ? target.reason : 'its readiness names another process.'}`
    )
  }
  const identity = await resolveOctopodSlotIdentity(slot, holder.version)
  const readiness = parseOctopodReadinessWaitOutput(
    slot.host,
    await execOctopodRemote(slot, readOctopodReadinessNowCommand(slot.host, identity.remoteDir))
  )
  const verdict = evaluateOctopodActivation(
    readiness.state === 'ready' ? readiness.readiness : null,
    {
      buildHash: identity.buildHash,
      fullVersion: identity.version
    }
  )
  if (verdict.decision === 'reject') {
    throw new WslOctopodUnrecordedInstanceError(`${label}, and ${verdict.reason}`)
  }
}

function adoptedRecord(
  record: OctopodActivationRecord,
  version: string,
  now: Date
): OctopodActivationRecord {
  if (record.active === version) {
    return record
  }
  const { activeAppVersion, previousAppVersion: _previousAppVersion, ...rest } = record
  return {
    ...rest,
    active: version,
    previous: record.active ?? record.previous,
    ...(record.active && activeAppVersion ? { previousAppVersion: activeAppVersion } : {}),
    activatedAt: now.toISOString(),
    // Prelaunch snapshot belongs to another activation; rollback must not restore it.
    snapshot: null
  }
}

/** Adopt lock owners missing from record/pid file only with proof; otherwise refuse rather than launch into an occupied instance lock. */
export async function adoptUnrecordedWslOctopod(
  slot: OctopodSlotOptions,
  record: OctopodActivationRecord,
  now: () => Date = () => new Date()
): Promise<WslOctopodAdoption> {
  const holder = await readLiveLockHolder(slot)
  if (!holder) {
    return { outcome: 'none' }
  }
  if (
    record.active === holder.version &&
    (await readSlotPid(slot, holder.version)) === holder.pid
  ) {
    return { outcome: 'none' }
  }
  await proveHolderServesItsSlot(slot, holder)
  return withOctopodActivationLock(
    slot,
    async () => {
      const current = await readOctopodActivationRecord(slot)
      if (!sameOctopodActivationRecord(current, record)) {
        throw new WslOctopodUnrecordedInstanceError(
          'The activation record changed while an unrecorded octopod was being adopted. Retry.'
        )
      }
      if (await readOctopodActivationTransaction(slot)) {
        throw new WslOctopodUnrecordedInstanceError(
          'An interrupted activation is pending, so an unrecorded octopod cannot be adopted yet.'
        )
      }
      const again = await readLiveLockHolder(slot)
      if (again?.pid !== holder.pid || again.version !== holder.version) {
        throw new WslOctopodUnrecordedInstanceError(
          'The unrecorded octopod changed while it was being adopted. Retry.'
        )
      }
      const pidFile = joinRemotePath(
        slot.host,
        octopodSlotDir(slot, holder.version),
        OCTOPOD_PID_FILENAME
      )
      await execOctopodRemote(
        slot,
        `(umask 077 && printf '%s\\n' ${String(holder.pid)} > ${quotePosixShell(pidFile)})`
      )
      const next = adoptedRecord(current, holder.version, now())
      if (next !== current) {
        await writeOctopodActivationRecord(slot, next)
      }
      return {
        outcome: 'adopted' as const,
        version: holder.version,
        pid: holder.pid,
        record: next
      }
    },
    () => {
      throw new WslOctopodUnrecordedInstanceError(
        'Another Shield is changing this distro’s server, so an unrecorded octopod cannot be adopted now.'
      )
    }
  )
}
