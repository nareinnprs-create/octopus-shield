import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  OctopodMigrationBlobChunkRequest,
  OctopodMigrationBlobDescriptor
} from '../../shared/octopod-migration/octopod-migration-blob-transfer'
import { OCTOPOD_MIGRATION_MANIFEST_VERSION } from '../../shared/octopod-migration/octopod-migration-manifest-validation'
import type { OctopodMigrationManifest } from '../../shared/octopod-migration/octopod-migration-manifest'
import {
  OCTOPOD_MIGRATION_BLOB_CHANNEL_RUNTIME_CAPABILITY,
  OCTOPOD_MIGRATION_CATALOG_RUNTIME_CAPABILITY
} from '../../shared/octopod-runtime-capabilities'
import { encodePairingOffer, PAIRING_OFFER_VERSION } from '../../shared/pairing'

const sendRequest = vi.hoisted(() => vi.fn())
const status = vi.hoisted((): { capabilities: string[] } => ({ capabilities: [] }))
vi.mock('../../shared/remote-runtime/remote-runtime-client', () => ({
  sendRemoteRuntimeRequestWithStatusPreflight: async (
    pairing: unknown,
    method: string,
    params: unknown,
    _timeoutMs: number,
    validate: (response: unknown) => void
  ) => {
    validate({
      ok: true,
      _meta: { runtimeId: 'runtime' },
      result: { capabilities: status.capabilities }
    })
    return sendRequest(pairing, method, params)
  }
}))

const { commitRemoteOctopodMigrationCatalog, stageRemoteOctopodMigrationBlobChunk } =
  await import('./octopod-migration-catalog-client')

const pairingCode = encodePairingOffer({
  v: PAIRING_OFFER_VERSION,
  endpoint: 'ws://127.0.0.1:46768/runtime',
  deviceToken: 'device-token',
  publicKeyB64: 'public-key',
  pairedDeviceId: 'paired-desktop'
})

const request: OctopodMigrationBlobChunkRequest = {
  migrationId: 'migration-blob',
  manifestSha256: 'a'.repeat(64),
  blob: {
    blobKind: 'shell-history',
    key: `${'b'.repeat(16)}-zsh`,
    sha256: 'c'.repeat(64),
    byteLength: 3
  },
  offset: 0,
  bytesBase64: 'YWJj'
}

beforeEach(() => {
  vi.clearAllMocks()
  sendRequest.mockResolvedValue({
    ok: true,
    _meta: { runtimeId: 'runtime' },
    result: {
      migrationId: request.migrationId,
      manifestSha256: request.manifestSha256,
      blobKind: 'shell-history',
      key: request.blob.key,
      receivedBytes: 3
    }
  })
})

describe('octopod migration blob chunk capability gate', () => {
  it.each([
    ['an older destination', [OCTOPOD_MIGRATION_CATALOG_RUNTIME_CAPABILITY]],
    [
      'a destination with only the channel',
      [OCTOPOD_MIGRATION_CATALOG_RUNTIME_CAPABILITY, OCTOPOD_MIGRATION_BLOB_CHANNEL_RUNTIME_CAPABILITY]
    ]
  ])('never sends a blob to %s, and names the kind', async (_, capabilities) => {
    status.capabilities = capabilities
    await expect(stageRemoteOctopodMigrationBlobChunk(pairingCode, request)).rejects.toThrow(
      /^octopod_migration_destination_blob_kind_unsupported:shell-history:/
    )
    expect(sendRequest).not.toHaveBeenCalled()
  })

  it('sends through its own method once the destination installs the kind', async () => {
    status.capabilities = [
      OCTOPOD_MIGRATION_CATALOG_RUNTIME_CAPABILITY,
      OCTOPOD_MIGRATION_BLOB_CHANNEL_RUNTIME_CAPABILITY,
      'octopod.migration-blob.shell-history.v1'
    ]
    await expect(stageRemoteOctopodMigrationBlobChunk(pairingCode, request)).resolves.toMatchObject({
      receivedBytes: 3
    })
    expect(sendRequest).toHaveBeenCalledWith(
      expect.anything(),
      'octopod.migration.stageBlobChunk',
      request
    )
  })
})

describe('octopod migration commit names its blob set', () => {
  const manifest: OctopodMigrationManifest = {
    version: OCTOPOD_MIGRATION_MANIFEST_VERSION,
    migrationId: request.migrationId,
    createdAt: '2026-08-30T12:00:00.000Z',
    source: {
      sshTargetId: 'source',
      sshTargetGeneration: 1,
      targetLabel: 'Source'
    },
    payload: { repositories: [], projectGroups: [], folderWorkspaces: [] },
    manifestSha256: request.manifestSha256
  }
  const expectedBlobs: OctopodMigrationBlobDescriptor[] = [request.blob]
  const installing = [
    OCTOPOD_MIGRATION_CATALOG_RUNTIME_CAPABILITY,
    OCTOPOD_MIGRATION_BLOB_CHANNEL_RUNTIME_CAPABILITY,
    'octopod.migration-blob.shell-history.v1'
  ]

  beforeEach(() => {
    sendRequest.mockResolvedValue({
      ok: true,
      _meta: { runtimeId: 'runtime' },
      result: {
        state: 'staged',
        migrationId: manifest.migrationId,
        manifestSha256: manifest.manifestSha256,
        stagedAt: '2026-08-30T12:00:00.000Z'
      }
    })
  })

  it('sends exactly `{ manifest }` when the move carried no blobs, even to a blob host', async () => {
    for (const capabilities of [[OCTOPOD_MIGRATION_CATALOG_RUNTIME_CAPABILITY], installing]) {
      status.capabilities = capabilities
      await commitRemoteOctopodMigrationCatalog(pairingCode, manifest)
      await commitRemoteOctopodMigrationCatalog(pairingCode, manifest, {
        expectedBlobs: []
      })
      expect(sendRequest).toHaveBeenLastCalledWith(
        expect.anything(),
        'octopod.migration.commitCatalog',
        { manifest }
      )
    }
  })

  it('names the blobs to a destination with the channel, and never to one without', async () => {
    status.capabilities = installing
    await commitRemoteOctopodMigrationCatalog(pairingCode, manifest, {
      expectedBlobs
    })
    expect(sendRequest).toHaveBeenLastCalledWith(
      expect.anything(),
      'octopod.migration.commitCatalog',
      { manifest, expectedBlobs }
    )

    sendRequest.mockClear()
    status.capabilities = [OCTOPOD_MIGRATION_CATALOG_RUNTIME_CAPABILITY]
    await expect(
      commitRemoteOctopodMigrationCatalog(pairingCode, manifest, {
        expectedBlobs
      })
    ).rejects.toThrow(/^octopod_migration_destination_blob_kind_unsupported:shell-history:/)
    expect(sendRequest).not.toHaveBeenCalled()
  })
})
