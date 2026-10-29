import type { OctopodManagedRuntimeStatus } from '../../../shared/octopod-managed-runtime'
import { runTargetLifecycle } from '../../ipc/ssh/ssh-target-lifecycle-queue'
import type { OctopodActivationTransaction } from '../activation/octopod-activation-transaction'
import { readOctopodActivationTransaction } from '../activation/octopod-activation-transaction-store'
import {
  requireManagedOctopodEnvironment,
  resolveLinkedOctopodContext
} from './octopod-managed-runtime-context'
import { currentManagedOctopodUpdateDeferral } from './octopod-managed-update-deferrals'
import { findIncompleteManagedOctopodMigration } from './octopod-managed-migration-status'
import { collectManagedTerminalCensus } from '../../ssh/octopod-terminal-census-client'
import { getAppEnvironment } from '../../../shared/app-environment'
import { bundledManagedOctopodVersion } from './octopod-managed-auto-update'
import { availableManagedOctopodUpdate } from './octopod-managed-update-decision'

/** Read host records without repairing them. */
export async function getManagedOctopodRuntimeStatus(
  userDataPath: string,
  selector: string,
  signal?: AbortSignal
): Promise<OctopodManagedRuntimeStatus> {
  const { environment, deployment } = requireManagedOctopodEnvironment(userDataPath, selector)
  const { status, record, serverTarget } = await runTargetLifecycle(
    deployment.sshTargetId,
    async () => {
      const context = await resolveLinkedOctopodContext(environment, deployment, signal)
      const record = context.activationRecord
      const transaction = await readOctopodActivationTransaction({
        conn: context.connection,
        host: context.host,
        remoteHome: context.remoteHome,
        signal
      })
      const status: OctopodManagedRuntimeStatus = {
        environmentId: environment.id,
        sshTargetId: context.target.id,
        activeVersion: record.active,
        activeAppVersion: record.active ? (record.activeAppVersion ?? null) : null,
        previousVersion: record.previous,
        activatedAt: record.activatedAt,
        rollbackAvailable: Boolean(record.previous && record.snapshot),
        recovery: transaction ? managedRecoveryStatus(transaction) : null,
        terminals: await collectManagedTerminalCensus(userDataPath, environment, record),
        migration: migrationStatus(userDataPath, environment.id),
        deferredUpdate: currentManagedOctopodUpdateDeferral(environment.id, record.active)
      }
      return { status, record, serverTarget: context.serverTarget }
    }
  )
  // Outside the host queue: hashing the local template must not hold up host actions.
  // A local template fault hides only the offer, never the host's status.
  const candidateVersion = await bundledManagedOctopodVersion(serverTarget).catch(() => null)
  return {
    ...status,
    availableUpdate: availableManagedOctopodUpdate({
      record,
      candidateVersion,
      appVersion: getAppEnvironment().getVersion(),
      deferredCandidateVersion: status.deferredUpdate?.candidateVersion ?? null
    })
  }
}

function managedRecoveryStatus(
  transaction: OctopodActivationTransaction
): NonNullable<OctopodManagedRuntimeStatus['recovery']> {
  switch (transaction.operation) {
    case 'activate':
      return {
        operation: transaction.operation,
        phase: transaction.phase,
        version: transaction.candidateVersion,
        startedAt: transaction.startedAt
      }
    case 'rollback':
      return {
        operation: transaction.operation,
        phase: transaction.phase,
        version: transaction.targetVersion,
        startedAt: transaction.startedAt
      }
    case 'decommission':
      return {
        operation: transaction.operation,
        phase: transaction.phase,
        version: transaction.activeVersion,
        startedAt: transaction.startedAt
      }
  }
}

function migrationStatus(
  userDataPath: string,
  environmentId: string
): OctopodManagedRuntimeStatus['migration'] {
  const migration = findIncompleteManagedOctopodMigration(userDataPath, environmentId)
  return migration
    ? { migrationId: migration.migrationId, phase: migration.phase, startedAt: migration.startedAt }
    : null
}
