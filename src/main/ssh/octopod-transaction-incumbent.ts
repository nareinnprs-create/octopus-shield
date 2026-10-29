import type { OctopodActivationLockControl } from '../managed-server/activation/octopod-activation-lock'
import type { OctopodSnapshotVerdict } from '../managed-server/activation/octopod-activation-transaction'
import { octopodStopFreedTheHost } from '../managed-server/install/octopod-remote-process-control'
import { withoutAbortSignal } from '../managed-server/install/octopod-remote-runtime-control'
import {
  launchOctopodSlot,
  stopOctopodSlot,
  OCTOPOD_SLOT_STOP_WAIT_SECONDS,
  type OctopodSlotIdentity,
  type OctopodSlotOptions
} from './octopod-recovery-slot'
import { recoverOctopodIncumbent } from './octopod-incumbent-recovery'
import { errorMessage } from '../../shared/error-message'

/** Return null on proven exit; otherwise retain the fence when a delivered stop may still change the host. */
export async function stopTransactionIncumbent(
  options: OctopodSlotOptions,
  incumbent: OctopodSlotIdentity,
  lock: OctopodActivationLockControl
): Promise<{ reason: string; stopMayBeUnderway: boolean } | null> {
  const stopped = await stopOctopodSlot(options, incumbent.remoteDir, false)
  if (octopodStopFreedTheHost(stopped)) {
    return null
  }
  // Only a stop that may have been delivered can still change the host; otherwise nothing happened.
  const stopMayBeUnderway = stopped === 'still-running' || stopped === 'unconfirmed'
  if (stopMayBeUnderway) {
    lock.retain()
  }
  return {
    reason:
      `Could not verify that octopod ${incumbent.version} exited within ` +
      `${OCTOPOD_SLOT_STOP_WAIT_SECONDS}s (${stopped}).`,
    stopMayBeUnderway
  }
}

export async function restartAfterSnapshotFailure(
  options: OctopodSlotOptions,
  incumbent: OctopodSlotIdentity,
  lock: OctopodActivationLockControl
): Promise<string> {
  try {
    await launchOctopodSlot(withoutAbortSignal(options), incumbent)
    lock.recovered()
    return `octopod ${incumbent.version} was restarted and is serving again.`
  } catch (error) {
    lock.retain()
    return `restarting octopod ${incumbent.version} failed: ${errorMessage(error)} This host requires recovery.`
  }
}

/** Restore changed state and incumbent only after both slots prove exit; refusal retains the fence. */
export async function putTransactionIncumbentBack(
  options: OctopodSlotOptions,
  lock: OctopodActivationLockControl,
  input: {
    transactionStartedAt: string
    launchedVersion: string | null
    incumbent: OctopodSlotIdentity | null
    restoreState: OctopodSnapshotVerdict | null
    launchedFromState?: OctopodSnapshotVerdict | null
  }
): Promise<string | null> {
  try {
    const recovery = await recoverOctopodIncumbent(withoutAbortSignal(options), {
      ...input,
      slotsProvenExited: true
    })
    if (recovery.outcome === 'refused') {
      lock.retain()
      return recovery.reason
    }
    lock.recovered()
    return null
  } catch (error) {
    lock.retain()
    return `Restoring the previous version failed: ${errorMessage(error)} This host requires recovery.`
  }
}

/** Stop the rejected candidate before safely restoring incumbent state. */
export async function restoreAfterRejectedCandidate(
  options: OctopodSlotOptions,
  lock: OctopodActivationLockControl,
  input: {
    launchedDir: string
    launchedVersion: string
    transactionStartedAt: string
    incumbent: OctopodSlotIdentity | null
    restoreState: OctopodSnapshotVerdict | null
    launchedFromState?: OctopodSnapshotVerdict | null
  }
): Promise<string> {
  const { launchedDir, ...restore } = input
  const stopped = await stopOctopodSlot(withoutAbortSignal(options), launchedDir, true).catch(
    (error: unknown) => `unverifiable: ${errorMessage(error)}`
  )
  if (stopped !== 'stopped' && stopped !== 'already-exited') {
    lock.retain()
    return (
      `octopod ${input.launchedVersion} could not be confirmed stopped (${stopped}), so nothing ` +
      'was restored over state it may still own. This host requires recovery.'
    )
  }
  const failure = await putTransactionIncumbentBack(options, lock, restore)
  return (
    failure ??
    (input.incumbent
      ? `octopod ${input.incumbent.version} was restarted and is serving again.`
      : 'No previous version was active, so this host is now serving nothing.')
  )
}
