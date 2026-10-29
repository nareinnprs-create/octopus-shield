import { describe, expect, it } from 'vitest'
import {
  MAX_OCTOPOD_MIGRATION_BLOB_TOTAL_BYTES,
  OCTOPOD_MIGRATION_BLOB_KIND_CONTRACTS,
  OctopodMigrationBlobChunkRequestSchema,
  OctopodMigrationBlobDescriptorSchema,
  assertOctopodMigrationBlobSet,
  findUnsupportedMigrationBlobKind,
  octopodMigrationBlobKindUnsupportedBlocker,
  parseOctopodMigrationBlobChunkResult,
  parseOctopodMigrationBlobDescriptor,
  parseOctopodMigrationBlobUploadStates,
  requiredMigrationBlobCapabilities,
  type OctopodMigrationBlobDescriptor
} from './octopod-migration-blob-transfer'
import { parseOctopodMigrationCatalogState } from './octopod-migration-catalog-state'
import { OCTOPOD_MIGRATION_MANIFEST_VERSION } from './octopod-migration-manifest-validation'
import type { OctopodMigrationManifest } from './octopod-migration-manifest'
import { OCTOPOD_MIGRATION_BLOB_CHANNEL_RUNTIME_CAPABILITY } from '../octopod-runtime-capabilities'

const HASH = 'a'.repeat(16)
const DIGEST = 'b'.repeat(64)

function blob(overrides: Partial<OctopodMigrationBlobDescriptor> = {}): OctopodMigrationBlobDescriptor {
  return {
    blobKind: 'shell-history',
    key: `${HASH}-zsh`,
    sha256: DIGEST,
    byteLength: 10,
    ...overrides
  }
}

const manifest: OctopodMigrationManifest = {
  version: OCTOPOD_MIGRATION_MANIFEST_VERSION,
  migrationId: 'migration-1',
  manifestSha256: 'c'.repeat(64),
  createdAt: '2026-08-30T12:00:00.000Z',
  source: { sshTargetId: 'ssh-prod', sshTargetGeneration: 7, targetLabel: 'Production' },
  payload: { repositories: [], projectGroups: [], folderWorkspaces: [] }
}

describe('octopod migration blob contract', () => {
  it.each([
    ['terminal-restore-hints', 'migration', true],
    ['terminal-restore-hints', HASH, false],
    ['shell-history', `${HASH}-bash`, true],
    ['shell-history', `${HASH}-fish`, true],
    ['shell-history', `${HASH}-pwsh`, false],
    ['shell-history', `${'A'.repeat(16)}-zsh`, false],
    ['shell-history', `${HASH}.zsh`, false],
    ['agent-session-records', '0f8e2c1a-7b3d-4e5f-9a0b-1c2d3e4f5a6b', true],
    ['agent-session-records', 'Session-Mixed-Case', false],
    ['agent-session-records', '../escape', false],
    ['agent-session-records', 'a.b', false],
    ['agent-session-records', 'x'.repeat(129), false],
    // Windows device names: one with any extension is the device too.
    ['agent-session-records', 'con', false],
    ['agent-session-records', 'prn', false],
    ['agent-session-records', 'aux', false],
    ['agent-session-records', 'nul', false],
    ['agent-session-records', 'com0', false],
    ['agent-session-records', 'com9', false],
    ['agent-session-records', 'lpt1', false],
    ['agent-session-records', 'console', true],
    ['agent-session-records', 'com10', true],
    ['agent-session-records', 'nul-1', true]
  ] as const)('%s key %s valid=%s', (blobKind, key, valid) => {
    const parse = () => parseOctopodMigrationBlobDescriptor(blob({ blobKind, key }))
    if (valid) {
      expect(parse().key).toBe(key)
    } else {
      expect(parse).toThrow('octopod_migration_blob_key_invalid')
    }
  })

  it('enforces per-kind byte caps, a non-empty body, and the set caps', () => {
    const cap = OCTOPOD_MIGRATION_BLOB_KIND_CONTRACTS['terminal-restore-hints'].maxBytes
    const hints = blob({ blobKind: 'terminal-restore-hints', key: 'migration' })
    expect(parseOctopodMigrationBlobDescriptor({ ...hints, byteLength: cap }).byteLength).toBe(cap)
    expect(() => parseOctopodMigrationBlobDescriptor({ ...hints, byteLength: cap + 1 })).toThrow(
      'octopod_migration_blob_too_large'
    )
    expect(() => parseOctopodMigrationBlobDescriptor(blob({ byteLength: 0 }))).toThrow()
    expect(() => assertOctopodMigrationBlobSet([blob(), blob({ sha256: 'd'.repeat(64) })])).toThrow(
      'octopod_migration_blob_duplicate'
    )
    const big = OCTOPOD_MIGRATION_BLOB_KIND_CONTRACTS['shell-history'].maxBytes
    const many = Array.from({ length: MAX_OCTOPOD_MIGRATION_BLOB_TOTAL_BYTES / big + 1 }, (_, i) =>
      blob({ key: `${i.toString(16).padStart(16, '0')}-zsh`, byteLength: big })
    )
    expect(() => assertOctopodMigrationBlobSet(many)).toThrow('octopod_migration_blobs_too_large')
  })

  it('requires the channel plus each sent kind, and names the first missing kind', () => {
    const hints = blob({ blobKind: 'terminal-restore-hints', key: 'migration' })
    expect(requiredMigrationBlobCapabilities([])).toEqual([])
    expect(requiredMigrationBlobCapabilities([blob(), hints, blob()])).toEqual([
      OCTOPOD_MIGRATION_BLOB_CHANNEL_RUNTIME_CAPABILITY,
      'octopod.migration-blob.terminal-restore-hints.v1',
      'octopod.migration-blob.shell-history.v1'
    ])
    const all = requiredMigrationBlobCapabilities([blob(), hints])
    expect(findUnsupportedMigrationBlobKind([blob(), hints], all)).toBeNull()
    expect(
      findUnsupportedMigrationBlobKind(
        [blob(), hints],
        all.filter((entry) => entry !== OCTOPOD_MIGRATION_BLOB_CHANNEL_RUNTIME_CAPABILITY)
      )
    ).toBe('shell-history')
    expect(
      findUnsupportedMigrationBlobKind(
        [blob(), hints],
        [OCTOPOD_MIGRATION_BLOB_CHANNEL_RUNTIME_CAPABILITY, 'octopod.migration-blob.shell-history.v1']
      )
    ).toBe('terminal-restore-hints')
    expect(octopodMigrationBlobKindUnsupportedBlocker('shell-history')).toMatch(
      /^octopod_migration_destination_blob_kind_unsupported:shell-history:/
    )
  })

  // Drafts stay on each desktop; a chunk from a build that once shed them is refused, not stored.
  it('refuses the retired editor-drafts kind', () => {
    expect(
      OctopodMigrationBlobDescriptorSchema.safeParse({
        blobKind: 'editor-drafts',
        key: 'drafts',
        sha256: 'b'.repeat(64),
        byteLength: 4
      }).success
    ).toBe(false)
  })

  it('keeps unknown request fields out and checks the acknowledged length', () => {
    const request = OctopodMigrationBlobChunkRequestSchema.parse({
      migrationId: manifest.migrationId,
      manifestSha256: manifest.manifestSha256,
      blob: blob(),
      offset: 4,
      bytesBase64: 'YWJj',
      futureField: true
    })
    expect(request).not.toHaveProperty('futureField')
    const result = {
      migrationId: manifest.migrationId,
      manifestSha256: manifest.manifestSha256,
      blobKind: 'shell-history',
      key: `${HASH}-zsh`,
      receivedBytes: 7
    }
    expect(parseOctopodMigrationBlobChunkResult(result, request).receivedBytes).toBe(7)
    expect(() =>
      parseOctopodMigrationBlobChunkResult({ ...result, receivedBytes: 6 }, request)
    ).toThrow('octopod_migration_blob_chunk_result_invalid')
  })

  it('parses upload states strictly and treats an absent list as nothing staged', () => {
    expect(parseOctopodMigrationBlobUploadStates(undefined)).toBeUndefined()
    expect(parseOctopodMigrationBlobUploadStates([{ ...blob(), receivedBytes: 3 }])).toEqual([
      { ...blob(), receivedBytes: 3 }
    ])
    expect(() => parseOctopodMigrationBlobUploadStates([{ ...blob(), receivedBytes: 11 }])).toThrow(
      'octopod_migration_blob_state_invalid'
    )
    expect(() => parseOctopodMigrationBlobUploadStates({})).toThrow(
      'octopod_migration_blob_state_invalid'
    )
  })
})

describe('octopod migration catalog state with blob uploads', () => {
  const staged = {
    state: 'staged',
    migrationId: manifest.migrationId,
    manifestSha256: manifest.manifestSha256,
    stagedAt: '2026-08-30T12:01:00.000Z'
  }

  it('still accepts a staged state from a host that predates blobs', () => {
    expect(parseOctopodMigrationCatalogState(staged, manifest)).toEqual(staged)
  })

  it('carries blob uploads from a host that has them', () => {
    const uploads = [{ ...blob(), receivedBytes: 10 }]
    expect(parseOctopodMigrationCatalogState({ ...staged, blobUploads: uploads }, manifest)).toEqual({
      ...staged,
      blobUploads: uploads
    })
    expect(() =>
      parseOctopodMigrationCatalogState(
        { ...staged, blobUploads: [{ ...blob({ key: 'bad' }), receivedBytes: 0 }] },
        manifest
      )
    ).toThrow('octopod_migration_blob_key_invalid')
  })
})
