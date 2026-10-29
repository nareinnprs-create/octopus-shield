// Offer "Move anyway" only when a consent-free preview shows it clears the blockers.
import type { StoreRuntimeState } from '../loading-store/store-runtime-state'
import { collectOctopodMigrationUntransferredDependencyCensus } from './octopod-source-dependency-census'
import { collectOctopodMigrationSourceDormantState } from './octopod-source-dormant-state'
import type { OctopodMigrationDeltaView } from './octopod-source-delta-view'

export function createOctopodMigrationLeaveBehindView(
  runtime: Pick<StoreRuntimeState, 'state' | 'terminalScrollbackSnapshotStorage'>,
  targetId: string
): OctopodMigrationDeltaView {
  // Read-only collectors make a shallow copy sufficient.
  const state = {
    ...runtime.state,
    sshTargets: runtime.state.sshTargets.map((target) =>
      target.id === targetId
        ? { ...target, managedServerLeaveBehind: { confirmedAt: new Date(0).toISOString() } }
        : target
    )
  }
  const storage = runtime.terminalScrollbackSnapshotStorage
  return {
    getRepos: () => state.repos,
    getFolderWorkspaces: () => state.folderWorkspaces,
    getProjectGroups: () => state.projectGroups,
    collectOctopodMigrationSourceDormantState: (source, catalog, destinationEnvironmentId) =>
      collectOctopodMigrationSourceDormantState(
        state,
        source,
        catalog,
        storage,
        destinationEnvironmentId
      ).payload,
    inspectOctopodMigrationUntransferredDependencies: (manifest) =>
      collectOctopodMigrationUntransferredDependencyCensus(state, manifest, storage)
  }
}
