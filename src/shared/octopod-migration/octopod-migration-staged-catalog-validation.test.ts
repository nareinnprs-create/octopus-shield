import { describe, expect, it } from 'vitest'
import { normalizeOctopodMigrationStagedCatalogs } from './octopod-migration-staged-catalog-validation'
import { OCTOPOD_MIGRATION_MANIFEST_VERSION } from './octopod-migration-manifest-validation'

function staged(migrationId: string) {
  return {
    version: OCTOPOD_MIGRATION_MANIFEST_VERSION,
    stagedAt: '2026-08-30T12:00:00.000Z',
    manifest: {
      version: OCTOPOD_MIGRATION_MANIFEST_VERSION,
      migrationId,
      createdAt: '2026-08-30T12:00:00.000Z',
      source: { sshTargetId: 'ssh-prod', sshTargetGeneration: 1, targetLabel: 'Production' },
      payload: { repositories: [], projectGroups: [], folderWorkspaces: [] },
      manifestSha256: 'a'.repeat(64)
    }
  }
}

describe('octopod staged catalog normalization', () => {
  it('recovers without Node 20-only array methods', () => {
    const prototype: object = Array.prototype
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'toReversed')
    try {
      Object.defineProperty(prototype, 'toReversed', {
        configurable: true,
        value: undefined,
        writable: true
      })
      expect(normalizeOctopodMigrationStagedCatalogs([staged('migration-1')])).toEqual([
        expect.objectContaining({
          manifest: expect.objectContaining({ migrationId: 'migration-1' })
        })
      ])
    } finally {
      if (descriptor) {
        Object.defineProperty(prototype, 'toReversed', descriptor)
      } else {
        Reflect.deleteProperty(prototype, 'toReversed')
      }
    }
  })
})
