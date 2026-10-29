/** Opaque migration blobs travel beside the signed catalog. Gate each kind by its destination capability:
 * older destinations drop unknown kinds, so clients must refuse before staging. */
import { z } from 'zod'
import {
  OCTOPOD_MIGRATION_SCROLLBACK_CHUNK_BYTES,
  OctopodMigrationChunkBase64Schema,
  OctopodMigrationDigestSchema,
  OctopodMigrationIdentitySchema,
  decodeOctopodMigrationChunk
} from './octopod-migration-scrollback'
import { requiredRecord } from './octopod-migration-dormant-value-validation'
import { assertUniqueKeys } from './octopod-migration-manifest-fields'
import { OCTOPOD_MIGRATION_BLOB_CHANNEL_RUNTIME_CAPABILITY } from '../octopod-runtime-capabilities'

export const OCTOPOD_MIGRATION_BLOB_KINDS = [
  'terminal-restore-hints',
  'shell-history',
  'agent-session-records'
] as const

export type OctopodMigrationBlobKind = (typeof OCTOPOD_MIGRATION_BLOB_KINDS)[number]

type OctopodMigrationBlobKindContract = {
  /** Filename-safe, dot-free and lowercase, so a key is one path segment on any filesystem. */
  key: RegExp
  maxBytes: number
  capability: string
}

const MIB = 1024 * 1024

export const OCTOPOD_MIGRATION_BLOB_KIND_CONTRACTS: Record<
  OctopodMigrationBlobKind,
  OctopodMigrationBlobKindContract
> = {
  // One JSON document per migration; the received directory already scopes it to the migration.
  'terminal-restore-hints': {
    key: /^migration$/,
    maxBytes: 4 * MIB,
    capability: 'octopod.migration-blob.terminal-restore-hints.v1'
  },
  // `hashWorktreeId` (16 hex) plus the shell whose history file it is.
  'shell-history': {
    key: /^[a-f0-9]{16}-(?:zsh|bash|fish)$/,
    maxBytes: 64 * MIB,
    capability: 'octopod.migration-blob.shell-history.v1'
  },
  // The agent session id; agent CLIs mint lowercase UUID-like ids.
  'agent-session-records': {
    key: /^[a-z0-9][a-z0-9_-]{0,127}$/,
    maxBytes: 64 * MIB,
    capability: 'octopod.migration-blob.agent-session-records.v1'
  }
}

// The same bound the shared chunk decoder enforces for both channels.
export const OCTOPOD_MIGRATION_BLOB_CHUNK_BYTES = OCTOPOD_MIGRATION_SCROLLBACK_CHUNK_BYTES
export const MAX_OCTOPOD_MIGRATION_BLOBS = 1024
export const MAX_OCTOPOD_MIGRATION_BLOB_TOTAL_BYTES = 256 * MIB

/** Byte-for-byte what the destination must hold; empty content is sent as no blob at all. */
export type OctopodMigrationBlobDescriptor = {
  blobKind: OctopodMigrationBlobKind
  key: string
  sha256: string
  byteLength: number
}

export type OctopodMigrationBlobUploadState = OctopodMigrationBlobDescriptor & {
  receivedBytes: number
}

export const OCTOPOD_MIGRATION_DESTINATION_BLOB_KIND_UNSUPPORTED =
  'octopod_migration_destination_blob_kind_unsupported'

// Windows refuses these as file names whatever the extension, so a key must never be one.
const WINDOWS_RESERVED_FILE_NAME = /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\..*)?$/i

export const OctopodMigrationBlobDescriptorSchema = z
  .object({
    blobKind: z.enum(OCTOPOD_MIGRATION_BLOB_KINDS),
    key: z.string().max(256),
    sha256: OctopodMigrationDigestSchema,
    byteLength: z.number().int().min(1)
  })
  .superRefine((value, context) => {
    const contract = OCTOPOD_MIGRATION_BLOB_KIND_CONTRACTS[value.blobKind]
    if (!contract.key.test(value.key) || WINDOWS_RESERVED_FILE_NAME.test(value.key)) {
      context.addIssue({
        code: 'custom',
        message: 'octopod_migration_blob_key_invalid'
      })
    }
    if (value.byteLength > contract.maxBytes) {
      context.addIssue({ code: 'custom', message: 'octopod_migration_blob_too_large' })
    }
  })

// Not strict: an older host must ignore optional fields a newer client adds.
export const OctopodMigrationBlobChunkRequestSchema = z.object({
  migrationId: OctopodMigrationIdentitySchema,
  manifestSha256: OctopodMigrationDigestSchema,
  blob: OctopodMigrationBlobDescriptorSchema,
  offset: z.number().int().nonnegative().max(MAX_OCTOPOD_MIGRATION_BLOB_TOTAL_BYTES),
  bytesBase64: OctopodMigrationChunkBase64Schema
})

export type OctopodMigrationBlobChunkRequest = z.infer<typeof OctopodMigrationBlobChunkRequestSchema>

export type OctopodMigrationBlobChunkResult = {
  migrationId: string
  manifestSha256: string
  blobKind: OctopodMigrationBlobKind
  key: string
  receivedBytes: number
}

export function parseOctopodMigrationBlobDescriptor(value: unknown): OctopodMigrationBlobDescriptor {
  const parsed = OctopodMigrationBlobDescriptorSchema.safeParse(value)
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? 'octopod_migration_blob_descriptor_invalid')
  }
  return {
    blobKind: parsed.data.blobKind,
    key: parsed.data.key,
    sha256: parsed.data.sha256,
    byteLength: parsed.data.byteLength
  }
}

export function assertOctopodMigrationBlobSet(
  descriptors: readonly OctopodMigrationBlobDescriptor[]
): void {
  if (descriptors.length > MAX_OCTOPOD_MIGRATION_BLOBS) {
    throw new Error('octopod_migration_blobs_too_many')
  }
  assertUniqueKeys([...descriptors], octopodMigrationBlobIdentity, 'octopod_migration_blob_duplicate')
  const total = descriptors.reduce((sum, entry) => sum + entry.byteLength, 0)
  if (total > MAX_OCTOPOD_MIGRATION_BLOB_TOTAL_BYTES) {
    throw new Error('octopod_migration_blobs_too_large')
  }
}

export function octopodMigrationBlobIdentity(
  descriptor: Pick<OctopodMigrationBlobDescriptor, 'blobKind' | 'key'>
): string {
  return `${descriptor.blobKind}\0${descriptor.key}`
}

export function sameOctopodMigrationBlob(
  left: OctopodMigrationBlobDescriptor,
  right: OctopodMigrationBlobDescriptor
): boolean {
  return (
    left.blobKind === right.blobKind &&
    left.key === right.key &&
    left.sha256 === right.sha256 &&
    left.byteLength === right.byteLength
  )
}

/** The channel plus each kind's capability; empty when nothing is sent. */
export function requiredMigrationBlobCapabilities(
  descriptors: readonly Pick<OctopodMigrationBlobDescriptor, 'blobKind'>[]
): string[] {
  if (descriptors.length === 0) {
    return []
  }
  const kinds = new Set(descriptors.map((entry) => entry.blobKind))
  return [
    OCTOPOD_MIGRATION_BLOB_CHANNEL_RUNTIME_CAPABILITY,
    ...OCTOPOD_MIGRATION_BLOB_KINDS.filter((kind) => kinds.has(kind)).map(
      (kind) => OCTOPOD_MIGRATION_BLOB_KIND_CONTRACTS[kind].capability
    )
  ]
}

/** The first kind the destination cannot install, so the refusal names what would be lost. */
export function findUnsupportedMigrationBlobKind(
  descriptors: readonly Pick<OctopodMigrationBlobDescriptor, 'blobKind'>[],
  capabilities: readonly string[]
): OctopodMigrationBlobKind | null {
  const advertised = new Set(capabilities)
  for (const descriptor of descriptors) {
    if (
      !advertised.has(OCTOPOD_MIGRATION_BLOB_CHANNEL_RUNTIME_CAPABILITY) ||
      !advertised.has(OCTOPOD_MIGRATION_BLOB_KIND_CONTRACTS[descriptor.blobKind].capability)
    ) {
      return descriptor.blobKind
    }
  }
  return null
}

export function octopodMigrationBlobKindUnsupportedBlocker(kind: OctopodMigrationBlobKind): string {
  return `${OCTOPOD_MIGRATION_DESTINATION_BLOB_KIND_UNSUPPORTED}:${kind}:Update Shield on this host to move this project's ${kind} to it.`
}

export function decodeOctopodMigrationBlobChunk(bytesBase64: string): Buffer {
  return decodeOctopodMigrationChunk(bytesBase64, 'octopod_migration_blob_chunk_invalid')
}

/** Absent on hosts that predate blobs or hold none staged; both mean every blob starts at 0. */
export function parseOctopodMigrationBlobUploadStates(
  value: unknown
): OctopodMigrationBlobUploadState[] | undefined {
  if (value === undefined) {
    return undefined
  }
  if (!Array.isArray(value) || value.length > MAX_OCTOPOD_MIGRATION_BLOBS) {
    throw new Error('octopod_migration_blob_state_invalid')
  }
  const uploads = value.map((entry) => {
    // Fails closed on an unknown kind by design: only blobs this desktop staged can appear here.
    const record = requiredRecord(entry, 'octopod_migration_blob_state_invalid')
    const descriptor = parseOctopodMigrationBlobDescriptor(record)
    if (
      !Number.isSafeInteger(record.receivedBytes) ||
      Number(record.receivedBytes) < 0 ||
      Number(record.receivedBytes) > descriptor.byteLength
    ) {
      throw new Error('octopod_migration_blob_state_invalid')
    }
    return { ...descriptor, receivedBytes: Number(record.receivedBytes) }
  })
  assertOctopodMigrationBlobSet(uploads)
  return uploads
}

export function parseOctopodMigrationBlobChunkResult(
  value: unknown,
  request: OctopodMigrationBlobChunkRequest
): OctopodMigrationBlobChunkResult {
  const record = requiredRecord(value, 'octopod_migration_blob_chunk_result_invalid')
  const receivedBytes = request.offset + decodeOctopodMigrationBlobChunk(request.bytesBase64).length
  if (
    record.migrationId !== request.migrationId ||
    record.manifestSha256 !== request.manifestSha256 ||
    record.blobKind !== request.blob.blobKind ||
    record.key !== request.blob.key ||
    record.receivedBytes !== receivedBytes
  ) {
    throw new Error('octopod_migration_blob_chunk_result_invalid')
  }
  return {
    migrationId: request.migrationId,
    manifestSha256: request.manifestSha256,
    blobKind: request.blob.blobKind,
    key: request.blob.key,
    receivedBytes
  }
}

/** Kinds this build's destination installs after commit; each is added with its installer. */
export const OCTOPOD_MIGRATION_INSTALLABLE_BLOB_KINDS: readonly OctopodMigrationBlobKind[] = [
  'terminal-restore-hints',
  'shell-history'
]

export function advertisedOctopodMigrationBlobCapabilities(): string[] {
  return [
    OCTOPOD_MIGRATION_BLOB_CHANNEL_RUNTIME_CAPABILITY,
    ...OCTOPOD_MIGRATION_INSTALLABLE_BLOB_KINDS.map(
      (kind) => OCTOPOD_MIGRATION_BLOB_KIND_CONTRACTS[kind].capability
    )
  ]
}
