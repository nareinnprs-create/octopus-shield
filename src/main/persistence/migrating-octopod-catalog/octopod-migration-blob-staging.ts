// The manifest omits blobs; descriptor filenames make staged uploads resumable after restart.
import { readdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  OCTOPOD_MIGRATION_BLOB_KINDS,
  assertOctopodMigrationBlobSet,
  decodeOctopodMigrationBlobChunk,
  octopodMigrationBlobIdentity,
  parseOctopodMigrationBlobDescriptor,
  sameOctopodMigrationBlob,
  type OctopodMigrationBlobChunkRequest,
  type OctopodMigrationBlobChunkResult,
  type OctopodMigrationBlobDescriptor,
  type OctopodMigrationBlobKind,
  type OctopodMigrationBlobUploadState
} from '../../../shared/octopod-migration/octopod-migration-blob-transfer'
import type { OctopodMigrationManifest } from '../../../shared/octopod-migration/octopod-migration-manifest'
import { syncDirectoryDurablySync } from '../../durable-file-write'
import {
  appendOctopodMigrationStagedChunk,
  ensureOctopodMigrationDirectory,
  inspectOctopodMigrationFinalFile,
  linkOctopodMigrationStagedFile,
  octopodMigrationFileMatches,
  octopodMigrationStagedFileSize,
  octopodMigrationStagingDirectory,
  octopodMigrationStagingKey,
  pruneOctopodMigrationKeyedDirectories,
  pruneOctopodMigrationStagingDirectories,
  removeOctopodMigrationStagingDirectory,
  requireStagedOctopodMigrationManifest,
  type OctopodMigrationRequestIdentity
} from './octopod-migration-staged-file'

const RECEIVED_DIRECTORY = 'received'
const STAGED_BLOB_NAME = /^([^.]+)\.([a-f0-9]{64})\.([1-9][0-9]*)\.part$/

type OctopodMigrationBlobName = Pick<OctopodMigrationBlobDescriptor, 'blobKind' | 'key'>

type ReceivedBlobPathResolver = (
  root: string,
  manifest: OctopodMigrationRequestIdentity,
  descriptor: OctopodMigrationBlobName
) => string

const receivedDirectoryPath: ReceivedBlobPathResolver = (root, manifest, descriptor) =>
  join(receivedBlobsDirectory(root, manifest), descriptor.blobKind, descriptor.key)

const RECEIVED_BLOB_DESTINATIONS: Record<OctopodMigrationBlobKind, ReceivedBlobPathResolver> = {
  'terminal-restore-hints': receivedDirectoryPath,
  'shell-history': receivedDirectoryPath,
  'agent-session-records': receivedDirectoryPath
}

export function getOctopodMigrationReceivedBlobPath(
  root: string,
  manifest: OctopodMigrationRequestIdentity,
  descriptor: OctopodMigrationBlobName
): string {
  return RECEIVED_BLOB_DESTINATIONS[descriptor.blobKind](root, manifest, descriptor)
}

export function listOctopodMigrationReceivedBlobNames(
  root: string,
  manifest: OctopodMigrationRequestIdentity,
  blobKind: OctopodMigrationBlobKind
): string[] {
  return readDirectory(join(receivedBlobsDirectory(root, manifest), blobKind))
}

export type OctopodMigrationBlobChunkStaging = {
  stagedManifest: OctopodMigrationManifest | null
  root: string
  request: OctopodMigrationBlobChunkRequest
}

export function stageOctopodMigrationBlobChunk(
  args: OctopodMigrationBlobChunkStaging
): OctopodMigrationBlobChunkResult {
  const manifest = requireStagedOctopodMigrationManifest(
    args.stagedManifest,
    args.request,
    'octopod_migration_blob_catalog_not_staged'
  )
  const descriptor = parseOctopodMigrationBlobDescriptor(args.request.blob)
  const bytes = decodeOctopodMigrationBlobChunk(args.request.bytesBase64)
  const staged = stagedBlobDescriptors(args.root, manifest)
  const existing = staged.find(
    (entry) => octopodMigrationBlobIdentity(entry) === octopodMigrationBlobIdentity(descriptor)
  )
  if (existing && !sameOctopodMigrationBlob(existing, descriptor)) {
    // Replacing staged bytes requires abort and restage.
    throw new Error(`octopod_migration_blob_descriptor_conflict:${descriptor.blobKind}`)
  }
  if (!existing) {
    assertOctopodMigrationBlobSet([...staged, descriptor])
  }
  const path = stagedBlobPath(args.root, manifest, descriptor)
  ensureOctopodMigrationDirectory(dirname(path))
  const receivedBytes = appendOctopodMigrationStagedChunk({
    channel: 'blob',
    path,
    offset: args.request.offset,
    bytes,
    byteLength: descriptor.byteLength
  })
  return {
    migrationId: args.request.migrationId,
    manifestSha256: args.request.manifestSha256,
    blobKind: descriptor.blobKind,
    key: descriptor.key,
    receivedBytes
  }
}

export function inspectOctopodMigrationBlobUploads(
  manifest: OctopodMigrationManifest,
  root: string
): OctopodMigrationBlobUploadState[] | undefined {
  const uploads = stagedBlobDescriptors(root, manifest).map((descriptor) => ({
    ...descriptor,
    receivedBytes:
      inspectReceivedBlob(root, manifest, descriptor) === 'matching'
        ? descriptor.byteLength
        : octopodMigrationStagedFileSize(
            stagedBlobPath(root, manifest, descriptor),
            descriptor.byteLength
          )
  }))
  return uploads.length > 0 ? uploads : undefined
}

export function assertOctopodMigrationBlobsReady(
  manifest: OctopodMigrationManifest,
  root: string
): void {
  for (const upload of inspectOctopodMigrationBlobUploads(manifest, root) ?? []) {
    const label = `${upload.blobKind}:${upload.key}`
    const finalStatus = inspectReceivedBlob(root, manifest, upload)
    if (finalStatus === 'conflict') {
      throw new Error(`octopod_migration_blob_destination_conflict:${label}`)
    }
    if (upload.receivedBytes !== upload.byteLength) {
      throw new Error(`octopod_migration_blob_incomplete:${label}`)
    }
    if (
      finalStatus !== 'matching' &&
      !octopodMigrationFileMatches(stagedBlobPath(root, manifest, upload), upload)
    ) {
      throw new Error(`octopod_migration_blob_digest_mismatch:${label}`)
    }
  }
}

/** Verified staged files; call after assertOctopodMigrationBlobsReady in the same synchronous turn. */
export function stagedOctopodMigrationBlobFiles(
  manifest: OctopodMigrationManifest,
  root: string
): { descriptor: OctopodMigrationBlobDescriptor; path: string }[] {
  return stagedBlobDescriptors(root, manifest).map((descriptor) => ({
    descriptor,
    path: stagedBlobPath(root, manifest, descriptor)
  }))
}

/** Reject missing or extra blobs, including leftovers from another capture. */
export function assertOctopodMigrationBlobSetMatches(
  manifest: OctopodMigrationManifest,
  root: string,
  expected: readonly OctopodMigrationBlobDescriptor[]
): void {
  assertOctopodMigrationBlobSet(expected)
  const wanted = new Map(expected.map((entry) => [octopodMigrationBlobIdentity(entry), entry]))
  const staged = stagedBlobDescriptors(root, manifest)
  const stagedIds = new Set(staged.map(octopodMigrationBlobIdentity))
  for (const descriptor of staged) {
    const match = wanted.get(octopodMigrationBlobIdentity(descriptor))
    if (!match || !sameOctopodMigrationBlob(match, descriptor)) {
      throw blobSetMismatch(descriptor)
    }
  }
  for (const identity of receivedBlobIdentities(root, manifest)) {
    if (!wanted.has(identity)) {
      throw new Error('octopod_migration_blob_set_mismatch')
    }
  }
  for (const descriptor of expected) {
    // Previous commit attempts may have moved these bytes to received.
    if (
      !stagedIds.has(octopodMigrationBlobIdentity(descriptor)) &&
      inspectReceivedBlob(root, manifest, descriptor) !== 'matching'
    ) {
      throw blobSetMismatch(descriptor)
    }
  }
}

/** Call assertOctopodMigrationBlobsReady in the same synchronous turn so no chunk can change verified bytes. */
export function commitOctopodMigrationBlobs(manifest: OctopodMigrationManifest, root: string): void {
  const directories = new Set<string>()
  for (const descriptor of stagedBlobDescriptors(root, manifest)) {
    const finalPath = getOctopodMigrationReceivedBlobPath(root, manifest, descriptor)
    ensureOctopodMigrationDirectory(dirname(finalPath))
    linkOctopodMigrationStagedFile({
      stagedPath: stagedBlobPath(root, manifest, descriptor),
      finalPath,
      expected: descriptor,
      conflictError: `octopod_migration_blob_destination_conflict:${descriptor.blobKind}:${descriptor.key}`
    })
    directories.add(dirname(finalPath))
  }
  for (const directory of directories) {
    syncDirectoryDurablySync(directory)
  }
  removeOctopodMigrationStagingDirectory(root, manifest)
}

/** Also remove blobs moved by a commit that never landed. */
export function abortOctopodMigrationBlobs(manifest: OctopodMigrationManifest, root: string): void {
  removeOctopodMigrationStagingDirectory(root, manifest)
  rmSync(receivedBlobsDirectory(root, manifest), { recursive: true, force: true })
}

export function pruneOctopodMigrationBlobStaging(
  stagedManifests: readonly OctopodMigrationManifest[],
  committedMigrations: readonly OctopodMigrationRequestIdentity[],
  root: string
): void {
  pruneOctopodMigrationStagingDirectories(root, stagedManifests)
  pruneOctopodMigrationKeyedDirectories(join(root, RECEIVED_DIRECTORY), [
    ...stagedManifests,
    ...committedMigrations
  ])
}

function blobSetMismatch(descriptor: OctopodMigrationBlobDescriptor): Error {
  return new Error(`octopod_migration_blob_set_mismatch:${descriptor.blobKind}:${descriptor.key}`)
}

function receivedBlobIdentities(root: string, manifest: OctopodMigrationManifest): string[] {
  const received = receivedBlobsDirectory(root, manifest)
  return OCTOPOD_MIGRATION_BLOB_KINDS.flatMap((blobKind) =>
    readDirectory(join(received, blobKind)).map((key) =>
      octopodMigrationBlobIdentity({ blobKind, key })
    )
  )
}

function stagedBlobDescriptors(
  root: string,
  manifest: OctopodMigrationManifest
): OctopodMigrationBlobDescriptor[] {
  const staging = octopodMigrationStagingDirectory(root, manifest)
  const descriptors: OctopodMigrationBlobDescriptor[] = []
  for (const blobKind of OCTOPOD_MIGRATION_BLOB_KINDS) {
    for (const name of readDirectory(join(staging, blobKind))) {
      const match = STAGED_BLOB_NAME.exec(name)
      if (!match) {
        continue
      }
      try {
        descriptors.push(
          parseOctopodMigrationBlobDescriptor({
            blobKind,
            key: match[1],
            sha256: match[2],
            byteLength: Number(match[3])
          })
        )
      } catch {
        // Foreign names cannot belong to the staged set.
      }
    }
  }
  return descriptors
}

function readDirectory(path: string): string[] {
  try {
    return readdirSync(path).sort()
  } catch {
    return []
  }
}

function inspectReceivedBlob(
  root: string,
  manifest: OctopodMigrationManifest,
  descriptor: OctopodMigrationBlobDescriptor
): 'absent' | 'matching' | 'conflict' {
  return inspectOctopodMigrationFinalFile(
    getOctopodMigrationReceivedBlobPath(root, manifest, descriptor),
    descriptor
  )
}

function receivedBlobsDirectory(root: string, manifest: OctopodMigrationRequestIdentity): string {
  return join(root, RECEIVED_DIRECTORY, octopodMigrationStagingKey(manifest))
}

function stagedBlobPath(
  root: string,
  manifest: OctopodMigrationManifest,
  descriptor: OctopodMigrationBlobDescriptor
): string {
  return join(
    octopodMigrationStagingDirectory(root, manifest),
    descriptor.blobKind,
    `${descriptor.key}.${descriptor.sha256}.${descriptor.byteLength}.part`
  )
}
