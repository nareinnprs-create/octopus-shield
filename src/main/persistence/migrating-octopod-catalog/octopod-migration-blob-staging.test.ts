import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { OctopodMigrationBlobDescriptor } from '../../../shared/octopod-migration/octopod-migration-blob-transfer'
import { OCTOPOD_MIGRATION_MANIFEST_VERSION } from '../../../shared/octopod-migration/octopod-migration-manifest-validation'
import type { OctopodMigrationManifest } from '../../../shared/octopod-migration/octopod-migration-manifest'
import {
  abortOctopodMigrationBlobs,
  assertOctopodMigrationBlobSetMatches,
  assertOctopodMigrationBlobsReady,
  commitOctopodMigrationBlobs,
  getOctopodMigrationReceivedBlobPath,
  inspectOctopodMigrationBlobUploads,
  pruneOctopodMigrationBlobStaging,
  stageOctopodMigrationBlobChunk
} from './octopod-migration-blob-staging'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'octopod-migration-blobs-'))
})

afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('octopod migration blob staging', () => {
  it('stages, reloads progress from disk, and accepts only exact retries', () => {
    const bytes = Buffer.from('echo one\necho two 🐋\n', 'utf8')
    const descriptor = blob('shell-history', `${'a'.repeat(16)}-zsh`, bytes)
    const manifest = migrationManifest('resume')
    const first = bytes.subarray(0, 9)

    expect(stage(manifest, descriptor, 0, first).receivedBytes).toBe(first.length)
    // Restart recovery must depend only on the directory.
    expect(inspectOctopodMigrationBlobUploads(manifest, root)).toEqual([
      { ...descriptor, receivedBytes: first.length }
    ])
    expect(stage(manifest, descriptor, 0, first).receivedBytes).toBe(first.length)
    expect(() => stage(manifest, descriptor, 0, Buffer.from('different'))).toThrow(
      'octopod_migration_blob_retry_mismatch'
    )
    expect(() => stage(manifest, descriptor, first.length + 1, Buffer.from('x'))).toThrow(
      'octopod_migration_blob_offset_invalid'
    )
    expect(() => stage(manifest, descriptor, first.length, bytes)).toThrow(
      'octopod_migration_blob_offset_invalid'
    )
    stage(manifest, descriptor, first.length, bytes.subarray(first.length))

    assertOctopodMigrationBlobsReady(manifest, root)
    commitOctopodMigrationBlobs(manifest, root)
    expect(readFileSync(getOctopodMigrationReceivedBlobPath(root, manifest, descriptor))).toEqual(
      bytes
    )
    expect(inspectOctopodMigrationBlobUploads(manifest, root)).toBeUndefined()
  })

  it('refuses a chunk for a migration the importer does not hold staged', () => {
    const descriptor = blob('terminal-restore-hints', 'migration', Buffer.from('{}'))
    const manifest = migrationManifest('unstaged')
    expect(() =>
      stageOctopodMigrationBlobChunk({
        stagedManifest: null,
        root,
        request: request(manifest, descriptor, 0, Buffer.from('{}'))
      })
    ).toThrow('octopod_migration_blob_catalog_not_staged')
    expect(() =>
      stageOctopodMigrationBlobChunk({
        stagedManifest: { ...manifest, manifestSha256: 'e'.repeat(64) },
        root,
        request: request(manifest, descriptor, 0, Buffer.from('{}'))
      })
    ).toThrow('octopod_migration_blob_catalog_not_staged')
  })

  it('never replaces a staged key with different bytes', () => {
    const manifest = migrationManifest('conflict')
    const original = blob('agent-session-records', 'session-1', Buffer.from('original'))
    stage(manifest, original, 0, Buffer.from('orig'))
    const recaptured = blob('agent-session-records', 'session-1', Buffer.from('recaptured'))

    expect(() => stage(manifest, recaptured, 0, Buffer.from('reca'))).toThrow(
      'octopod_migration_blob_descriptor_conflict:agent-session-records'
    )
    expect(inspectOctopodMigrationBlobUploads(manifest, root)).toEqual([
      { ...original, receivedBytes: 4 }
    ])
  })

  it('refuses commit while a blob is incomplete or its bytes do not match the digest', () => {
    const bytes = Buffer.from('expected bytes')
    const descriptor = blob('shell-history', `${'b'.repeat(16)}-bash`, bytes)
    const manifest = migrationManifest('refuse')

    stage(manifest, descriptor, 0, bytes.subarray(0, 4))
    expect(() => assertOctopodMigrationBlobsReady(manifest, root)).toThrow(
      `octopod_migration_blob_incomplete:shell-history:${descriptor.key}`
    )
    stage(manifest, descriptor, 4, Buffer.alloc(bytes.length - 4, 0x78))
    expect(() => assertOctopodMigrationBlobsReady(manifest, root)).toThrow(
      'octopod_migration_blob_digest_mismatch'
    )
    expect(existsSync(getOctopodMigrationReceivedBlobPath(root, manifest, descriptor))).toBe(false)
  })

  it('treats a matching received file as done and a different one as a conflict', () => {
    const bytes = Buffer.from('hints')
    const descriptor = blob('terminal-restore-hints', 'migration', bytes)
    const manifest = migrationManifest('received')
    stage(manifest, descriptor, 0, bytes)
    const finalPath = getOctopodMigrationReceivedBlobPath(root, manifest, descriptor)
    mkdirSync(dirname(finalPath), { recursive: true })
    writeFileSync(finalPath, 'other')

    expect(() => commitOctopodMigrationBlobs(manifest, root)).toThrow(
      'octopod_migration_blob_destination_conflict:terminal-restore-hints:migration'
    )
    writeFileSync(finalPath, bytes)
    assertOctopodMigrationBlobsReady(manifest, root)
    commitOctopodMigrationBlobs(manifest, root)
    expect(readFileSync(finalPath)).toEqual(bytes)
  })

  it('aborts one migration, keeps another, and prunes migrations no longer staged', () => {
    const bytes = Buffer.from('staged')
    const descriptor = blob('agent-session-records', 'session-2', bytes)
    const first = migrationManifest('abort-first')
    const second = migrationManifest('retain-second')
    stage(first, descriptor, 0, bytes)
    stage(second, descriptor, 0, bytes)

    abortOctopodMigrationBlobs(first, root)
    expect(inspectOctopodMigrationBlobUploads(first, root)).toBeUndefined()
    expect(inspectOctopodMigrationBlobUploads(second, root)?.[0]?.receivedBytes).toBe(bytes.length)
    pruneOctopodMigrationBlobStaging([second], [], root)
    expect(inspectOctopodMigrationBlobUploads(second, root)?.[0]?.receivedBytes).toBe(bytes.length)
    pruneOctopodMigrationBlobStaging([], [], root)
    expect(inspectOctopodMigrationBlobUploads(second, root)).toBeUndefined()
  })

  it('prunes received blobs whose migration is neither staged nor committed', () => {
    const bytes = Buffer.from('moved')
    const descriptor = blob('shell-history', `${'e'.repeat(16)}-fish`, bytes)
    const leaked = migrationManifest('failed-commit')
    const staged = migrationManifest('still-staged')
    const committed = migrationManifest('committed')
    for (const manifest of [leaked, staged, committed]) {
      stage(manifest, descriptor, 0, bytes)
      commitOctopodMigrationBlobs(manifest, root)
    }
    const receivedPath = (manifest: OctopodMigrationManifest) =>
      getOctopodMigrationReceivedBlobPath(root, manifest, descriptor)

    pruneOctopodMigrationBlobStaging(
      [staged],
      [
        {
          migrationId: committed.migrationId,
          manifestSha256: committed.manifestSha256
        }
      ],
      root
    )
    expect(existsSync(receivedPath(leaked))).toBe(false)
    expect(existsSync(receivedPath(staged))).toBe(true)
    expect(existsSync(receivedPath(committed))).toBe(true)
  })

  it('commits only when staged plus received blobs are exactly the expected set', () => {
    const historyBytes = Buffer.from('history')
    const recordBytes = Buffer.from('record')
    const history = blob('shell-history', `${'f'.repeat(16)}-zsh`, historyBytes)
    const record = blob('agent-session-records', 'session-3', recordBytes)
    const manifest = migrationManifest('expected-set')
    stage(manifest, history, 0, historyBytes)

    expect(() => assertOctopodMigrationBlobSetMatches(manifest, root, [history, record])).toThrow(
      'octopod_migration_blob_set_mismatch:agent-session-records:session-3'
    )
    expect(() => assertOctopodMigrationBlobSetMatches(manifest, root, [])).toThrow(
      `octopod_migration_blob_set_mismatch:shell-history:${history.key}`
    )
    expect(() =>
      assertOctopodMigrationBlobSetMatches(manifest, root, [{ ...history, sha256: 'f'.repeat(64) }])
    ).toThrow('octopod_migration_blob_set_mismatch')
    stage(manifest, record, 0, recordBytes)
    assertOctopodMigrationBlobSetMatches(manifest, root, [history, record])

    // Retried commits must include blobs already moved to received.
    commitOctopodMigrationBlobs(manifest, root)
    assertOctopodMigrationBlobSetMatches(manifest, root, [history, record])
    expect(() => assertOctopodMigrationBlobSetMatches(manifest, root, [history])).toThrow(
      'octopod_migration_blob_set_mismatch'
    )
  })

  it('drops blobs an earlier commit attempt moved when the catalog is aborted', () => {
    const bytes = Buffer.from('history')
    const descriptor = blob('shell-history', `${'c'.repeat(16)}-zsh`, bytes)
    const manifest = migrationManifest('abort-after-move')
    stage(manifest, descriptor, 0, bytes)
    commitOctopodMigrationBlobs(manifest, root)

    abortOctopodMigrationBlobs(manifest, root)
    expect(existsSync(getOctopodMigrationReceivedBlobPath(root, manifest, descriptor))).toBe(false)
  })
})

function blob(
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

function migrationManifest(migrationId: string): OctopodMigrationManifest {
  return {
    version: OCTOPOD_MIGRATION_MANIFEST_VERSION,
    migrationId,
    createdAt: '2026-08-30T12:00:00.000Z',
    source: { sshTargetId: 'source', sshTargetGeneration: 1, targetLabel: 'Source' },
    payload: { repositories: [], projectGroups: [], folderWorkspaces: [] },
    manifestSha256: 'a'.repeat(64)
  }
}

function request(
  manifest: OctopodMigrationManifest,
  descriptor: OctopodMigrationBlobDescriptor,
  offset: number,
  bytes: Buffer
) {
  return {
    migrationId: manifest.migrationId,
    manifestSha256: manifest.manifestSha256,
    blob: descriptor,
    offset,
    bytesBase64: bytes.toString('base64')
  }
}

function stage(
  manifest: OctopodMigrationManifest,
  descriptor: OctopodMigrationBlobDescriptor,
  offset: number,
  bytes: Buffer
) {
  return stageOctopodMigrationBlobChunk({
    stagedManifest: manifest,
    root,
    request: request(manifest, descriptor, offset, bytes)
  })
}
