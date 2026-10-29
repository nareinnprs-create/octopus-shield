import { createHash } from 'node:crypto'
import type { OctopodMigrationBlobDescriptor } from '../../../shared/octopod-migration/octopod-migration-blob-transfer'
import { sameOctopodMigrationBlob } from '../../../shared/octopod-migration/octopod-migration-blob-transfer'
import {
  MAX_OCTOPOD_MIGRATION_TERMINAL_RESTORE_HINTS_BYTES,
  OCTOPOD_MIGRATION_TERMINAL_RESTORE_HINTS_KEY,
  OCTOPOD_MIGRATION_TERMINAL_RESTORE_HINTS_VERSION,
  parseOctopodMigrationTerminalRestoreHintsDocument,
  type OctopodMigrationTerminalRestoreHint
} from '../../../shared/octopod-migration/octopod-migration-terminal-restore-hints'
import type { OctopodMigrationBlobSource } from '../../ssh/octopod-migration-blob-coordinator'

export type WslMoveRestoreHintsBlob = {
  descriptor: OctopodMigrationBlobDescriptor
  bytes: Buffer
  source: OctopodMigrationBlobSource
}

/** Omit the blob when there are no hints. */
export function buildWslMoveRestoreHintsBlob(
  hints: readonly OctopodMigrationTerminalRestoreHint[]
): WslMoveRestoreHintsBlob | null {
  if (hints.length === 0) {
    return null
  }
  // Validate before staging so malformed hints fail while the source still owns the move.
  const document = parseOctopodMigrationTerminalRestoreHintsDocument({
    version: OCTOPOD_MIGRATION_TERMINAL_RESTORE_HINTS_VERSION,
    hints: hints.map((hint) => ({ paneKey: hint.paneKey, cwd: hint.cwd }))
  })
  const bytes = Buffer.from(JSON.stringify(document), 'utf8')
  if (bytes.length > MAX_OCTOPOD_MIGRATION_TERMINAL_RESTORE_HINTS_BYTES) {
    throw new Error('octopod_migration_terminal_restore_hints_too_large')
  }
  const descriptor: OctopodMigrationBlobDescriptor = {
    blobKind: 'terminal-restore-hints',
    key: OCTOPOD_MIGRATION_TERMINAL_RESTORE_HINTS_KEY,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    byteLength: bytes.length
  }
  return {
    descriptor,
    bytes,
    source: {
      readChunk: async (requested, offset, maxBytes) => {
        if (!sameOctopodMigrationBlob(requested, descriptor)) {
          throw new Error(`octopod_migration_source_blob_changed:${requested.blobKind}`)
        }
        return bytes.subarray(offset, offset + maxBytes)
      }
    }
  }
}
