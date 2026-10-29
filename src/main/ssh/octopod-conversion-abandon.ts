/** Registered destinations must abort/prove empty, then unregister before fence release so later starts cannot reclaim the host. Never-registered destinations held nothing. */
import { removeManagedOctopodEnvironment } from '../../shared/runtime-environment-managed-octopod-store'
import { listEnvironments } from '../../shared/runtime-environment-store'
import type { KnownRuntimeEnvironment } from '../../shared/runtime-environments'
import { closeOctopodManagedTunnel } from '../managed-server/lifecycle/octopod-managed-tunnel'
import {
  abortOctopodMigrationCutover,
  type OctopodMigrationAbortResult,
  type OctopodMigrationCutoverContext,
  type OctopodMigrationDestinationCatalog
} from './octopod-migration-cutover-coordinator'
import { findOctopodMigrationSourceCutoverForTarget } from './octopod-migration-cutover-journal'
import {
  releaseOctopodMigrationFence,
  releaseUndeployedMigrationFence
} from './octopod-migration-source-fence'

export async function abandonOctopodConversion(args: {
  userDataPath: string
  store: OctopodMigrationCutoverContext['store']
  claims: OctopodMigrationCutoverContext['claims']
  targetId: string
  destinationFor: (environment: KnownRuntimeEnvironment) => OctopodMigrationDestinationCatalog
}): Promise<OctopodMigrationAbortResult | 'none'> {
  const cutover = findOctopodMigrationSourceCutoverForTarget(args.userDataPath, args.targetId)
  // Committed delta chains resolve only through the delta flow.
  if (!cutover || cutover.supersedesMigrationId) {
    return 'none'
  }
  const isRegistered = (id: string): boolean =>
    listEnvironments(args.userDataPath).some((entry) => entry.id === id)
  const environment = listEnvironments(args.userDataPath).find(
    (entry) => entry.id === cutover.destinationEnvironmentId
  )
  if (!environment) {
    await releaseUndeployedMigrationFence({ ...args, isDestinationRegistered: isRegistered })
    return 'none'
  }
  const context = { ...args, destination: args.destinationFor(environment) }
  return abortOctopodMigrationCutover(context, cutover.migrationId, async (aborted) => {
    await closeOctopodManagedTunnel(environment.id).catch(() => undefined)
    removeManagedOctopodEnvironment(args.userDataPath, environment.id)
    await releaseOctopodMigrationFence(context, aborted)
  })
}
