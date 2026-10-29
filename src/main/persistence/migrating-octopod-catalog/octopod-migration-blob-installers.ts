// Validate blob contents before commit; install only advertised kinds after durable commit.
import { readFileSync, rmSync } from 'node:fs'
import { dirname } from 'node:path'
import type { OctopodMigrationBlobKind } from '../../../shared/octopod-migration/octopod-migration-blob-transfer'
import type { OctopodMigrationManifest } from '../../../shared/octopod-migration/octopod-migration-manifest'
import {
  OCTOPOD_MIGRATION_TERMINAL_RESTORE_HINTS_KEY,
  parseOctopodMigrationTerminalRestoreHintsText,
  type OctopodMigrationTerminalRestoreHint
} from '../../../shared/octopod-migration/octopod-migration-terminal-restore-hints'
import { syncDirectoryDurablySync } from '../../durable-file-write'
import {
  getOctopodMigrationReceivedBlobPath,
  stagedOctopodMigrationBlobFiles
} from './octopod-migration-blob-staging'
import {
  octopodMigrationStagingKey,
  type OctopodMigrationRequestIdentity
} from './octopod-migration-staged-file'
import {
  assertOctopodMigrationShellHistoryValid,
  installOctopodMigrationShellHistory
} from './octopod-shell-history-installer'
import type {
  OctopodTerminalRestoreHintPlacement,
  OctopodTerminalRestoreHintStore
} from './octopod-terminal-restore-hint-store'

type OctopodMigrationStagedBlobFile = {
  key: string
  path: string
  manifest: OctopodMigrationManifest
}

type OctopodMigrationBlobContentCheck = (file: OctopodMigrationStagedBlobFile) => void

const UTF8 = new TextDecoder('utf-8', { fatal: true })

const BLOB_CONTENT_CHECKS: Partial<Record<OctopodMigrationBlobKind, OctopodMigrationBlobContentCheck>> =
  {
    'terminal-restore-hints': ({ path }) => {
      parseOctopodMigrationTerminalRestoreHintsText(decodeUtf8(readFileSync(path)))
    },
    'shell-history': ({ key, path, manifest }) => {
      assertOctopodMigrationShellHistoryValid(key, path, manifest.payload)
    }
  }

/** Reject malformed content before commit while the source still owns everything. */
export function assertOctopodMigrationBlobContentsValid(
  manifest: OctopodMigrationManifest,
  root: string
): void {
  for (const { descriptor, path } of stagedOctopodMigrationBlobFiles(manifest, root)) {
    const check = BLOB_CONTENT_CHECKS[descriptor.blobKind]
    if (!check) {
      continue
    }
    try {
      check({ key: descriptor.key, path, manifest })
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      throw new Error(`octopod_migration_blob_content_invalid:${descriptor.blobKind}:${reason}`)
    }
  }
}

export type OctopodMigrationBlobInstall = {
  migration: OctopodMigrationRequestIdentity
  root: string
  terminalRestoreHints: OctopodTerminalRestoreHintStore
  /** This host's getHistoryRoot(). */
  shellHistoryRoot: string
  paneShellPath: () => string
  /** Defer without runtime evidence: shells surviving a restart could overwrite installed history. */
  worktreeHasLiveShells?: (worktreeId: string) => boolean
  deferredShellHistoryWorktreeIds: Set<string>
  paneWorktreeId: (paneKey: string) => string | null
  now: number
}

/** Retain failed blobs for retry; installed-migration markers prevent consumed hints from reviving. */
export function installOctopodMigrationReceivedBlobs(install: OctopodMigrationBlobInstall): void {
  let firstError: unknown = null
  // Keep failures independent so other blob kinds can still install.
  for (const installKind of [installTerminalRestoreHints, installShellHistory]) {
    try {
      installKind(install)
    } catch (error) {
      firstError ??= error
    }
  }
  if (firstError !== null) {
    throw firstError
  }
}

function installShellHistory(install: OctopodMigrationBlobInstall): void {
  if (!install.worktreeHasLiveShells) {
    return
  }
  installOctopodMigrationShellHistory({
    migration: install.migration,
    root: install.root,
    historyRoot: install.shellHistoryRoot,
    paneShellPath: install.paneShellPath,
    worktreeHasLiveShells: install.worktreeHasLiveShells,
    deferredWorktreeIds: install.deferredShellHistoryWorktreeIds,
    now: install.now
  })
}

function installTerminalRestoreHints(install: OctopodMigrationBlobInstall): void {
  const path = getOctopodMigrationReceivedBlobPath(install.root, install.migration, {
    blobKind: 'terminal-restore-hints',
    key: OCTOPOD_MIGRATION_TERMINAL_RESTORE_HINTS_KEY
  })
  let bytes: Buffer
  try {
    bytes = readFileSync(path)
  } catch {
    return
  }
  const migrationKey = octopodMigrationStagingKey(install.migration)
  if (!install.terminalRestoreHints.hasInstalledMigration(migrationKey)) {
    try {
      const document = parseOctopodMigrationTerminalRestoreHintsText(decodeUtf8(bytes))
      install.terminalRestoreHints.install(
        { migrationKey, migrationId: install.migration.migrationId },
        placeHints(document.hints, install.paneWorktreeId),
        install.now
      )
    } catch (error) {
      if (!isHintFormatError(error)) {
        throw error
      }
      // Pre-commit validation passed; damaged hints can only fall back to the default folder now.
      console.error(
        `[octopod-migration] dropped unreadable terminal restore hints for ${install.migration.migrationId}:`,
        error
      )
    }
  }
  rmSync(path, { force: true })
  syncDirectoryDurablySync(dirname(path))
}

// Drop hints whose panes have no worktree on this host.
function placeHints(
  hints: readonly OctopodMigrationTerminalRestoreHint[],
  paneWorktreeId: (paneKey: string) => string | null
): OctopodTerminalRestoreHintPlacement[] {
  return hints.flatMap((hint) => {
    const worktreeId = paneWorktreeId(hint.paneKey)
    return worktreeId ? [{ ...hint, worktreeId }] : []
  })
}

function decodeUtf8(bytes: Buffer): string {
  try {
    return UTF8.decode(bytes)
  } catch {
    throw new Error('octopod_migration_terminal_restore_hints_not_utf8')
  }
}

function isHintFormatError(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith('octopod_migration_terminal_restore_')
}
