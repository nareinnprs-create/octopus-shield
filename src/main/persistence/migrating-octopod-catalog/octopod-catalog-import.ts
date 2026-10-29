import { MAX_OCTOPOD_MIGRATION_STAGED_CATALOGS } from '../../../shared/octopod-migration/octopod-migration-staged-catalog-validation'
import { OCTOPOD_MIGRATION_MANIFEST_VERSION } from '../../../shared/octopod-migration/octopod-migration-manifest-validation'
import type {
  OctopodMigrationCatalogAbortResult,
  OctopodMigrationCatalogReference,
  OctopodMigrationCatalogReferenceAbortResult,
  OctopodMigrationCatalogState,
  OctopodMigrationImportReceipt,
  OctopodMigrationManifest
} from '../../../shared/octopod-migration/octopod-migration-manifest'
import type {
  OctopodMigrationSnapshotChunkRequest,
  OctopodMigrationSnapshotChunkResult
} from '../../../shared/octopod-migration/octopod-migration-scrollback'
import type {
  OctopodMigrationBlobChunkRequest,
  OctopodMigrationBlobChunkResult,
  OctopodMigrationBlobDescriptor
} from '../../../shared/octopod-migration/octopod-migration-blob-transfer'
import type { RepoLifecycleOperations } from '../loading-store/repo-lifecycle-operations'
import type { StoreRuntimeState } from '../loading-store/store-runtime-state'
import type { WriteSchedulingOperations } from '../loading-store/write-scheduling'
import { scheduleSave } from '../loading-store/write-scheduling'
import {
  applyPreparedOctopodMigrationCatalog,
  assertOctopodMigrationReceiptMatchesManifest,
  assertSameOctopodMigrationManifest,
  prepareOctopodMigrationCatalog,
  type PreparedOctopodMigrationCatalog
} from './octopod-catalog-records'
import {
  expireOctopodMigrationStages,
  findOctopodMigrationImportReceipt,
  isLiveOctopodMigrationStage,
  recordOctopodMigrationCommitWriteGeneration,
  recordOctopodMigrationImportReceipt,
  type OctopodMigrationCommitGenerationRuntime
} from './octopod-catalog-receipt-ledger'
import {
  abortOctopodMigrationSnapshots,
  assertOctopodMigrationSnapshotsReady,
  commitOctopodMigrationSnapshots,
  inspectOctopodMigrationSnapshotUploads,
  pruneOctopodMigrationSnapshotStaging,
  stageOctopodMigrationSnapshotChunk
} from './octopod-scrollback-snapshot-transfer'
import {
  abortOctopodMigrationBlobs,
  assertOctopodMigrationBlobSetMatches,
  assertOctopodMigrationBlobsReady,
  commitOctopodMigrationBlobs,
  inspectOctopodMigrationBlobUploads,
  pruneOctopodMigrationBlobStaging,
  stageOctopodMigrationBlobChunk
} from './octopod-migration-blob-staging'
import { assertOctopodMigrationBlobContentsValid } from './octopod-migration-blob-installers'
import {
  abortOctopodMigrationCatalogByReference,
  committedMigrations,
  stagedManifests
} from './octopod-catalog-reference-abort'

type OctopodCatalogImportRuntime = OctopodMigrationCommitGenerationRuntime &
  Pick<StoreRuntimeState, 'state' | 'terminalScrollbackSnapshotStorage' | 'octopodMigrationBlobRoot'>

const octopodCatalogImportContext = Symbol('OctopodCatalogImportPersistence')
type OctopodCatalogImportContext = {
  runtime: OctopodCatalogImportRuntime
  repos: RepoLifecycleOperations
  scheduling: WriteSchedulingOperations
}

// Manifests arrive parsed; the RPC boundary verified the digest over the bytes as sent.
export class OctopodCatalogImportPersistence {
  readonly [octopodCatalogImportContext]: OctopodCatalogImportContext

  constructor(
    runtime: OctopodCatalogImportRuntime,
    repos: RepoLifecycleOperations,
    scheduling: WriteSchedulingOperations
  ) {
    this[octopodCatalogImportContext] = { runtime, repos, scheduling }
  }

  stageOctopodMigrationCatalog(
    manifest: OctopodMigrationManifest,
    options: { now?: () => Date } = {}
  ): OctopodMigrationCatalogState {
    const context = this[octopodCatalogImportContext]
    const now = options.now ?? (() => new Date())
    if (expireOctopodMigrationStages(context.runtime.state, now().getTime())) {
      scheduleSave(context.scheduling)
    }
    pruneOctopodMigrationSnapshotStaging(
      stagedManifests(context.runtime.state),
      context.runtime.terminalScrollbackSnapshotStorage
    )
    pruneOctopodMigrationBlobStaging(
      stagedManifests(context.runtime.state),
      committedMigrations(context.runtime.state),
      context.runtime.octopodMigrationBlobRoot
    )
    const current = migrationCatalogState(context.runtime, manifest)
    if (current.state === 'committed') {
      return current
    }
    prepareOctopodMigrationCatalog(manifest, context.runtime.state)
    if (current.state === 'staged') {
      return current
    }
    const staged = context.runtime.state.octopodMigrationStagedCatalogs ?? []
    if (staged.length >= MAX_OCTOPOD_MIGRATION_STAGED_CATALOGS) {
      throw new Error('octopod_migration_staging_capacity_exceeded')
    }
    const stagedAt = now().toISOString()
    context.runtime.state.octopodMigrationStagedCatalogs = [
      ...staged,
      {
        version: OCTOPOD_MIGRATION_MANIFEST_VERSION,
        manifest: structuredClone(manifest),
        stagedAt
      }
    ]
    scheduleSave(context.scheduling)
    return stagedCatalogState(manifest, stagedAt, context.runtime)
  }

  stageOctopodMigrationSnapshotChunk(
    request: OctopodMigrationSnapshotChunkRequest
  ): OctopodMigrationSnapshotChunkResult {
    const context = this[octopodCatalogImportContext]
    return stageOctopodMigrationSnapshotChunk({
      stagedManifest:
        stagedManifests(context.runtime.state).find(
          (manifest) => manifest.migrationId === request.migrationId
        ) ?? null,
      storage: context.runtime.terminalScrollbackSnapshotStorage,
      request
    })
  }

  stageOctopodMigrationBlobChunk(
    request: OctopodMigrationBlobChunkRequest
  ): OctopodMigrationBlobChunkResult {
    const context = this[octopodCatalogImportContext]
    return stageOctopodMigrationBlobChunk({
      stagedManifest:
        stagedManifests(context.runtime.state).find(
          (manifest) => manifest.migrationId === request.migrationId
        ) ?? null,
      root: context.runtime.octopodMigrationBlobRoot,
      request
    })
  }

  /** Omitted expectedBlobs preserves older senders' commit behavior. */
  commitStagedOctopodMigrationCatalog(
    manifest: OctopodMigrationManifest,
    options: { now?: () => Date; expectedBlobs?: readonly OctopodMigrationBlobDescriptor[] } = {}
  ): OctopodMigrationCatalogState {
    const context = this[octopodCatalogImportContext]
    const current = migrationCatalogState(context.runtime, manifest)
    if (current.state === 'committed') {
      return current
    }
    if (current.state !== 'staged') {
      throw new Error('octopod_migration_catalog_not_staged')
    }
    const prepared = prepareOctopodMigrationCatalog(manifest, context.runtime.state)
    const blobRoot = context.runtime.octopodMigrationBlobRoot
    assertOctopodMigrationSnapshotsReady(manifest, context.runtime.terminalScrollbackSnapshotStorage)
    if (options.expectedBlobs) {
      assertOctopodMigrationBlobSetMatches(manifest, blobRoot, options.expectedBlobs)
    }
    assertOctopodMigrationBlobsReady(manifest, blobRoot)
    assertOctopodMigrationBlobContentsValid(manifest, blobRoot)
    commitOctopodMigrationSnapshots(manifest, context.runtime.terminalScrollbackSnapshotStorage)
    commitOctopodMigrationBlobs(manifest, blobRoot)
    const receipt = commitPreparedCatalog(context, manifest, prepared, options.now)
    const generationBefore = context.runtime.writeGeneration
    scheduleSave(context.scheduling)
    recordOctopodMigrationCommitWriteGeneration(context.runtime, manifest, generationBefore)
    return committedCatalogState(receipt)
  }

  abortStagedOctopodMigrationCatalog(
    manifest: OctopodMigrationManifest
  ): OctopodMigrationCatalogAbortResult {
    const context = this[octopodCatalogImportContext]
    const current = migrationCatalogState(context.runtime, manifest)
    if (current.state === 'committed' || current.state === 'absent') {
      return { ...current, aborted: false }
    }
    // Staged rows are dormant and unreferenced outside this stage.
    context.runtime.state.octopodMigrationStagedCatalogs = (
      context.runtime.state.octopodMigrationStagedCatalogs ?? []
    ).filter((entry) => entry.manifest.migrationId !== manifest.migrationId)
    abortOctopodMigrationSnapshots(manifest, context.runtime.terminalScrollbackSnapshotStorage)
    abortOctopodMigrationBlobs(manifest, context.runtime.octopodMigrationBlobRoot)
    scheduleSave(context.scheduling)
    return { ...absentCatalogState(manifest), aborted: true }
  }

  /** Use the stored manifest when the source cannot send one. */
  abortStagedOctopodMigrationCatalogByReference(
    reference: OctopodMigrationCatalogReference
  ): OctopodMigrationCatalogReferenceAbortResult {
    return abortOctopodMigrationCatalogByReference(
      this[octopodCatalogImportContext].runtime.state,
      reference,
      (manifest) => this.abortStagedOctopodMigrationCatalog(manifest)
    )
  }

  getOctopodMigrationCatalogState(manifest: OctopodMigrationManifest): OctopodMigrationCatalogState {
    const context = this[octopodCatalogImportContext]
    return migrationCatalogState(context.runtime, manifest)
  }

  hasStagedOctopodMigrationCatalog(now: number = Date.now()): boolean {
    return (this[octopodCatalogImportContext].runtime.state.octopodMigrationStagedCatalogs ?? []).some(
      (entry) => isLiveOctopodMigrationStage(entry.stagedAt, now)
    )
  }
}

function commitPreparedCatalog(
  context: OctopodCatalogImportContext,
  manifest: OctopodMigrationManifest,
  prepared: PreparedOctopodMigrationCatalog,
  now?: () => Date
): OctopodMigrationImportReceipt {
  applyPreparedOctopodMigrationCatalog(prepared, context.runtime.state, context.repos)
  const receipt: OctopodMigrationImportReceipt = {
    version: OCTOPOD_MIGRATION_MANIFEST_VERSION,
    migrationId: manifest.migrationId,
    manifestSha256: manifest.manifestSha256,
    source: structuredClone(manifest.source),
    importedAt: (now ?? (() => new Date()))().toISOString(),
    repositoryIds: prepared.repositories.map((repo) => repo.id),
    projectGroupIds: prepared.projectGroups.map((group) => group.id),
    folderWorkspaceIds: prepared.folderWorkspaces.map((workspace) => workspace.id)
  }
  context.runtime.state.octopodMigrationStagedCatalogs = (
    context.runtime.state.octopodMigrationStagedCatalogs ?? []
  ).filter((entry) => entry.manifest.migrationId !== manifest.migrationId)
  recordOctopodMigrationImportReceipt(context.runtime.state, receipt)
  return receipt
}

function migrationCatalogState(
  runtime: OctopodCatalogImportRuntime,
  manifest: OctopodMigrationManifest
): OctopodMigrationCatalogState {
  const { state } = runtime
  const receipt = findOctopodMigrationImportReceipt(state, manifest)
  if (receipt) {
    assertCommittedReceipt(receipt, manifest)
    return committedCatalogState(receipt)
  }
  const staged = state.octopodMigrationStagedCatalogs?.find(
    (entry) => entry.manifest.migrationId === manifest.migrationId
  )
  if (!staged) {
    return absentCatalogState(manifest)
  }
  assertSameOctopodMigrationManifest(staged.manifest, manifest)
  return stagedCatalogState(manifest, staged.stagedAt, runtime)
}

// A committed receipt stays authoritative even after live rows and snapshots change.
function assertCommittedReceipt(
  receipt: OctopodMigrationImportReceipt,
  manifest: OctopodMigrationManifest
): void {
  if (receipt.manifestSha256 !== manifest.manifestSha256) {
    throw new Error('octopod_migration_id_reused_with_different_manifest')
  }
  assertOctopodMigrationReceiptMatchesManifest(receipt, manifest)
}

function absentCatalogState(manifest: OctopodMigrationManifest): OctopodMigrationCatalogState {
  return {
    state: 'absent',
    migrationId: manifest.migrationId,
    manifestSha256: manifest.manifestSha256
  }
}

function stagedCatalogState(
  manifest: OctopodMigrationManifest,
  stagedAt: string,
  runtime: OctopodCatalogImportRuntime
): OctopodMigrationCatalogState {
  const snapshotUploads = inspectOctopodMigrationSnapshotUploads(
    manifest,
    runtime.terminalScrollbackSnapshotStorage
  )
  // Omit absent uploads to preserve older hosts' response shape.
  const blobUploads = inspectOctopodMigrationBlobUploads(manifest, runtime.octopodMigrationBlobRoot)
  return {
    state: 'staged',
    migrationId: manifest.migrationId,
    manifestSha256: manifest.manifestSha256,
    stagedAt,
    ...(snapshotUploads ? { snapshotUploads } : {}),
    ...(blobUploads ? { blobUploads } : {})
  }
}

function committedCatalogState(receipt: OctopodMigrationImportReceipt): OctopodMigrationCatalogState {
  return {
    state: 'committed',
    migrationId: receipt.migrationId,
    manifestSha256: receipt.manifestSha256,
    receipt: structuredClone(receipt)
  }
}
