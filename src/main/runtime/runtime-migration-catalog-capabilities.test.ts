import { describe, expect, it, vi } from 'vitest'
import { ShieldRuntimeService } from './shield-runtime-test-mocks.spec'
import { store } from './shield-runtime-test-fixtures.spec'
import { OCTOPOD_MIGRATION_MANIFEST_VERSION } from '../../shared/octopod-migration/octopod-migration-manifest-validation'
import type {
  OctopodMigrationCatalogState,
  OctopodMigrationManifest
} from '../../shared/octopod-migration/octopod-migration-manifest'

const manifest: OctopodMigrationManifest = {
  version: OCTOPOD_MIGRATION_MANIFEST_VERSION,
  migrationId: 'migration-capabilities',
  createdAt: '2026-08-30T12:00:00.000Z',
  source: { sshTargetId: 'source', sshTargetGeneration: null, targetLabel: 'Source' },
  payload: { repositories: [], projectGroups: [], folderWorkspaces: [] },
  manifestSha256: '0'.repeat(64)
}

const staged: OctopodMigrationCatalogState = {
  state: 'staged',
  migrationId: manifest.migrationId,
  manifestSha256: manifest.manifestSha256,
  stagedAt: manifest.createdAt
}

describe('runtime migration catalog capabilities', () => {
  it('refuses a catalog read when the runtime has no store', () => {
    const runtime = new ShieldRuntimeService(null)
    expect(() => runtime.getOctopodMigrationCatalogState(manifest)).toThrow('runtime_unavailable')
  })

  it('refuses a missing catalog reader on a partial store', () => {
    const runtime = new ShieldRuntimeService(store)
    expect(() => runtime.getOctopodMigrationCatalogState(manifest)).toThrow('runtime_unavailable')
  })

  it('refuses staging before mutation when the partial store cannot flush', async () => {
    const stage = vi.fn(() => staged)
    const runtime = new ShieldRuntimeService({ ...store, stageOctopodMigrationCatalog: stage })
    await expect(runtime.stageOctopodMigrationCatalog(manifest)).rejects.toThrow(
      'runtime_unavailable'
    )
    expect(stage).not.toHaveBeenCalled()
  })

  it('admits staging with only the methods that operation needs', async () => {
    const stage = vi.fn(() => staged)
    const flush = vi.fn(async () => {})
    const runtime = new ShieldRuntimeService({
      ...store,
      stageOctopodMigrationCatalog: stage,
      flushPendingOrThrowAsync: flush
    })
    await expect(runtime.stageOctopodMigrationCatalog(manifest)).resolves.toBe(staged)
    expect(stage).toHaveBeenCalledWith(manifest)
    expect(flush).toHaveBeenCalledOnce()
  })
})
