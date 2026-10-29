import { createHash } from 'node:crypto'
import {
  octopodMigrationManifestHashInput,
  serializeOctopodMigrationValue,
  type OctopodMigrationManifest
} from '../../shared/octopod-migration/octopod-migration-manifest'

export function computeOctopodMigrationManifestSha256(
  manifest: Omit<OctopodMigrationManifest, 'manifestSha256'>
): string {
  return createHash('sha256').update(octopodMigrationManifestHashInput(manifest)).digest('hex')
}

/** Hash the received manifest: unknown fields from newer peers are part of its signature. */
export function assertOctopodMigrationManifestDigest(manifest: unknown): void {
  if (typeof manifest !== 'object' || manifest === null || Array.isArray(manifest)) {
    throw new Error('octopod_migration_manifest_invalid')
  }
  const unsigned = Object.fromEntries(
    Object.entries(manifest).filter(([key]) => key !== 'manifestSha256')
  )
  const digest = createHash('sha256').update(serializeOctopodMigrationValue(unsigned)).digest('hex')
  if (!('manifestSha256' in manifest) || digest !== manifest.manifestSha256) {
    throw new Error('octopod_migration_manifest_digest_mismatch')
  }
}
