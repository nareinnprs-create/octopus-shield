import type { OctopodMigrationStagedCatalog } from './octopod-migration-manifest'
import {
  OCTOPOD_MIGRATION_MANIFEST_VERSION,
  parseOctopodMigrationManifest
} from './octopod-migration-manifest-validation'
import { isRecord } from './octopod-migration-manifest-fields'

export const MAX_OCTOPOD_MIGRATION_STAGED_CATALOGS = 4

export function normalizeOctopodMigrationStagedCatalogs(
  value: unknown
): OctopodMigrationStagedCatalog[] {
  if (!Array.isArray(value)) {
    return []
  }
  const staged: OctopodMigrationStagedCatalog[] = []
  const seen = new Set<string>()
  for (let index = value.length - 1; index >= 0; index--) {
    try {
      const entry = parseStagedCatalog(value[index])
      if (!seen.has(entry.manifest.migrationId)) {
        seen.add(entry.manifest.migrationId)
        staged.push(entry)
        if (staged.length === MAX_OCTOPOD_MIGRATION_STAGED_CATALOGS) {
          break
        }
      }
    } catch {
      // Invalid staging cannot prove fencing; drop it fail-closed.
    }
  }
  // Keep the migration journal runnable in the documented Node 18 rollback slot.
  return staged.reduceRight<OctopodMigrationStagedCatalog[]>((reversed, entry) => {
    reversed.push(entry)
    return reversed
  }, [])
}

function parseStagedCatalog(value: unknown): OctopodMigrationStagedCatalog {
  if (!isRecord(value) || value.version !== OCTOPOD_MIGRATION_MANIFEST_VERSION) {
    throw new Error('octopod_migration_staged_catalog_invalid')
  }
  const stagedAt = typeof value.stagedAt === 'string' ? value.stagedAt : ''
  if (!Number.isFinite(Date.parse(stagedAt))) {
    throw new Error('octopod_migration_staged_at_invalid')
  }
  return {
    version: OCTOPOD_MIGRATION_MANIFEST_VERSION,
    manifest: parseOctopodMigrationManifest(value.manifest),
    stagedAt
  }
}
