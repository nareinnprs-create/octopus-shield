import { describe, expect, it, vi } from 'vitest'
import type {
  OctopodMigrationCatalogAbortResult,
  OctopodMigrationCatalogReferenceAbortResult,
  OctopodMigrationCatalogState
} from '../../shared/octopod-migration/octopod-migration-manifest'
import { octopodMigrationCutoverFixture } from '../ssh/octopod-migration-cutover-fixture'
import {
  abortStagedOctopodMigrationCatalogByReferenceDurably,
  abortStagedOctopodMigrationCatalogDurably,
  commitStagedOctopodMigrationCatalogDurably,
  stageOctopodMigrationCatalogDurably
} from './octopod-migration-catalog-import'

const { manifest } = octopodMigrationCutoverFixture()
const reference = { migrationId: manifest.migrationId, manifestSha256: manifest.manifestSha256 }

describe('durable octopod migration catalog import', () => {
  it('does not acknowledge staging until its dormant manifest is durable', async () => {
    const diskError = new Error('disk full')
    const staged: OctopodMigrationCatalogState = {
      state: 'staged',
      ...reference,
      stagedAt: '2026-10-01T00:00:01.000Z'
    }
    const stage = vi.fn().mockReturnValue(staged)
    const flush = vi.fn().mockRejectedValueOnce(diskError).mockResolvedValueOnce(undefined)
    const args = {
      store: {
        stageOctopodMigrationCatalog: stage,
        flushPendingOrThrowAsync: flush
      },
      manifest
    }

    await expect(stageOctopodMigrationCatalogDurably(args)).rejects.toBe(diskError)
    await expect(stageOctopodMigrationCatalogDurably(args)).resolves.toBe(staged)
    expect(stage).toHaveBeenCalledTimes(2)
    expect(flush).toHaveBeenCalledTimes(2)
  })

  it('publishes a committed catalog only after its receipt is durable', async () => {
    const diskError = new Error('disk full')
    const committed: OctopodMigrationCatalogState = {
      state: 'committed',
      ...reference,
      receipt: {
        version: manifest.version,
        ...reference,
        source: manifest.source,
        importedAt: '2026-10-01T00:00:02.000Z',
        repositoryIds: [],
        projectGroupIds: [],
        folderWorkspaceIds: []
      }
    }
    const commit = vi.fn().mockReturnValue(committed)
    const flush = vi.fn().mockRejectedValueOnce(diskError).mockResolvedValueOnce(undefined)
    const onDurableCommit = vi.fn()
    const args = {
      store: {
        commitStagedOctopodMigrationCatalog: commit,
        flushPendingOrThrowAsync: flush
      },
      manifest,
      onDurableCommit
    }

    await expect(commitStagedOctopodMigrationCatalogDurably(args)).rejects.toBe(diskError)
    expect(onDurableCommit).not.toHaveBeenCalled()
    await expect(commitStagedOctopodMigrationCatalogDurably(args)).resolves.toBe(committed)
    expect(onDurableCommit).toHaveBeenCalledOnce()
  })

  it('reflushes an already-absent abort after the first flush failed', async () => {
    const aborted: OctopodMigrationCatalogAbortResult = {
      state: 'absent',
      ...reference,
      aborted: true
    }
    const unchanged: OctopodMigrationCatalogAbortResult = { ...aborted, aborted: false }
    const abort = vi.fn().mockReturnValueOnce(aborted).mockReturnValueOnce(unchanged)
    const flush = vi.fn().mockRejectedValueOnce(new Error('disk full')).mockResolvedValue(undefined)
    const args = {
      store: {
        abortStagedOctopodMigrationCatalog: abort,
        flushPendingOrThrowAsync: flush
      },
      manifest
    }

    await expect(abortStagedOctopodMigrationCatalogDurably(args)).rejects.toThrow('disk full')
    await expect(abortStagedOctopodMigrationCatalogDurably(args)).resolves.toEqual({
      ...unchanged,
      durableAbsent: true
    })
    expect(flush).toHaveBeenCalledTimes(2)
  })

  it('answers an abort by reference absent only once its flush succeeds', async () => {
    const aborted: OctopodMigrationCatalogReferenceAbortResult = {
      ...reference,
      state: 'absent',
      aborted: true
    }
    const unchanged: OctopodMigrationCatalogReferenceAbortResult = { ...aborted, aborted: false }
    const abort = vi.fn().mockReturnValueOnce(aborted).mockReturnValueOnce(unchanged)
    const flush = vi.fn().mockRejectedValueOnce(new Error('disk full')).mockResolvedValue(undefined)
    const args = {
      store: {
        abortStagedOctopodMigrationCatalogByReference: abort,
        flushPendingOrThrowAsync: flush
      },
      reference
    }

    await expect(abortStagedOctopodMigrationCatalogByReferenceDurably(args)).rejects.toThrow(
      'disk full'
    )
    await expect(abortStagedOctopodMigrationCatalogByReferenceDurably(args)).resolves.toEqual({
      ...unchanged,
      durableAbsent: true
    })
    expect(flush).toHaveBeenCalledTimes(2)
  })
})
