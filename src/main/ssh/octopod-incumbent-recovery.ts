/** Restore changed state only after proven slot exit and operator consent: a launched RPC server may have created terminals the stopped host cannot census, making the snapshot stale. Use the same rule for failure and crash recovery. */
import { execOctopodStateMutation } from '../managed-server/host-state/octopod-state-mutation-exec'
import { octopodRemoteBaseDir } from '../managed-server/install/octopod-remote-windows-node'
import type { ServeReadiness } from '../server/serve-readiness'
import { RELAY_REMOTE_DIR } from './remote-exec/remote-frame-protocol'
import { OCTOPOD_STATE_SNAPSHOT_DIR } from '../managed-server/activation/octopod-activation-record'
import type { OctopodSnapshotVerdict } from '../managed-server/activation/octopod-activation-transaction'
import {
  clearOctopodStateSnapshotMembersCommand,
  compareOctopodStateSnapshotCommand,
  octopodSnapshotIsUnchanged,
  parseOctopodSnapshotRestore,
  restoreOctopodStateSnapshotCommand
} from '../managed-server/host-state/octopod-state-snapshot'
import { execOctopodRemote } from '../managed-server/install/octopod-remote-runtime-control'
import {
  ensureOctopodSlotServing,
  launchOctopodSlot,
  quiesceInterruptedOctopodSlot,
  type OctopodSlotIdentity,
  type OctopodSlotOptions
} from './octopod-recovery-slot'
import { joinRemotePath } from './ssh-remote-platform'
import { OCTOPOD_RECOVERY_CHANGED_STATE_CODE } from '../../shared/octopod-managed-runtime'

export type OctopodIncumbentRecoveryOptions = OctopodSlotOptions & {
  /** The operator accepted restoring the snapshot over state a launched build changed. */
  acceptChangedState?: boolean
}

type OctopodIncumbentRecovery =
  | { outcome: 'restored'; readiness: ServeReadiness | null }
  | { outcome: 'refused'; verdict: 'live' | 'unverifiable'; code: string; reason: string }

export function octopodSnapshotPath(options: OctopodSlotOptions, dirName: string): string {
  return joinRemotePath(
    options.host,
    options.remoteHome,
    RELAY_REMOTE_DIR,
    OCTOPOD_STATE_SNAPSHOT_DIR,
    dirName
  )
}

/** Unverifiable steps throw so the caller retains the fence. */
export async function recoverOctopodIncumbent(
  options: OctopodIncumbentRecoveryOptions,
  input: {
    transactionStartedAt: string
    launchedVersion: string | null
    incumbent: OctopodSlotIdentity | null
    restoreState: OctopodSnapshotVerdict | null
    /** Rollback may restore a different snapshot from the launched slot's starting state. */
    launchedFromState?: OctopodSnapshotVerdict | null
    /** This run itself proved both slots exited, so no fresh liveness probe is needed. */
    slotsProvenExited?: boolean
  }
): Promise<OctopodIncumbentRecovery> {
  const quiescence =
    input.slotsProvenExited || !input.restoreState
      ? 'exited'
      : await quiesceInterruptedOctopodSlot(options, input.launchedVersion, input.incumbent)
  // With no incumbent there is no older reader to protect; the record names nothing to serve.
  if (quiescence === 'exited' && input.restoreState && input.incumbent) {
    const decision = input.launchedVersion
      ? await decideChangedStateRestore(options, input.launchedFromState ?? input.restoreState)
      : 'restore'
    if (decision !== 'restore' && decision !== 'unchanged') {
      return decision
    }
    // A launched slot that left its starting state untouched still sits on a root to replace.
    if (decision === 'restore' || input.launchedFromState) {
      await restoreState(options, input.restoreState)
    }
  }
  if (!input.incumbent) {
    return { outcome: 'restored', readiness: null }
  }
  return {
    outcome: 'restored',
    readiness: input.slotsProvenExited
      ? await launchOctopodSlot(options, input.incumbent)
      : await ensureOctopodSlotServing(options, input.incumbent)
  }
}

async function decideChangedStateRestore(
  options: OctopodIncumbentRecoveryOptions,
  state: OctopodSnapshotVerdict
): Promise<'unchanged' | 'restore' | Extract<OctopodIncumbentRecovery, { outcome: 'refused' }>> {
  if (state.state === 'captured') {
    const snapshotDir = octopodSnapshotPath(options, state.dirName)
    // A lost read-only comparison can conservatively mean changed.
    const comparison = await execOctopodRemote(
      options,
      compareOctopodStateSnapshotCommand(
        options.host,
        options.userDataDir,
        snapshotDir,
        octopodRemoteBaseDir(options.host, options.remoteHome)
      )
    ).catch(() => '')
    if (octopodSnapshotIsUnchanged(comparison)) {
      return 'unchanged'
    }
  }
  if (options.acceptChangedState) {
    return 'restore'
  }
  const retained =
    state.state === 'captured' ? ` at ${octopodSnapshotPath(options, state.dirName)}` : ''
  return {
    outcome: 'refused',
    verdict: 'unverifiable',
    code: OCTOPOD_RECOVERY_CHANGED_STATE_CODE,
    reason:
      'The launched build is stopped, but it changed profile state (or the change could not be ' +
      'checked), so the previous build was not restarted against it and this host serves ' +
      'nothing. Recover to restore the prelaunch snapshot' +
      `${retained} and restart the previous build; terminals the launched build started keep ` +
      'running but drop out of the restored state.'
  }
}

async function restoreState(options: OctopodSlotOptions, state: OctopodSnapshotVerdict): Promise<void> {
  if (state.state === 'pending') {
    throw new Error('The interrupted transaction has no durable snapshot verdict.')
  }
  const command =
    state.state === 'captured'
      ? restoreOctopodStateSnapshotCommand(
          options.host,
          options.userDataDir,
          octopodSnapshotPath(options, state.dirName),
          octopodRemoteBaseDir(options.host, options.remoteHome)
        )
      : clearOctopodStateSnapshotMembersCommand(
          options.host,
          options.userDataDir,
          octopodRemoteBaseDir(options.host, options.remoteHome)
        )
  const restored = parseOctopodSnapshotRestore(await execOctopodStateMutation(options, command))
  if (restored !== 'restored') {
    throw new Error(`The prelaunch state could not be restored (${restored}).`)
  }
}
