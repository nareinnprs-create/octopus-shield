import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { OctopodMigrationManifest } from '../../../shared/octopod-migration/octopod-migration-manifest'
import {
  decodeOctopodMigrationSnapshotChunk,
  type OctopodMigrationSnapshotChunkRequest,
  type OctopodMigrationSnapshotChunkResult,
  type OctopodMigrationSnapshotUploadState,
  type OctopodMigrationTerminalScrollbackSnapshot
} from '../../../shared/octopod-migration/octopod-migration-scrollback'
import { syncDirectoryDurablySync } from '../../durable-file-write'
import {
  getTerminalScrollbackSnapshotPath,
  getTerminalScrollbackSnapshotRoot,
  type TerminalScrollbackSnapshotStorage
} from '../../terminal-scrollback-snapshots'
import {
  appendOctopodMigrationStagedChunk,
  ensureOctopodMigrationDirectory,
  inspectOctopodMigrationFinalFile,
  linkOctopodMigrationStagedFile,
  octopodMigrationFileMatches,
  octopodMigrationStagedFileSize,
  octopodMigrationStagingDirectory,
  pruneOctopodMigrationStagingDirectories,
  removeOctopodMigrationStagingDirectory,
  requireStagedOctopodMigrationManifest
} from './octopod-migration-staged-file'

/** Only the staged manifest's snapshots may receive chunks; retried ranges must match. */
export function stageOctopodMigrationSnapshotChunk(args: {
  stagedManifest: OctopodMigrationManifest | null
  storage: TerminalScrollbackSnapshotStorage
  request: OctopodMigrationSnapshotChunkRequest
}): OctopodMigrationSnapshotChunkResult {
  const manifest = requireStagedOctopodMigrationManifest(
    args.stagedManifest,
    args.request,
    'octopod_migration_snapshot_catalog_not_staged'
  )
  const descriptor = requireDescriptor(manifest, args.request.ref)
  const bytes = decodeOctopodMigrationSnapshotChunk(args.request.bytesBase64)
  ensureOctopodMigrationDirectory(stagingDirectory(args.storage, manifest))
  const acknowledgedOffset = appendOctopodMigrationStagedChunk({
    channel: 'snapshot',
    path: stagedSnapshotPath(args.storage, manifest, descriptor),
    offset: args.request.offset,
    bytes,
    byteLength: descriptor.byteLength
  })
  return {
    migrationId: args.request.migrationId,
    manifestSha256: args.request.manifestSha256,
    ref: args.request.ref,
    acknowledgedOffset
  }
}

export function inspectOctopodMigrationSnapshotUploads(
  manifest: OctopodMigrationManifest,
  storage: TerminalScrollbackSnapshotStorage
): OctopodMigrationSnapshotUploadState[] | undefined {
  const snapshots = manifest.payload.dormantState?.terminalScrollbackSnapshots ?? []
  if (snapshots.length === 0) {
    return undefined
  }
  return snapshots.map((descriptor) => ({
    ...descriptor,
    receivedBytes:
      inspectFinalSnapshot(storage, descriptor) === 'matching'
        ? descriptor.byteLength
        : octopodMigrationStagedFileSize(
            stagedSnapshotPath(storage, manifest, descriptor),
            descriptor.byteLength
          )
  }))
}

export function assertOctopodMigrationSnapshotsReady(
  manifest: OctopodMigrationManifest,
  storage: TerminalScrollbackSnapshotStorage
): void {
  for (const upload of inspectOctopodMigrationSnapshotUploads(manifest, storage) ?? []) {
    const finalStatus = inspectFinalSnapshot(storage, upload)
    if (finalStatus === 'conflict') {
      throw new Error(`octopod_migration_snapshot_destination_conflict:${upload.ref}`)
    }
    if (upload.receivedBytes !== upload.byteLength) {
      throw new Error(`octopod_migration_snapshot_incomplete:${upload.ref}`)
    }
    const path =
      finalStatus === 'matching'
        ? getTerminalScrollbackSnapshotPath(upload.ref, storage)
        : stagedSnapshotPath(storage, manifest, upload)
    if (!path || !octopodMigrationFileMatches(path, upload)) {
      throw new Error(`octopod_migration_snapshot_digest_mismatch:${upload.ref}`)
    }
  }
}

export function commitOctopodMigrationSnapshots(
  manifest: OctopodMigrationManifest,
  storage: TerminalScrollbackSnapshotStorage
): void {
  const snapshots = manifest.payload.dormantState?.terminalScrollbackSnapshots ?? []
  assertOctopodMigrationSnapshotsReady(manifest, storage)
  const root = getTerminalScrollbackSnapshotRoot(storage)
  mkdirSync(root, { recursive: true, mode: 0o700 })
  for (const descriptor of snapshots) {
    const finalPath = getTerminalScrollbackSnapshotPath(descriptor.ref, storage)
    if (!finalPath) {
      throw new Error('octopod_migration_snapshot_ref_invalid')
    }
    linkOctopodMigrationStagedFile({
      stagedPath: stagedSnapshotPath(storage, manifest, descriptor),
      finalPath,
      expected: descriptor,
      conflictError: `octopod_migration_snapshot_destination_conflict:${descriptor.ref}`
    })
  }
  syncDirectoryDurablySync(root)
  removeOctopodMigrationStagingDirectory(root, manifest)
}

export function abortOctopodMigrationSnapshots(
  manifest: OctopodMigrationManifest,
  storage: TerminalScrollbackSnapshotStorage
): void {
  removeOctopodMigrationStagingDirectory(getTerminalScrollbackSnapshotRoot(storage), manifest)
}

export function pruneOctopodMigrationSnapshotStaging(
  stagedManifests: readonly OctopodMigrationManifest[],
  storage: TerminalScrollbackSnapshotStorage
): void {
  pruneOctopodMigrationStagingDirectories(getTerminalScrollbackSnapshotRoot(storage), stagedManifests)
}

function requireDescriptor(
  manifest: OctopodMigrationManifest,
  ref: string
): OctopodMigrationTerminalScrollbackSnapshot {
  const descriptor = manifest.payload.dormantState?.terminalScrollbackSnapshots?.find(
    (entry) => entry.ref === ref
  )
  if (!descriptor) {
    throw new Error('octopod_migration_snapshot_unknown')
  }
  return descriptor
}

function inspectFinalSnapshot(
  storage: TerminalScrollbackSnapshotStorage,
  descriptor: OctopodMigrationTerminalScrollbackSnapshot
): 'absent' | 'matching' | 'conflict' {
  return inspectOctopodMigrationFinalFile(
    getTerminalScrollbackSnapshotPath(descriptor.ref, storage),
    descriptor
  )
}

function stagingDirectory(
  storage: TerminalScrollbackSnapshotStorage,
  manifest: OctopodMigrationManifest
): string {
  return octopodMigrationStagingDirectory(getTerminalScrollbackSnapshotRoot(storage), manifest)
}

function stagedSnapshotPath(
  storage: TerminalScrollbackSnapshotStorage,
  manifest: OctopodMigrationManifest,
  descriptor: OctopodMigrationTerminalScrollbackSnapshot
): string {
  return join(stagingDirectory(storage, manifest), `${descriptor.ref}.${descriptor.sha256}.part`)
}
