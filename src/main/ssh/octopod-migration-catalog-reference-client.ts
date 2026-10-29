import { parseOctopodMigrationCatalogReferenceAbortResult } from '../../shared/octopod-migration/octopod-migration-catalog-state'
import type {
  OctopodMigrationCatalogReferenceAbortResult,
  OctopodMigrationManifest
} from '../../shared/octopod-migration/octopod-migration-manifest'
import { OCTOPOD_MIGRATION_CATALOG_ABORT_BY_REFERENCE_RUNTIME_CAPABILITY } from '../../shared/octopod-runtime-capabilities'
import { parsePairingCode } from '../../shared/pairing'
import type { RuntimeRpcResponse } from '../../shared/runtime-rpc-envelope'
import {
  OCTOPOD_MIGRATION_DESTINATION_UNSUPPORTED,
  sendSupportedMigrationRequest,
  type CatalogRequestOptions
} from './octopod-migration-catalog-client'

/** Unlike migration-unsupported, this refusal cannot prove no earlier stage exists. */
export const OCTOPOD_MIGRATION_DESTINATION_ABORT_BY_REFERENCE_UNSUPPORTED =
  'octopod_migration_destination_abort_by_reference_unsupported:Update Shield on this host to cancel this move.'

/** Abort by manifest identity when the full request cannot fit the sealed frame. */
export async function abortRemoteOctopodMigrationCatalogByReference(
  pairingCode: string,
  manifest: OctopodMigrationManifest,
  options: CatalogRequestOptions = {}
): Promise<OctopodMigrationCatalogReferenceAbortResult> {
  const pairing = parsePairingCode(pairingCode)
  if (!pairing) {
    throw new Error('octopod_migration_pairing_code_invalid')
  }
  let supportsReference = false
  let response: RuntimeRpcResponse<unknown>
  try {
    response = await sendSupportedMigrationRequest(
      pairing,
      'octopod.migration.abortCatalogByReference',
      { migrationId: manifest.migrationId, manifestSha256: manifest.manifestSha256 },
      options,
      false,
      null,
      (capabilities) => {
        supportsReference = capabilities.includes(
          OCTOPOD_MIGRATION_CATALOG_ABORT_BY_REFERENCE_RUNTIME_CAPABILITY
        )
        if (!supportsReference) {
          throw new Error(OCTOPOD_MIGRATION_DESTINATION_ABORT_BY_REFERENCE_UNSUPPORTED)
        }
      }
    )
  } catch (error) {
    // A missing method on a host that advertised it proves nothing about what it staged.
    if (
      supportsReference &&
      error instanceof Error &&
      error.message === OCTOPOD_MIGRATION_DESTINATION_UNSUPPORTED
    ) {
      throw new Error(OCTOPOD_MIGRATION_DESTINATION_ABORT_BY_REFERENCE_UNSUPPORTED)
    }
    throw error
  }
  if (!response.ok) {
    throw new Error(`octopod_migration_abort_failed:${response.error.message}`)
  }
  return parseOctopodMigrationCatalogReferenceAbortResult(response.result, manifest)
}
