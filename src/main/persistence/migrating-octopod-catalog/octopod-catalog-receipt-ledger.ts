// Commit receipts remain authoritative indefinitely; abandoned stages expire.
import { MAX_OCTOPOD_MIGRATION_IMPORT_RECEIPTS } from '../../../shared/octopod-migration/octopod-migration-manifest-validation'
import type {
  OctopodMigrationImportReceipt,
  OctopodMigrationManifest
} from '../../../shared/octopod-migration/octopod-migration-manifest'
import { MAX_OCTOPOD_MIGRATION_EVICTED_RECEIPTS } from '../../../shared/octopod-migration/octopod-migration-evicted-receipts'
import type { PersistedState } from '../../../shared/persisted-state-types'
import type { StoreRuntimeState } from '../loading-store/store-runtime-state'
import {
  octopodMigrationStagingKey,
  type OctopodMigrationRequestIdentity
} from './octopod-migration-staged-file'

// Allow a week for clients that went offline mid-move.
export const OCTOPOD_MIGRATION_STAGE_TTL_MS = 7 * 24 * 60 * 60 * 1000

export function findOctopodMigrationImportReceipt(
  state: PersistedState,
  manifest: OctopodMigrationManifest
): OctopodMigrationImportReceipt | undefined {
  const receipt = state.octopodMigrationImportReceipts?.find(
    (entry) => entry.migrationId === manifest.migrationId
  )
  if (receipt) {
    return receipt
  }
  const evicted = state.octopodMigrationEvictedReceipts?.find(
    (entry) => entry.migrationId === manifest.migrationId
  )
  // Rebuild the remaining receipt fields from the manifest.
  return evicted
    ? {
        version: manifest.version,
        migrationId: evicted.migrationId,
        manifestSha256: evicted.manifestSha256,
        source: structuredClone(manifest.source),
        importedAt: evicted.importedAt,
        repositoryIds: manifest.payload.repositories.map((repo) => repo.id),
        projectGroupIds: manifest.payload.projectGroups.map((group) => group.id),
        folderWorkspaceIds: manifest.payload.folderWorkspaces.map((workspace) => workspace.id)
      }
    : undefined
}

/** Compact evicted receipts without losing proof of commit. */
export function recordOctopodMigrationImportReceipt(
  state: PersistedState,
  receipt: OctopodMigrationImportReceipt
): void {
  const receipts = [...(state.octopodMigrationImportReceipts ?? []), receipt]
  const overflow = receipts.length - MAX_OCTOPOD_MIGRATION_IMPORT_RECEIPTS
  if (overflow > 0) {
    state.octopodMigrationEvictedReceipts = [
      ...(state.octopodMigrationEvictedReceipts ?? []),
      ...receipts.slice(0, overflow).map(({ migrationId, manifestSha256, importedAt }) => ({
        migrationId,
        manifestSha256,
        importedAt
      }))
    ].slice(-MAX_OCTOPOD_MIGRATION_EVICTED_RECEIPTS)
  }
  state.octopodMigrationImportReceipts = receipts.slice(-MAX_OCTOPOD_MIGRATION_IMPORT_RECEIPTS)
}

export function isLiveOctopodMigrationStage(stagedAt: string, now: number): boolean {
  return now - Date.parse(stagedAt) < OCTOPOD_MIGRATION_STAGE_TTL_MS
}

export function expireOctopodMigrationStages(state: PersistedState, now: number): boolean {
  const staged = state.octopodMigrationStagedCatalogs ?? []
  const live = staged.filter((entry) => isLiveOctopodMigrationStage(entry.stagedAt, now))
  if (live.length === staged.length) {
    return false
  }
  state.octopodMigrationStagedCatalogs = live
  return true
}

export type OctopodMigrationCommitGenerationRuntime = Pick<
  StoreRuntimeState,
  'writeGeneration' | 'lastDurableWriteGeneration' | 'octopodMigrationCommitWriteGenerations'
>

/** Call right after the commit's `scheduleSave`; `generationBefore` is read just before it. */
export function recordOctopodMigrationCommitWriteGeneration(
  runtime: OctopodMigrationCommitGenerationRuntime,
  migration: OctopodMigrationRequestIdentity,
  generationBefore: number
): void {
  // Suppressed saves never advance generation; only a disk-loaded receipt can prove durability.
  runtime.octopodMigrationCommitWriteGenerations.set(
    octopodMigrationStagingKey(migration),
    runtime.writeGeneration > generationBefore ? runtime.writeGeneration : Number.POSITIVE_INFINITY
  )
}

/** Require disk durability before consuming blobs a restart might need to retry. */
export function isOctopodMigrationCommitDurable(
  runtime: OctopodMigrationCommitGenerationRuntime,
  migration: OctopodMigrationRequestIdentity
): boolean {
  const key = octopodMigrationStagingKey(migration)
  const required = runtime.octopodMigrationCommitWriteGenerations.get(key)
  if (required === undefined) {
    return true
  }
  if (runtime.lastDurableWriteGeneration < required) {
    return false
  }
  runtime.octopodMigrationCommitWriteGenerations.delete(key)
  return true
}
