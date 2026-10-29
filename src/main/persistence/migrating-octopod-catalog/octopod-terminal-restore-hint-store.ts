// Host-local hints need independent durable writes until each pane's first spawn consumes them.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { durableWriteTempPath, writeFileDurableSync } from '../../durable-file-write'
import {
  MAX_OCTOPOD_MIGRATION_TERMINAL_RESTORE_HINTS,
  isOctopodMigrationTerminalRestoreHintCwd,
  isOctopodMigrationTerminalRestoreHintPaneKey,
  type OctopodMigrationTerminalRestoreHint
} from '../../../shared/octopod-migration/octopod-migration-terminal-restore-hints'
import { ensureOctopodMigrationDirectory } from './octopod-migration-staged-file'

const STORE_VERSION = 2
const INSTALLED_DIRECTORY = 'installed'
const STORE_FILE = 'terminal-restore-hints.json'
// Bound retention for panes never reopened after migration.
export const OCTOPOD_TERMINAL_RESTORE_HINT_TTL_MS = 30 * 24 * 60 * 60 * 1000
const MAX_INSTALLED_MIGRATIONS = 256

export type OctopodTerminalRestoreHintPlacement = OctopodMigrationTerminalRestoreHint & {
  worktreeId: string
}

export type OctopodTerminalRestoreHintMigration = {
  migrationKey: string
  migrationId: string
}

type InstalledTerminalRestoreHint = OctopodTerminalRestoreHintPlacement &
  OctopodTerminalRestoreHintMigration & { installedAt: number }

type TerminalRestoreHintStoreDocument = {
  version: typeof STORE_VERSION
  hints: InstalledTerminalRestoreHint[]
  /** Prevent commit retries from reviving already-consumed hints. */
  installedMigrationKeys: string[]
}

const MIGRATION_KEY = /^[a-f0-9]{32}$/

const StoreDocumentSchema = z.object({
  version: z.literal(STORE_VERSION),
  hints: z.array(
    z.object({
      paneKey: z.string().refine(isOctopodMigrationTerminalRestoreHintPaneKey),
      cwd: z.string().refine(isOctopodMigrationTerminalRestoreHintCwd),
      worktreeId: z.string().min(1),
      migrationKey: z.string().regex(MIGRATION_KEY),
      migrationId: z.string().min(1),
      installedAt: z.number().int().nonnegative()
    })
  ),
  installedMigrationKeys: z.array(z.string().regex(MIGRATION_KEY))
})

export class OctopodTerminalRestoreHintStore {
  private readonly directory: string
  private readonly path: string
  private document: TerminalRestoreHintStoreDocument | null = null

  constructor(blobRoot: string) {
    this.directory = join(blobRoot, INSTALLED_DIRECTORY)
    this.path = join(this.directory, STORE_FILE)
  }

  hasInstalledMigration(migrationKey: string): boolean {
    return this.load().installedMigrationKeys.includes(migrationKey)
  }

  install(
    migration: OctopodTerminalRestoreHintMigration,
    hints: readonly OctopodTerminalRestoreHintPlacement[],
    now: number
  ): void {
    const current = this.load()
    if (current.installedMigrationKeys.includes(migration.migrationKey)) {
      return
    }
    const incoming = new Set(hints.map((hint) => hint.paneKey))
    const merged = [
      ...current.hints.filter((hint) => !incoming.has(hint.paneKey)),
      ...hints.map((hint) => ({
        paneKey: hint.paneKey,
        cwd: hint.cwd,
        worktreeId: hint.worktreeId,
        migrationKey: migration.migrationKey,
        migrationId: migration.migrationId,
        installedAt: now
      }))
    ]
    this.write(
      {
        version: STORE_VERSION,
        hints: merged.slice(-MAX_OCTOPOD_MIGRATION_TERMINAL_RESTORE_HINTS),
        installedMigrationKeys: [...current.installedMigrationKeys, migration.migrationKey].slice(
          -MAX_INSTALLED_MIGRATIONS
        )
      },
      now
    )
  }

  /** Read without consuming. */
  peek(paneKey: string, worktreeId: string, now: number): string | null {
    const hint = this.load().hints.find((entry) => entry.paneKey === paneKey)
    if (!hint || hint.worktreeId !== worktreeId) {
      return null
    }
    return now - hint.installedAt > OCTOPOD_TERMINAL_RESTORE_HINT_TTL_MS ? null : hint.cwd
  }

  /** Durably consume regardless of the hint's worktree. */
  consume(paneKey: string, now: number): void {
    this.dropWhere((hint) => hint.paneKey === paneKey, now)
  }

  dropForWorktrees(matchesWorktreeId: (worktreeId: string) => boolean, now: number): void {
    this.dropWhere((hint) => matchesWorktreeId(hint.worktreeId), now)
  }

  private dropWhere(matches: (hint: InstalledTerminalRestoreHint) => boolean, now: number): void {
    const current = this.load()
    if (!current.hints.some(matches)) {
      return
    }
    this.write({ ...current, hints: current.hints.filter((hint) => !matches(hint)) }, now)
  }

  private write(next: TerminalRestoreHintStoreDocument, now: number): void {
    const document = {
      ...next,
      hints: next.hints.filter(
        (hint) => now - hint.installedAt <= OCTOPOD_TERMINAL_RESTORE_HINT_TTL_MS
      )
    }
    ensureOctopodMigrationDirectory(this.directory)
    writeFileDurableSync(
      durableWriteTempPath(this.path),
      this.path,
      JSON.stringify(document),
      0o600
    )
    this.document = document
  }

  private load(): TerminalRestoreHintStoreDocument {
    if (this.document) {
      return this.document
    }
    this.document = readStoreDocument(this.path)
    return this.document
  }
}

/** Project removal is best-effort; any later migration supplies fresh hints. */
export function dropOctopodTerminalRestoreHintsForWorktrees(
  store: OctopodTerminalRestoreHintStore,
  matchesWorktreeId: (worktreeId: string) => boolean
): void {
  try {
    store.dropForWorktrees(matchesWorktreeId, Date.now())
  } catch (error) {
    console.warn('[octopod-migration] dropping terminal restore hints failed:', error)
  }
}

function emptyDocument(): TerminalRestoreHintStoreDocument {
  return { version: STORE_VERSION, hints: [], installedMigrationKeys: [] }
}

function readStoreDocument(path: string): TerminalRestoreHintStoreDocument {
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    return emptyDocument()
  }
  try {
    const parsed = StoreDocumentSchema.safeParse(JSON.parse(text))
    if (parsed.success) {
      return {
        version: parsed.data.version,
        hints: parsed.data.hints,
        installedMigrationKeys: parsed.data.installedMigrationKeys
      }
    }
  } catch {
    // Corrupt hints only lose old cwd restoration.
  }
  console.warn('[octopod-migration] ignoring an unreadable terminal restore hint store')
  return emptyDocument()
}
