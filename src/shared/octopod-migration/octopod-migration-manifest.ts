import type { FolderWorkspace } from '../folder-workspace-types'
import type { Automation, AutomationRun } from '../automations-types'
import type { OctopodMigrationManifestVersion } from './octopod-migration-manifest-validation'
import type { ProjectGroup } from '../project-group-types'
import type { Repo } from '../repo-types'
import type { SparsePreset } from '../worktree/create-types'
import type { WorkspaceLineage, WorktreeLineage } from '../worktree/lineage-types'
import type { WorktreeMeta } from '../worktree/meta-types'
import type { RetiredNameRegistry } from '../worktree/retired-name-registry'
import type { WorkspaceSessionState } from '../workspace-session-state-types'
import type { OctopodMigrationClientStatePayload } from './octopod-migration-client-state'
import type {
  OctopodMigrationSnapshotUploadState,
  OctopodMigrationTerminalScrollbackSnapshot
} from './octopod-migration-scrollback'
import type { OctopodMigrationBlobUploadState } from './octopod-migration-blob-transfer'

import { isRecord } from './octopod-migration-manifest-fields'

/** The relay-era SSH source: on the wire it never carries `kind` (see octopod-migration-source-kind). */
export type OctopodMigrationSshManifestSource = {
  sshTargetId: string
  sshTargetGeneration: number | null
  targetLabel: string
}

/** Explicit desktop WSL project scope prevents destination path inference; generation orders delta moves. */
export type OctopodMigrationLocalWslManifestSource = {
  kind: 'local-wsl'
  distro: string
  /** The distro's registry id, when known: a re-registered distro of the same name is another one. */
  distroGuid?: string
  scopeRepoIds: string[]
  scopeFolderWorkspaceIds: string[]
  generation: number
}

export type OctopodMigrationManifestSource =
  | OctopodMigrationSshManifestSource
  | OctopodMigrationLocalWslManifestSource

export type OctopodMigrationCatalogPayload = {
  repositories: Repo[]
  projectGroups: ProjectGroup[]
  folderWorkspaces: FolderWorkspace[]
  dormantState?: OctopodMigrationDormantStatePayload
}

export type OctopodMigrationDormantWorktreeMeta = {
  sourceKey: string
  worktreeId: string
  meta: WorktreeMeta
}

export type OctopodMigrationDormantWorktreeLineage = {
  sourceKey: string
  worktreeId: string
  lineage: WorktreeLineage
}

export type OctopodMigrationDormantWorkspaceLineage = {
  sourceKey: string
  childWorkspaceKey: string
  lineage: WorkspaceLineage
}

export type OctopodMigrationDormantRetiredNames = {
  repoId: string
  registry: RetiredNameRegistry
}

export type OctopodMigrationDormantRetirementNamespace = {
  sourceNamespaceKeys: string[]
  namespaceKey: string
  registry: RetiredNameRegistry
}

export type OctopodMigrationDormantStatePayload = {
  version: 1
  worktreeMeta: OctopodMigrationDormantWorktreeMeta[]
  worktreeLineage: OctopodMigrationDormantWorktreeLineage[]
  workspaceLineage: OctopodMigrationDormantWorkspaceLineage[]
  sparsePresets: SparsePreset[]
  retiredWorktreeNames: OctopodMigrationDormantRetiredNames[]
  retiredWorktreeNamespaces: OctopodMigrationDormantRetirementNamespace[]
  workspaceSession?: WorkspaceSessionState
  terminalScrollbackSnapshots?: OctopodMigrationTerminalScrollbackSnapshot[]
  automations?: Automation[]
  automationRuns?: AutomationRun[]
  /** Client-owned durable intent projected to the destination authority. */
  clientState?: OctopodMigrationClientStatePayload
}

export type OctopodMigrationManifest = {
  version: OctopodMigrationManifestVersion
  migrationId: string
  createdAt: string
  source: OctopodMigrationManifestSource
  payload: OctopodMigrationCatalogPayload
  /** Destination runtime identity used to re-key desktop routing after commit. */
  destinationEnvironmentId?: string
  manifestSha256: string
}

export type OctopodMigrationImportReceipt = {
  version: OctopodMigrationManifestVersion
  migrationId: string
  manifestSha256: string
  source: OctopodMigrationManifestSource
  importedAt: string
  repositoryIds: string[]
  projectGroupIds: string[]
  folderWorkspaceIds: string[]
}

export type OctopodMigrationStagedCatalog = {
  version: OctopodMigrationManifestVersion
  manifest: OctopodMigrationManifest
  stagedAt: string
}

export type OctopodMigrationCatalogState =
  | {
      state: 'absent'
      migrationId: string
      manifestSha256: string
    }
  | {
      state: 'staged'
      migrationId: string
      manifestSha256: string
      stagedAt: string
      snapshotUploads?: OctopodMigrationSnapshotUploadState[]
      /** Blobs staged so far; absent from hosts without the blob channel. */
      blobUploads?: OctopodMigrationBlobUploadState[]
    }
  | {
      state: 'committed'
      migrationId: string
      manifestSha256: string
      receipt: OctopodMigrationImportReceipt
    }

export type OctopodMigrationCatalogAbortResult = OctopodMigrationCatalogState & {
  aborted: boolean
  durableAbsent?: true
}

export type OctopodMigrationCatalogReference = Pick<
  OctopodMigrationManifest,
  'migrationId' | 'manifestSha256'
>

/** An abort by reference: no receipt, since an evicted one is rebuilt only from the manifest. */
export type OctopodMigrationCatalogReferenceAbortResult = OctopodMigrationCatalogReference & {
  state: 'absent' | 'committed'
  aborted: boolean
  durableAbsent?: true
}

export function octopodMigrationManifestHashInput(
  manifest: Omit<OctopodMigrationManifest, 'manifestSha256'>
): string {
  return serializeOctopodMigrationValue(manifest)
}

export function serializeOctopodMigrationValue(value: unknown): string {
  return JSON.stringify(canonicalizeJsonValue(value))
}

function canonicalizeJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalizeJsonValue)
  }
  if (!isRecord(value)) {
    return value
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, entry]) => [key, canonicalizeJsonValue(entry)])
  )
}
