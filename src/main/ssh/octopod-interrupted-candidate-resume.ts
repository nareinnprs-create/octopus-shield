/** Resume through the original readiness gate before undoing: the candidate may already serve changed state, and stopping it could require operator consent before anything can serve again. */
import type { ServeReadiness } from '../server/serve-readiness'
import { withActivatedVersion } from '../managed-server/activation/octopod-activation-record'
import { writeOctopodActivationRecord } from '../managed-server/activation/octopod-activation-record-store'
import type { OctopodActivateTransaction } from '../managed-server/activation/octopod-activation-transaction'
import { writeOctopodActivationTransaction } from '../managed-server/activation/octopod-activation-transaction-store'
import { withOctopodActivationCandidateReady } from '../managed-server/activation/octopod-activation-transaction-transitions'
import { OctopodActiveReadinessError } from './octopod-active-readiness'
import { octopodLivenessProvenExited } from '../managed-server/install/octopod-remote-launch'
import {
  OCTOPOD_RECOVERY_CHANGED_STATE_CODE,
  type OctopodManagedRefusal
} from '../../shared/octopod-managed-runtime'
import {
  ensureOctopodSlotServing,
  octopodSlotDir,
  resolveOctopodSlotIdentity,
  slotLiveness
} from './octopod-recovery-slot'
import type { OctopodIncumbentRecoveryOptions } from './octopod-incumbent-recovery'

/** Under the held fence, return null for undo; a refusal leaves the host untouched for an operator. */
export async function resumeInterruptedOctopodCandidate(
  options: OctopodIncumbentRecoveryOptions,
  transaction: OctopodActivateTransaction
): Promise<ServeReadiness | OctopodManagedRefusal | null> {
  const snapshotState = transaction.snapshot.state
  const incumbent = transaction.recordBefore.active
  if (
    transaction.phase !== 'snapshot-captured' ||
    snapshotState === 'pending' ||
    // A serving incumbent holds the port and instance lock; undo keeps it.
    (incumbent !== null &&
      !octopodLivenessProvenExited(await slotLiveness(options, octopodSlotDir(options, incumbent))))
  ) {
    return null
  }
  const candidate = await resolveOctopodSlotIdentity(options, transaction.candidateVersion)
  const candidateLiveness = await slotLiveness(options, candidate.remoteDir)
  // Old journals lack candidate app version, so commit would drop downgrade protection; undo a possibly serving candidate only with consent.
  if (transaction.candidateAppVersion === undefined) {
    if (octopodLivenessProvenExited(candidateLiveness) || options.acceptChangedState) {
      return null
    }
    if (candidateLiveness === 'UNKNOWN') {
      throw new Error(`Could not tell whether octopod ${transaction.candidateVersion} is running.`)
    }
    return {
      outcome: 'refused',
      verdict: 'live',
      code: OCTOPOD_RECOVERY_CHANGED_STATE_CODE,
      reason:
        `An older Shield left version ${transaction.candidateVersion} running without finishing ` +
        'its update, and did not record which app started it, so it was neither committed nor ' +
        'stopped. Recover to stop it, restore the prelaunch snapshot and restart the previous ' +
        'build; what it changed is discarded.'
    }
  }
  // Undo must rule out an unprovable candidate before starting another slot.
  if (candidateLiveness === 'UNKNOWN') {
    return null
  }
  let readiness: ServeReadiness
  try {
    readiness = await ensureOctopodSlotServing(options, candidate)
  } catch (error) {
    // Only candidate evidence permits undo; unanswered hosts retain the fence.
    if (error instanceof OctopodActiveReadinessError && error.verdict !== 'unverifiable') {
      return null
    }
    throw error
  }
  const now = new Date()
  const recordAfter = withActivatedVersion(
    transaction.recordBefore,
    transaction.candidateVersion,
    snapshotState === 'captured'
      ? {
          dirName: transaction.snapshot.dirName,
          takenBeforeVersion: transaction.candidateVersion,
          readableByVersion: incumbent,
          takenAt: transaction.startedAt
        }
      : null,
    now,
    transaction.candidateAppVersion ?? undefined
  )
  await writeOctopodActivationTransaction(
    options,
    withOctopodActivationCandidateReady(transaction, recordAfter, now)
  )
  await writeOctopodActivationRecord(options, recordAfter)
  return readiness
}
