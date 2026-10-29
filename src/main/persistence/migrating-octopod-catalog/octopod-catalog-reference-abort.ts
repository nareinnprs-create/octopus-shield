import type {
  OctopodMigrationCatalogAbortResult,
  OctopodMigrationCatalogReference,
  OctopodMigrationCatalogReferenceAbortResult,
  OctopodMigrationManifest
} from '../../../shared/octopod-migration/octopod-migration-manifest'
import type { StoreRuntimeState } from '../loading-store/store-runtime-state'

export function stagedManifests(state: StoreRuntimeState['state']): OctopodMigrationManifest[] {
  return (state.octopodMigrationStagedCatalogs ?? []).map((entry) => entry.manifest)
}

export function committedMigrations(
  state: StoreRuntimeState['state']
): { migrationId: string; manifestSha256: string }[] {
  return [
    ...(state.octopodMigrationImportReceipts ?? []),
    ...(state.octopodMigrationEvictedReceipts ?? [])
  ]
}

/** Use the stored manifest; an existing commit takes precedence over abort. */
export function abortOctopodMigrationCatalogByReference(
  state: StoreRuntimeState['state'],
  reference: OctopodMigrationCatalogReference,
  abortStaged: (manifest: OctopodMigrationManifest) => OctopodMigrationCatalogAbortResult
): OctopodMigrationCatalogReferenceAbortResult {
  const identity = { migrationId: reference.migrationId, manifestSha256: reference.manifestSha256 }
  const committed = committedMigrations(state).find(
    (entry) => entry.migrationId === reference.migrationId
  )
  const staged = stagedManifests(state).find(
    (manifest) => manifest.migrationId === reference.migrationId
  )
  const held = committed ?? staged
  if (held && held.manifestSha256 !== reference.manifestSha256) {
    throw new Error('octopod_migration_id_reused_with_different_manifest')
  }
  if (committed) {
    return { ...identity, state: 'committed', aborted: false }
  }
  if (!staged) {
    return { ...identity, state: 'absent', aborted: false }
  }
  const result = abortStaged(staged)
  return {
    ...identity,
    state: result.state === 'committed' ? 'committed' : 'absent',
    aborted: result.aborted
  }
}
