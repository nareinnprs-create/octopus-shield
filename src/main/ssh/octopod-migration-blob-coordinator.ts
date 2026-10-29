/** Check every blob kind against destination capabilities before uploading. Resume from staged offsets and confirm lost acknowledgements by re-reading state; never assume delivery or silently omit unsupported data. */
import {
  OCTOPOD_MIGRATION_BLOB_CHUNK_BYTES,
  type OctopodMigrationBlobChunkRequest,
  type OctopodMigrationBlobChunkResult,
  type OctopodMigrationBlobDescriptor,
  assertOctopodMigrationBlobSet,
  findUnsupportedMigrationBlobKind,
  octopodMigrationBlobIdentity,
  octopodMigrationBlobKindUnsupportedBlocker,
  sameOctopodMigrationBlob
} from '../../shared/octopod-migration/octopod-migration-blob-transfer'
import type {
  OctopodMigrationCatalogState,
  OctopodMigrationManifest
} from '../../shared/octopod-migration/octopod-migration-manifest'

export type OctopodMigrationBlobSource = {
  /** Return the descriptor's exact hashed bytes at offset, up to maxBytes. */
  readChunk: (
    descriptor: OctopodMigrationBlobDescriptor,
    offset: number,
    maxBytes: number
  ) => Promise<Buffer>
}

export type OctopodMigrationBlobDestination = {
  readCapabilities: () => Promise<readonly string[]>
  readState: (manifest: OctopodMigrationManifest) => Promise<OctopodMigrationCatalogState>
  stageChunk: (request: OctopodMigrationBlobChunkRequest) => Promise<OctopodMigrationBlobChunkResult>
}

type OctopodMigrationBlobTransfer = {
  source: OctopodMigrationBlobSource
  manifest: OctopodMigrationManifest
  blobs: readonly OctopodMigrationBlobDescriptor[]
  destination: OctopodMigrationBlobDestination
}

type StagedCatalogState = Extract<OctopodMigrationCatalogState, { state: 'staged' }>

export async function transferOctopodMigrationBlobs(
  transfer: OctopodMigrationBlobTransfer
): Promise<void> {
  if (transfer.blobs.length === 0) {
    return
  }
  assertOctopodMigrationBlobSet(transfer.blobs)
  const unsupported = findUnsupportedMigrationBlobKind(
    transfer.blobs,
    await transfer.destination.readCapabilities()
  )
  if (unsupported) {
    throw new Error(octopodMigrationBlobKindUnsupportedBlocker(unsupported))
  }
  const offsets = receivedOffsets(transfer, await readStagedState(transfer))
  for (const blob of transfer.blobs) {
    let offset = offsets.get(octopodMigrationBlobIdentity(blob)) ?? 0
    while (offset < blob.byteLength) {
      const bytes = await transfer.source.readChunk(
        blob,
        offset,
        Math.min(OCTOPOD_MIGRATION_BLOB_CHUNK_BYTES, blob.byteLength - offset)
      )
      if (
        bytes.length === 0 ||
        bytes.length > OCTOPOD_MIGRATION_BLOB_CHUNK_BYTES ||
        offset + bytes.length > blob.byteLength
      ) {
        throw new Error(`octopod_migration_source_blob_changed:${blob.blobKind}`)
      }
      const request: OctopodMigrationBlobChunkRequest = {
        migrationId: transfer.manifest.migrationId,
        manifestSha256: transfer.manifest.manifestSha256,
        blob: { ...blob },
        offset,
        bytesBase64: bytes.toString('base64')
      }
      offset = await stageChunkWithRecovery(transfer, request, offset + bytes.length)
    }
  }
  assertAllReceived(transfer, await readStagedState(transfer))
}

async function readStagedState(transfer: OctopodMigrationBlobTransfer): Promise<StagedCatalogState> {
  const state = await transfer.destination.readState(transfer.manifest)
  if (state.state !== 'staged') {
    throw new Error('octopod_migration_blob_catalog_not_staged')
  }
  return state
}

function receivedOffsets(
  transfer: OctopodMigrationBlobTransfer,
  state: StagedCatalogState
): Map<string, number> {
  const wanted = new Map(transfer.blobs.map((blob) => [octopodMigrationBlobIdentity(blob), blob]))
  const offsets = new Map<string, number>()
  for (const upload of state.blobUploads ?? []) {
    const blob = wanted.get(octopodMigrationBlobIdentity(upload))
    // A reused key with different bytes is another capture; restaging would mix them.
    if (!blob || !sameOctopodMigrationBlob(blob, upload)) {
      throw new Error(`octopod_migration_blob_descriptor_conflict:${upload.blobKind}`)
    }
    offsets.set(octopodMigrationBlobIdentity(upload), upload.receivedBytes)
  }
  return offsets
}

function assertAllReceived(transfer: OctopodMigrationBlobTransfer, state: StagedCatalogState): void {
  const received = receivedOffsets(transfer, state)
  for (const blob of transfer.blobs) {
    if (received.get(octopodMigrationBlobIdentity(blob)) !== blob.byteLength) {
      throw new Error(`octopod_migration_blob_transfer_incomplete:${blob.blobKind}`)
    }
  }
}

async function stageChunkWithRecovery(
  transfer: OctopodMigrationBlobTransfer,
  request: OctopodMigrationBlobChunkRequest,
  expectedOffset: number
): Promise<number> {
  try {
    const result = await transfer.destination.stageChunk(request)
    if (result.receivedBytes !== expectedOffset) {
      throw new Error('octopod_migration_blob_ack_invalid')
    }
    return result.receivedBytes
  } catch (error) {
    try {
      const observed = await transfer.destination.readState(transfer.manifest)
      const received =
        observed.state === 'staged'
          ? observed.blobUploads?.find(
              (entry) =>
                octopodMigrationBlobIdentity(entry) === octopodMigrationBlobIdentity(request.blob)
            )?.receivedBytes
          : undefined
      if (received === expectedOffset) {
        return received
      }
    } catch {
      // Unverifiable chunks retain the original failure.
    }
    throw error
  }
}
