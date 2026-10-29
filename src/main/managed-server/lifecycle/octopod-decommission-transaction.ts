// Only process-exited may commit; dispatched phases nest under prepared for released readers.
import {
  serializeOctopodActivationRecord,
  withDeactivatedVersion,
  withDeactivatedVersionCommitted,
  type OctopodActivationRecord
} from '../activation/octopod-activation-record'
import { OCTOPOD_ACTIVATION_TRANSACTION_SCHEMA_VERSION } from '../activation/octopod-activation-transaction-schema'
import type { OctopodManagedStopRequest } from '../../../shared/octopod-stop-request'

export type OctopodDecommissionTransaction = {
  schemaVersion: typeof OCTOPOD_ACTIVATION_TRANSACTION_SCHEMA_VERSION
  transactionId: string
  operation: 'decommission'
  phase: 'prepared' | 'stop-dispatched' | 'process-exited'
  startedAt: string
  updatedAt: string
  activeVersion: string
  recordBefore: OctopodActivationRecord
  recordAfter: OctopodActivationRecord
  request: OctopodManagedStopRequest | null
}

/** Released desktops drop this field. */
type OctopodDecommissionDispatch = {
  phase: 'stop-dispatched' | 'process-exited'
  request: OctopodManagedStopRequest
}

type OctopodDecommissionJournal = Omit<OctopodDecommissionTransaction, 'phase' | 'request'> & {
  phase: 'prepared'
  request: null
  dispatched?: OctopodDecommissionDispatch
}

export type OctopodDecommissionRecoveryPlan =
  | { action: 'confirm-decommissioned'; version: string; record: OctopodActivationRecord | null }
  /** Completion or cancellation must settle a possibly delivered request. */
  | { action: 'resume-stop'; request: OctopodManagedStopRequest; record: OctopodActivationRecord }
  | { action: 'keep-serving'; version: string }

export function createOctopodDecommissionTransaction(options: {
  transactionId: string
  recordBefore: OctopodActivationRecord & { active: string }
  now: Date
}): OctopodDecommissionTransaction {
  const timestamp = options.now.toISOString()
  return {
    schemaVersion: OCTOPOD_ACTIVATION_TRANSACTION_SCHEMA_VERSION,
    transactionId: options.transactionId,
    operation: 'decommission',
    phase: 'prepared',
    startedAt: timestamp,
    updatedAt: timestamp,
    activeVersion: options.recordBefore.active,
    recordBefore: options.recordBefore,
    recordAfter: withDeactivatedVersion(options.recordBefore),
    request: null
  }
}

export function withOctopodDecommissionStopDispatched(
  transaction: OctopodDecommissionTransaction,
  request: OctopodManagedStopRequest,
  now: Date
): OctopodDecommissionTransaction {
  return { ...transaction, phase: 'stop-dispatched', updatedAt: now.toISOString(), request }
}

export function withOctopodDecommissionProcessExited(
  transaction: OctopodDecommissionTransaction,
  now: Date
): OctopodDecommissionTransaction {
  return { ...transaction, phase: 'process-exited', updatedAt: now.toISOString() }
}

/** Keep top-level prepared so released readers relaunch the recorded build instead of downgrading.
 * Their parser drops dispatched; their completed-stop path loses activeAppVersion protection. */
export function octopodDecommissionJournal(
  transaction: OctopodDecommissionTransaction
): OctopodDecommissionJournal {
  const { phase, request, ...rest } = transaction
  return phase === 'prepared' || !request
    ? { ...rest, phase: 'prepared', request: null }
    : { ...rest, phase: 'prepared', request: null, dispatched: { phase, request } }
}

export function octopodDecommissionTransactionDefect(
  transaction: OctopodDecommissionTransaction
): string | null {
  if (transaction.recordBefore.active !== transaction.activeVersion) {
    return 'decommission version does not match recordBefore'
  }
  if (
    serializeOctopodActivationRecord(transaction.recordAfter) !==
    serializeOctopodActivationRecord(withDeactivatedVersion(transaction.recordBefore))
  ) {
    return 'recordAfter is not the deactivated recordBefore'
  }
  if (transaction.request && transaction.request.version !== transaction.activeVersion) {
    return 'stop request names another version'
  }
  return null
}

export function planOctopodDecommissionRecovery(
  transaction: OctopodDecommissionTransaction,
  committed: boolean
): OctopodDecommissionRecoveryPlan {
  if (committed) {
    return { action: 'confirm-decommissioned', version: transaction.activeVersion, record: null }
  }
  if (transaction.phase === 'process-exited') {
    return {
      action: 'confirm-decommissioned',
      version: transaction.activeVersion,
      record: committedOctopodDecommissionRecord(transaction)
    }
  }
  if (transaction.phase === 'stop-dispatched' && transaction.request) {
    return {
      action: 'resume-stop',
      request: transaction.request,
      record: committedOctopodDecommissionRecord(transaction)
    }
  }
  return { action: 'keep-serving', version: transaction.activeVersion }
}

/** Preserve advisory fields alongside the journaled recordAfter. */
export function committedOctopodDecommissionRecord(
  transaction: OctopodDecommissionTransaction
): OctopodActivationRecord {
  return withDeactivatedVersionCommitted(transaction.recordBefore)
}
