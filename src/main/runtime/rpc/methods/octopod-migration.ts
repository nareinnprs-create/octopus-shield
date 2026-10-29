import type { z } from 'zod'
import {
  OctopodMigrationCatalogParams,
  OctopodMigrationCatalogReferenceParams,
  OctopodMigrationCommitCatalogParams
} from '../../../../shared/rpc-contract/octopod-migration-params'
import { parseOctopodMigrationManifest } from '../../../../shared/octopod-migration/octopod-migration-manifest-validation'
import { OctopodMigrationSnapshotChunkRequestSchema } from '../../../../shared/octopod-migration/octopod-migration-scrollback'
import { OctopodMigrationBlobChunkRequestSchema } from '../../../../shared/octopod-migration/octopod-migration-blob-transfer'
import { assertOctopodMigrationManifestDigest } from '../../../octopod/octopod-migration-manifest-digest'
import { assertOctopodMigrationSourceServedHere } from '../../../octopod/octopod-migration-wsl-destination'
import { defineMethod, type RpcContext } from '../core'

export const OCTOPOD_MIGRATION_METHODS = [
  defineMethod({
    name: 'octopod.migration.stageCatalog',
    permission: 'host-admin',
    params: OctopodMigrationCatalogParams,
    handler: async (params, context) => {
      requireMigrationRuntimeClient(context)
      return context.runtime.stageOctopodMigrationCatalog(migrationManifest(params), {
        signal: context.signal
      })
    }
  }),
  defineMethod({
    name: 'octopod.migration.commitCatalog',
    permission: 'host-admin',
    params: OctopodMigrationCommitCatalogParams,
    handler: async (params, context) => {
      requireMigrationRuntimeClient(context)
      return context.runtime.commitStagedOctopodMigrationCatalog(migrationManifest(params), {
        signal: context.signal,
        ...(params.expectedBlobs ? { expectedBlobs: params.expectedBlobs } : {})
      })
    }
  }),
  defineMethod({
    name: 'octopod.migration.stageSnapshotChunk',
    permission: 'host-admin',
    params: OctopodMigrationSnapshotChunkRequestSchema,
    handler: async (params, context) => {
      requireMigrationRuntimeClient(context)
      return context.runtime.stageOctopodMigrationSnapshotChunk(params)
    }
  }),
  // A separate method, not a field on stageSnapshotChunk: an older host would strip the field and
  // stage the bytes as a snapshot.
  defineMethod({
    name: 'octopod.migration.stageBlobChunk',
    permission: 'host-admin',
    params: OctopodMigrationBlobChunkRequestSchema,
    handler: async (params, context) => {
      requireMigrationRuntimeClient(context)
      return context.runtime.stageOctopodMigrationBlobChunk(params)
    }
  }),
  defineMethod({
    name: 'octopod.migration.abortCatalog',
    permission: 'host-admin',
    params: OctopodMigrationCatalogParams,
    handler: async (params, context) => {
      requireMigrationRuntimeClient(context)
      return context.runtime.abortStagedOctopodMigrationCatalog(migrationManifest(params), {
        signal: context.signal
      })
    }
  }),
  // Why a reference: a source fenced on a manifest no request can carry must still be releasable.
  defineMethod({
    name: 'octopod.migration.abortCatalogByReference',
    permission: 'host-admin',
    params: OctopodMigrationCatalogReferenceParams,
    handler: async (params, context) => {
      requireMigrationRuntimeClient(context)
      return context.runtime.abortStagedOctopodMigrationCatalogByReference(params, {
        signal: context.signal
      })
    }
  }),
  defineMethod({
    name: 'octopod.migration.catalogState',
    permission: 'host-admin',
    params: OctopodMigrationCatalogParams,
    handler: async (params, context) => {
      requireMigrationRuntimeClient(context)
      return context.runtime.getOctopodMigrationCatalogState(migrationManifest(params))
    }
  })
]

function migrationManifest(params: z.infer<typeof OctopodMigrationCatalogParams>) {
  const manifest = parseOctopodMigrationManifest(params.manifest)
  // Raw, not parsed: parsing drops fields this host predates, which a newer client signed.
  assertOctopodMigrationManifestDigest(params.manifest)
  assertOctopodMigrationSourceServedHere(manifest.source)
  return manifest
}

function requireMigrationRuntimeClient(context: RpcContext): void {
  if (context.clientKind !== 'runtime' || !context.pairedDeviceId) {
    throw new Error('octopod_migration_runtime_client_required')
  }
}
