import type { OctopodActivationRecord } from './octopod-activation-record'
import { OCTOPOD_ACTIVATION_TRANSACTION_SCHEMA_VERSION } from './octopod-activation-transaction-schema'
import type {
  OctopodActivateTransaction,
  OctopodRollbackTransaction
} from './octopod-activation-transaction'

export function createOctopodActivationTransaction(options: {
  transactionId: string
  candidateVersion: string
  appVersion?: string
  recordBefore: OctopodActivationRecord
  snapshotDirName: string
  now: Date
}): OctopodActivateTransaction {
  const timestamp = options.now.toISOString()
  return {
    schemaVersion: OCTOPOD_ACTIVATION_TRANSACTION_SCHEMA_VERSION,
    transactionId: options.transactionId,
    operation: 'activate',
    phase: 'prepared',
    startedAt: timestamp,
    updatedAt: timestamp,
    candidateVersion: options.candidateVersion,
    candidateAppVersion: options.appVersion ?? null,
    recordBefore: options.recordBefore,
    recordAfter: null,
    snapshot: { dirName: options.snapshotDirName, state: 'pending' }
  }
}

export function withOctopodActivationIncumbentStopped(
  transaction: OctopodActivateTransaction,
  now: Date
): OctopodActivateTransaction {
  return {
    ...transaction,
    phase: 'incumbent-stopped',
    updatedAt: now.toISOString()
  }
}

export function withOctopodActivationSnapshot(
  transaction: OctopodActivateTransaction,
  state: 'captured' | 'empty',
  now: Date
): OctopodActivateTransaction {
  return {
    ...transaction,
    phase: 'snapshot-captured',
    updatedAt: now.toISOString(),
    snapshot: { dirName: transaction.snapshot.dirName, state }
  }
}

export function withOctopodActivationCandidateReady(
  transaction: OctopodActivateTransaction,
  recordAfter: OctopodActivationRecord,
  now: Date
): OctopodActivateTransaction {
  return {
    ...transaction,
    phase: 'candidate-ready',
    updatedAt: now.toISOString(),
    recordAfter
  }
}

export function createOctopodRollbackTransaction(options: {
  transactionId: string
  incumbentVersion: string
  targetVersion: string
  recordBefore: OctopodActivationRecord
  recordAfter: OctopodActivationRecord
  rescueDirName: string
  now: Date
}): OctopodRollbackTransaction {
  const timestamp = options.now.toISOString()
  return {
    schemaVersion: OCTOPOD_ACTIVATION_TRANSACTION_SCHEMA_VERSION,
    transactionId: options.transactionId,
    operation: 'rollback',
    phase: 'prepared',
    startedAt: timestamp,
    updatedAt: timestamp,
    incumbentVersion: options.incumbentVersion,
    targetVersion: options.targetVersion,
    recordBefore: options.recordBefore,
    recordAfter: options.recordAfter,
    rescue: { dirName: options.rescueDirName, state: 'pending' }
  }
}

export function withOctopodRollbackPhase(
  transaction: OctopodRollbackTransaction,
  phase: 'incumbent-stopped' | 'rollback-state-restored' | 'target-ready',
  now: Date
): OctopodRollbackTransaction {
  return { ...transaction, phase, updatedAt: now.toISOString() }
}

export function withOctopodRollbackRescue(
  transaction: OctopodRollbackTransaction,
  state: 'captured' | 'empty',
  now: Date
): OctopodRollbackTransaction {
  return {
    ...transaction,
    phase: 'rescue-captured',
    updatedAt: now.toISOString(),
    rescue: { dirName: transaction.rescue.dirName, state }
  }
}
