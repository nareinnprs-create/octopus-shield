// Export only additions from older builds by subtracting prior migrations from a profile copy.
import type {
  OctopodMigrationCatalogPayload,
  OctopodMigrationDormantStatePayload,
  OctopodMigrationManifest,
  OctopodMigrationManifestSource
} from '../../../shared/octopod-migration/octopod-migration-manifest'
import type { FolderWorkspace } from '../../../shared/folder-workspace-types'
import type { ProjectGroup } from '../../../shared/project-group-types'
import type { Repo } from '../../../shared/repo-types'
import type { StoreRuntimeState } from '../loading-store/store-runtime-state'
import { subtractOctopodSourceCatalogState } from './octopod-source-catalog-subtraction'
import {
  collectOctopodMigrationUntransferredDependencyCensus,
  type OctopodMigrationSourceDependencyCensus
} from './octopod-source-dependency-census'
import { subtractOctopodMigrationSourceDormantState } from './octopod-source-dormant-subtraction'
import { collectOctopodMigrationSourceDormantState } from './octopod-source-dormant-state'
import { subtractOctopodMigrationScopeWorkspaceSession } from './octopod-source-workspace-session-subtraction'

export type OctopodMigrationDeltaView = {
  getRepos: () => Repo[]
  getFolderWorkspaces: () => FolderWorkspace[]
  getProjectGroups: () => ProjectGroup[]
  collectOctopodMigrationSourceDormantState: (
    source: OctopodMigrationManifestSource,
    catalog: OctopodMigrationCatalogPayload,
    destinationEnvironmentId?: string
  ) => OctopodMigrationDormantStatePayload
  inspectOctopodMigrationUntransferredDependencies: (
    manifest: OctopodMigrationManifest
  ) => OctopodMigrationSourceDependencyCensus
}

/** moved includes today's edits to previously migrated rows. */
export function createOctopodMigrationDeltaView(
  runtime: Pick<StoreRuntimeState, 'state' | 'terminalScrollbackSnapshotStorage'>,
  moved: OctopodMigrationManifest
): OctopodMigrationDeltaView {
  const state = structuredClone(runtime.state)
  subtractOctopodSourceCatalogState(state, moved)
  subtractOctopodMigrationSourceDormantState(state, moved)
  // The server owns the moved projects' tabs now, even ones the older build left unmovable.
  subtractOctopodMigrationScopeWorkspaceSession(state, moved)
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
