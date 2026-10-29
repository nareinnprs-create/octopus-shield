// Fsync staged appends, verify retried ranges, and commit digest-checked files by hard link.
import { createHash } from 'node:crypto'
import {
  closeSync,
  existsSync,
  fsyncSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  rmSync,
  statSync,
  writeSync
} from 'node:fs'
import { join } from 'node:path'
import type { OctopodMigrationManifest } from '../../../shared/octopod-migration/octopod-migration-manifest'
import { syncDirectoryDurablySync } from '../../durable-file-write'

export const OCTOPOD_MIGRATION_STAGING_DIRECTORY = '.octopod-migration-staging'

/** Selects error codes such as octopod_migration_<channel>_offset_invalid. */
export type OctopodMigrationStagingChannel = 'snapshot' | 'blob'

export type OctopodMigrationRequestIdentity = { migrationId: string; manifestSha256: string }

export type OctopodMigrationStagedContent = { sha256: string; byteLength: number }

export type OctopodMigrationStagedChunk = {
  channel: OctopodMigrationStagingChannel
  path: string
  offset: number
  bytes: Buffer
  byteLength: number
}

/** Retried ranges must match; returns staged size. */
export function appendOctopodMigrationStagedChunk(chunk: OctopodMigrationStagedChunk): number {
  const { channel, path, offset, bytes } = chunk
  const descriptorFd = openStagedFile(path)
  try {
    const size = statSync(path).size
    if (offset > size || offset + bytes.length > chunk.byteLength) {
      throw new Error(`octopod_migration_${channel}_offset_invalid`)
    }
    if (offset < size) {
      if (offset + bytes.length > size) {
        throw new Error(`octopod_migration_${channel}_offset_invalid`)
      }
      const existing = Buffer.alloc(bytes.length)
      const read = readSync(descriptorFd, existing, 0, existing.length, offset)
      if (read !== bytes.length || !existing.equals(bytes)) {
        throw new Error(`octopod_migration_${channel}_retry_mismatch`)
      }
      return size
    }
    const written = writeSync(descriptorFd, bytes, 0, bytes.length, offset)
    if (written !== bytes.length) {
      throw new Error(`octopod_migration_${channel}_write_incomplete`)
    }
    fsyncSync(descriptorFd)
    return size + bytes.length
  } finally {
    closeSync(descriptorFd)
  }
}

export function octopodMigrationStagedFileSize(path: string, byteLength: number): number {
  try {
    return Math.min(statSync(path).size, byteLength)
  } catch {
    return 0
  }
}

export function octopodMigrationFileMatches(
  path: string,
  expected: OctopodMigrationStagedContent
): boolean {
  try {
    const bytes = readFileSync(path)
    return (
      bytes.length === expected.byteLength &&
      createHash('sha256').update(bytes).digest('hex') === expected.sha256
    )
  } catch {
    return false
  }
}

export function inspectOctopodMigrationFinalFile(
  path: string | null,
  expected: OctopodMigrationStagedContent
): 'absent' | 'matching' | 'conflict' {
  if (!path || !existsSync(path)) {
    return 'absent'
  }
  return octopodMigrationFileMatches(path, expected) ? 'matching' : 'conflict'
}

/** An identical final file makes a retried hard-link commit succeed; different bytes refuse. */
export function linkOctopodMigrationStagedFile(args: {
  stagedPath: string
  finalPath: string
  expected: OctopodMigrationStagedContent
  conflictError: string
}): void {
  if (inspectOctopodMigrationFinalFile(args.finalPath, args.expected) !== 'matching') {
    try {
      linkSync(args.stagedPath, args.finalPath)
    } catch (error) {
      const finalStatus = inspectOctopodMigrationFinalFile(args.finalPath, args.expected)
      if (finalStatus === 'conflict') {
        throw new Error(args.conflictError)
      }
      if (finalStatus !== 'matching') {
        throw error
      }
    }
  }
  rmSync(args.stagedPath, { force: true })
}

export function octopodMigrationStagingDirectory(
  root: string,
  manifest: OctopodMigrationManifest
): string {
  return join(root, OCTOPOD_MIGRATION_STAGING_DIRECTORY, octopodMigrationStagingKey(manifest))
}

export function ensureOctopodMigrationDirectory(path: string): void {
  mkdirSync(path, { recursive: true, mode: 0o700 })
}

export function removeOctopodMigrationStagingDirectory(
  root: string,
  manifest: OctopodMigrationManifest
): void {
  rmSync(octopodMigrationStagingDirectory(root, manifest), { recursive: true, force: true })
  syncDirectoryDurablySync(join(root, OCTOPOD_MIGRATION_STAGING_DIRECTORY))
}

export function pruneOctopodMigrationStagingDirectories(
  root: string,
  stagedManifests: readonly OctopodMigrationManifest[]
): void {
  pruneOctopodMigrationKeyedDirectories(
    join(root, OCTOPOD_MIGRATION_STAGING_DIRECTORY),
    stagedManifests
  )
}

export function pruneOctopodMigrationKeyedDirectories(
  parent: string,
  retainedMigrations: readonly OctopodMigrationRequestIdentity[]
): void {
  const retained = new Set(retainedMigrations.map(octopodMigrationStagingKey))
  let entries: string[]
  try {
    entries = readdirSync(parent)
  } catch {
    return
  }
  for (const entry of entries) {
    if (/^[a-f0-9]{32}$/.test(entry) && !retained.has(entry)) {
      rmSync(join(parent, entry), { recursive: true, force: true })
    }
  }
}

/** Refuse through the channel's error if its staged manifest does not match. */
export function requireStagedOctopodMigrationManifest(
  staged: OctopodMigrationManifest | null,
  request: OctopodMigrationRequestIdentity,
  notStagedError: string
): OctopodMigrationManifest {
  if (
    !staged ||
    staged.migrationId !== request.migrationId ||
    staged.manifestSha256 !== request.manifestSha256
  ) {
    throw new Error(notStagedError)
  }
  return staged
}

export function octopodMigrationStagingKey(manifest: OctopodMigrationRequestIdentity): string {
  return createHash('sha256')
    .update(`${manifest.migrationId}\0${manifest.manifestSha256}`)
    .digest('hex')
    .slice(0, 32)
}

function openStagedFile(path: string): number {
  try {
    return openSync(path, 'r+')
  } catch {
    try {
      return openSync(path, 'wx+', 0o600)
    } catch {
      return openSync(path, 'r+')
    }
  }
}
