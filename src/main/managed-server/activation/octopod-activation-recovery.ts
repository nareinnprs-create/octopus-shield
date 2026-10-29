// Reconcile interrupted transactions to the recorded slot and state; retain the fence whenever ownership remains unproven.
import type { ServeReadiness } from '../../server/serve-readiness'
import {
  planOctopodTransactionRecovery,
  type OctopodActivationTransaction
} from './octopod-activation-transaction'
import { readOctopodActivationTransaction } from './octopod-activation-transaction-store'
import {
  readOctopodActivationRecord,
  writeOctopodActivationRecord
} from './octopod-activation-record-store'
import {
  octopodActivationFenceExists,
  withStaleOctopodActivationRecoveryLock
} from './octopod-activation-lock'
import { RemoteInstallLockBusyError } from '../install/remote-install-lock'
import { ensureOctopodSlotServing, resolveOctopodSlotIdentity } from '../../ssh/octopod-recovery-slot'
import { reconcileOctopodDecommission } from '../lifecycle/octopod-decommission-recovery'
import {
  recoverOctopodIncumbent,
  type OctopodIncumbentRecoveryOptions
} from '../../ssh/octopod-incumbent-recovery'
import type { OctopodManagedRefusal } from '../../../shared/octopod-managed-runtime'
import { resumeInterruptedOctopodCandidate } from '../../ssh/octopod-interrupted-candidate-resume'
import { errorMessage } from '../../../shared/error-message'

export type OctopodActivationRecoveryResult =
  | { outcome: 'none' }
  | { outcome: 'pending'; code: string; reason: string }
  | {
      outcome: 'recovered'
      resolution: 'committed' | 'restored-incumbent'
      activeVersion: string | null
      readiness: ServeReadiness | null
    }
  | OctopodManagedRefusal

type OctopodActivationRecoveryOptions = OctopodIncumbentRecoveryOptions

export const OCTOPOD_RECOVERY_UNVERIFIABLE_CODE = 'octopod_recovery_unverifiable'

export async function recoverInterruptedOctopodActivation(
  options: OctopodActivationRecoveryOptions
): Promise<OctopodActivationRecoveryResult> {
  try {
    if (
      !(await readOctopodActivationTransaction(options)) &&
      !(await octopodActivationFenceExists(options))
    ) {
      return { outcome: 'none' }
    }
    return await withStaleOctopodActivationRecoveryLock(options, async (lock) => {
      const transaction = await readOctopodActivationTransaction(options)
      if (!transaction) {
        // Interrupted release can remove the journal before the fence; finishing release is enough.
        return { outcome: 'none' }
      }
      const result = await reconcileOctopodTransaction(options, transaction)
      if (result.outcome !== 'recovered') {
        lock.retain()
      }
      return result
    })
  } catch (error) {
    if (error instanceof RemoteInstallLockBusyError) {
      return {
        outcome: 'pending',
        code: 'octopod_recovery_transaction_still_fresh',
        reason:
          'The activation fence is held by a run that may still be working. Retry after the ' +
          'install lock recovery window.'
      }
    }
    return {
      outcome: 'refused',
      verdict: 'unverifiable',
      code: OCTOPOD_RECOVERY_UNVERIFIABLE_CODE,
      reason:
        `The interrupted activation could not be reconciled safely: ${errorMessage(error)} ` +
        'The host remains fenced.'
    }
  }
}

/** Requires a held fence; unverifiable steps throw to preserve it. */
async function reconcileOctopodTransaction(
  options: OctopodActivationRecoveryOptions,
  transaction: OctopodActivationTransaction
): Promise<OctopodActivationRecoveryResult> {
  const plan = planOctopodTransactionRecovery(transaction, await readOctopodActivationRecord(options))
  if (plan.action === 'refuse') {
    return { outcome: 'refused', verdict: 'unverifiable', code: plan.code, reason: plan.reason }
  }
  if (
    plan.action === 'confirm-decommissioned' ||
    plan.action === 'resume-stop' ||
    plan.action === 'keep-serving'
  ) {
    return reconcileOctopodDecommission(options, plan)
  }
  if (plan.action === 'finish-commit') {
    await writeOctopodActivationRecord(options, plan.record)
  }
  if (plan.action === 'stabilize-committed' || plan.action === 'finish-commit') {
    const activeVersion = plan.action === 'finish-commit' ? plan.record.active : plan.activeVersion
    if (!activeVersion) {
      throw new Error('The committed activation record has no active version.')
    }
    const identity = await resolveOctopodSlotIdentity(options, activeVersion)
    return {
      outcome: 'recovered',
      resolution: 'committed',
      activeVersion,
      readiness: await ensureOctopodSlotServing(options, identity)
    }
  }
  if (transaction.operation === 'activate' && plan.launchedVersion) {
    const readiness = await resumeInterruptedOctopodCandidate(options, transaction)
    if (readiness && 'outcome' in readiness) {
      return readiness
    }
    if (readiness) {
      return {
        outcome: 'recovered',
        resolution: 'committed',
        activeVersion: transaction.candidateVersion,
        readiness
      }
    }
  }
  const recovery = await recoverOctopodIncumbent(options, {
    transactionStartedAt: transaction.startedAt,
    launchedVersion: plan.launchedVersion,
    incumbent: plan.activeVersion
      ? await resolveOctopodSlotIdentity(options, plan.activeVersion)
      : null,
    restoreState: plan.restoreState,
    launchedFromState: plan.launchedFromState
  })
  return recovery.outcome === 'refused'
    ? recovery
    : {
        outcome: 'recovered',
        resolution: 'restored-incumbent',
        activeVersion: plan.activeVersion,
        readiness: recovery.readiness
      }
}
