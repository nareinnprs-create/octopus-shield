import {
  isRetainedOctopodMigrationSourceCutover,
  type OctopodMigrationSourceCutover
} from '../../../shared/octopod-migration/octopod-migration-source-cutover'
import {
  getOctopodSshDeployment,
  type KnownRuntimeEnvironment
} from '../../../shared/runtime-environments'
import { listOctopodMigrationSourceCutovers } from '../../ssh/octopod-migration-cutover-journal'

type OctopodManagedPendingMigration = {
  migrationId: string
  environmentId: string
  name: string
  sshTargetId: string
  phase: OctopodMigrationSourceCutover['phase']
  startedAt: string
}

/** Unreadable journals must not look like absent migrations. */
export function listPendingManagedOctopodMigrations(
  userDataPath: string
): OctopodManagedPendingMigration[] {
  return (
    listOctopodMigrationSourceCutovers(userDataPath)
      // Committed/retained journals preserve downgrade recovery, not pending migration work.
      .filter(
        (cutover) =>
          cutover.phase !== 'source-retired' && !isRetainedOctopodMigrationSourceCutover(cutover)
      )
      .map((cutover) => ({
        migrationId: cutover.migrationId,
        environmentId: cutover.destinationEnvironmentId,
        name: cutover.destinationName,
        sshTargetId: cutover.sshTargetId,
        phase: cutover.phase,
        startedAt: cutover.startedAt
      }))
  )
}

export function findIncompleteManagedOctopodMigration(
  userDataPath: string,
  environmentId: string
): OctopodManagedPendingMigration | null {
  return (
    listPendingManagedOctopodMigrations(userDataPath).find(
      (migration) => migration.environmentId === environmentId
    ) ?? null
  )
}

export function environmentMatchesManagedOctopodCutover(
  environment: KnownRuntimeEnvironment,
  cutover: OctopodMigrationSourceCutover
): boolean {
  const deployment = getOctopodSshDeployment(environment)
  return (
    environment.id === cutover.destinationEnvironmentId &&
    environment.name === cutover.destinationName &&
    deployment?.sshTargetId === cutover.sshTargetId &&
    deployment.sshTargetGeneration === cutover.sshTargetGeneration
  )
}
