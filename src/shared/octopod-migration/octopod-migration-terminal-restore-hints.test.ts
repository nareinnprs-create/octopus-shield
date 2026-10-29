import { describe, expect, it } from 'vitest'
import {
  MAX_OCTOPOD_MIGRATION_TERMINAL_RESTORE_HINTS,
  MAX_OCTOPOD_MIGRATION_TERMINAL_RESTORE_HINTS_BYTES,
  parseOctopodMigrationTerminalRestoreHintsDocument,
  parseOctopodMigrationTerminalRestoreHintsText
} from './octopod-migration-terminal-restore-hints'

const PANE_KEY = 'tab-1:11111111-1111-4111-8111-111111111111'

function document(hints: unknown[]): unknown {
  return { version: 1, hints }
}

describe('terminal restore hints document', () => {
  it('accepts stable pane keys with absolute POSIX folders and drops unknown fields', () => {
    expect(
      parseOctopodMigrationTerminalRestoreHintsDocument({
        version: 1,
        hints: [{ paneKey: PANE_KEY, cwd: '/home/me/src', extra: true }],
        futureField: 1
      })
    ).toEqual({ version: 1, hints: [{ paneKey: PANE_KEY, cwd: '/home/me/src' }] })
  })

  it.each([
    ['a legacy numeric pane id', 'tab-1:3'],
    ['a key without a tab', ':11111111-1111-4111-8111-111111111111'],
    ['a key with two separators', 'a:b:11111111-1111-4111-8111-111111111111'],
    ['an over-long key', `${'t'.repeat(200)}:11111111-1111-4111-8111-111111111111`]
  ])('refuses %s', (_label, paneKey) => {
    expect(() =>
      parseOctopodMigrationTerminalRestoreHintsDocument(document([{ paneKey, cwd: '/home' }]))
    ).toThrow('octopod_migration_terminal_restore_hint_pane_key_invalid')
  })

  it.each([
    ['a relative folder', 'src/app'],
    ['a UNC-style folder', '//wsl.localhost/Ubuntu/home'],
    ['a Windows folder', 'C:\\Users\\me'],
    ['a folder with NUL', '/home/\0me'],
    ['an over-long folder', `/${'a'.repeat(4096)}`]
  ])('refuses %s', (_label, cwd) => {
    expect(() =>
      parseOctopodMigrationTerminalRestoreHintsDocument(document([{ paneKey: PANE_KEY, cwd }]))
    ).toThrow('octopod_migration_terminal_restore_hint_cwd_invalid')
  })

  it('refuses duplicate panes, too many hints, other versions and non-JSON', () => {
    const hint = { paneKey: PANE_KEY, cwd: '/home' }
    expect(() => parseOctopodMigrationTerminalRestoreHintsDocument(document([hint, hint]))).toThrow(
      'octopod_migration_terminal_restore_hint_duplicate'
    )
    expect(() =>
      parseOctopodMigrationTerminalRestoreHintsDocument(
        document(Array.from({ length: MAX_OCTOPOD_MIGRATION_TERMINAL_RESTORE_HINTS + 1 }, () => hint))
      )
    ).toThrow('octopod_migration_terminal_restore_hints_invalid')
    expect(() =>
      parseOctopodMigrationTerminalRestoreHintsDocument({ version: 2, hints: [] })
    ).toThrow('octopod_migration_terminal_restore_hints_invalid')
    expect(() => parseOctopodMigrationTerminalRestoreHintsText('{')).toThrow(
      'octopod_migration_terminal_restore_hints_not_json'
    )
  })

  it('refuses text over the blob cap before parsing it', () => {
    expect(() =>
      parseOctopodMigrationTerminalRestoreHintsText(
        ' '.repeat(MAX_OCTOPOD_MIGRATION_TERMINAL_RESTORE_HINTS_BYTES + 1)
      )
    ).toThrow('octopod_migration_terminal_restore_hints_too_large')
  })
})
