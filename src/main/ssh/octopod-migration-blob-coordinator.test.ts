import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  OCTOPOD_MIGRATION_BLOB_CHUNK_BYTES,
  requiredMigrationBlobCapabilities,
  type OctopodMigrationBlobDescriptor
} from '../../shared/octopod-migration/octopod-migration-blob-transfer'
import { OCTOPOD_MIGRATION_MANIFEST_VERSION } from '../../shared/octopod-migration/octopod-migration-manifest-validation'
import type {
  OctopodMigrationCatalogState,
  OctopodMigrationManifest
} from '../../shared/octopod-migration/octopod-migration-manifest'
import { OCTOPOD_MIGRATION_BLOB_CHANNEL_RUNTIME_CAPABILITY } from '../../shared/octopod-runtime-capabilities'
import {
  commitOctopodMigrationBlobs,
  getOctopodMigrationReceivedBlobPath,
  inspectOctopodMigrationBlobUploads,
  stageOctopodMigrationBlobChunk
} from '../persistence/migrating-octopod-catalog/octopod-migration-blob-staging'
import {
  transferOctopodMigrationBlobs,
  type OctopodMigrationBlobDestination
} from './octopod-migration-blob-coordinator'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'octopod-migration-blob-sender-'))
})

afterEach(() => rmSync(root, { recursive: true, force: true }))

const manifest: OctopodMigrationManifest = {
  version: OCTOPOD_MIGRATION_MANIFEST_VERSION,
  migrationId: 'migration-1',
  createdAt: '2026-08-30T12:00:00.000Z',
  source: { sshTargetId: 'source', sshTargetGeneration: 1, targetLabel: 'Source' },
  payload: { repositories: [], projectGroups: [], folderWorkspaces: [] },
  manifestSha256: 'a'.repeat(64)
}

const history = Buffer.alloc(OCTOPOD_MIGRATION_BLOB_CHUNK_BYTES * 2 + 17, 0x61)
const hints = Buffer.from('{"panes":[]}')
const blobs = [
  descriptor('shell-history', `${'a'.repeat(16)}-zsh`, history),
  descriptor('terminal-restore-hints', 'migration', hints)
]
const contents = new Map([
  [blobs[0].key, history],
  [blobs[1].key, hints]
])

describe('octopod migration blob sender', () => {
  it('uploads every blob in bounded chunks, resuming from the staged offset', async () => {
    stageOctopodMigrationBlobChunk({
      stagedManifest: manifest,
      root,
      request: chunkRequest(blobs[0], 0, history.subarray(0, OCTOPOD_MIGRATION_BLOB_CHUNK_BYTES))
    })
    const destination = realDestination(requiredMigrationBlobCapabilities(blobs))

    await transferOctopodMigrationBlobs({ source: source(), manifest, blobs, destination })

    expect(destination.stageChunk.mock.calls.map(([request]) => request.offset)).toEqual([
      OCTOPOD_MIGRATION_BLOB_CHUNK_BYTES,
      OCTOPOD_MIGRATION_BLOB_CHUNK_BYTES * 2,
      0
    ])
    commitOctopodMigrationBlobs(manifest, root)
    for (const blob of blobs) {
      expect(readFileSync(getOctopodMigrationReceivedBlobPath(root, manifest, blob))).toEqual(
        contents.get(blob.key)
      )
    }
  })

  it.each([
    ['the blob channel', [blobs[1]], ['octopod.migration-blob.terminal-restore-hints.v1']],
    ["the blob's kind", [blobs[1]], [OCTOPOD_MIGRATION_BLOB_CHANNEL_RUNTIME_CAPABILITY]]
  ])('refuses before staging anything when the destination lacks %s', async (_, sent, caps) => {
    const destination = realDestination(caps)

    await expect(
      transferOctopodMigrationBlobs({ source: source(), manifest, blobs: sent, destination })
    ).rejects.toThrow(/^octopod_migration_destination_blob_kind_unsupported:terminal-restore-hints:/)
    expect(destination.readState).not.toHaveBeenCalled()
    expect(destination.stageChunk).not.toHaveBeenCalled()
    expect(inspectOctopodMigrationBlobUploads(manifest, root)).toBeUndefined()
  })

  it('confirms a chunk whose acknowledgement was lost from the staged state', async () => {
    const destination = realDestination(requiredMigrationBlobCapabilities(blobs))
    const stage = destination.stageChunk.getMockImplementation()
    destination.stageChunk.mockImplementationOnce(async (request) => {
      await stage?.(request)
      throw new Error('connection_lost')
    })

    await transferOctopodMigrationBlobs({ source: source(), manifest, blobs, destination })
    expect(inspectOctopodMigrationBlobUploads(manifest, root)?.map((u) => u.receivedBytes)).toEqual(
      expect.arrayContaining([history.length, hints.length])
    )
  })

  it('refuses when the destination holds the same key with other bytes', async () => {
    const stale = descriptor('terminal-restore-hints', 'migration', Buffer.from('stale'))
    stageOctopodMigrationBlobChunk({
      stagedManifest: manifest,
      root,
      request: chunkRequest(stale, 0, Buffer.from('st'))
    })
    const destination = realDestination(requiredMigrationBlobCapabilities(blobs))

    await expect(
      transferOctopodMigrationBlobs({ source: source(), manifest, blobs, destination })
    ).rejects.toThrow('octopod_migration_blob_descriptor_conflict:terminal-restore-hints')
    expect(destination.stageChunk).not.toHaveBeenCalled()
  })

  it('sends nothing and asks nothing when there are no blobs', async () => {
    const destination = realDestination([])
    await transferOctopodMigrationBlobs({ source: source(), manifest, blobs: [], destination })
    expect(destination.readCapabilities).not.toHaveBeenCalled()
  })
})

function descriptor(
  blobKind: OctopodMigrationBlobDescriptor['blobKind'],
  key: string,
  bytes: Buffer
): OctopodMigrationBlobDescriptor {
  return {
    blobKind,
    key,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    byteLength: bytes.length
  }
}

function chunkRequest(blob: OctopodMigrationBlobDescriptor, offset: number, bytes: Buffer) {
  return {
    migrationId: manifest.migrationId,
    manifestSha256: manifest.manifestSha256,
    blob,
    offset,
    bytesBase64: bytes.toString('base64')
  }
}

function source() {
  return {
    readChunk: async (blob: OctopodMigrationBlobDescriptor, offset: number, maxBytes: number) =>
      (contents.get(blob.key) ?? Buffer.alloc(0)).subarray(offset, offset + maxBytes)
  }
}

/** Use real staging semantics so resume observes host-equivalent state. */
function realDestination(capabilities: readonly string[]) {
  const readState = async (): Promise<OctopodMigrationCatalogState> => {
    const blobUploads = inspectOctopodMigrationBlobUploads(manifest, root)
    return {
      state: 'staged',
      migrationId: manifest.migrationId,
      manifestSha256: manifest.manifestSha256,
      stagedAt: '2026-08-30T12:01:00.000Z',
      ...(blobUploads ? { blobUploads } : {})
    }
  }
  const destination = {
    readCapabilities: vi.fn<OctopodMigrationBlobDestination['readCapabilities']>(
      async () => capabilities
    ),
    readState: vi.fn<OctopodMigrationBlobDestination['readState']>(readState),
    stageChunk: vi.fn<OctopodMigrationBlobDestination['stageChunk']>(async (request) =>
      stageOctopodMigrationBlobChunk({ stagedManifest: manifest, root, request })
    )
  }
  return destination
}
