import { describe, expect, it } from 'vitest'
import { getDefaultPersistedState } from '../../../shared/constants'
import { MAX_OCTOPOD_MIGRATION_IMPORT_RECEIPTS } from '../../../shared/octopod-migration/octopod-migration-manifest-validation'
import { manifest } from './persistence-octopod-migration-catalog-fixture'
import {
  expireOctopodMigrationStages,
  findOctopodMigrationImportReceipt,
  OCTOPOD_MIGRATION_STAGE_TTL_MS,
  recordOctopodMigrationImportReceipt
} from './octopod-catalog-receipt-ledger'

const empty = { repositories: [], projectGroups: [], folderWorkspaces: [] }

function receiptFor(migrationId: string) {
  const input = manifest({ migrationId, payload: empty })
  return {
    input,
    receipt: {
      version: input.version,
      migrationId,
      manifestSha256: input.manifestSha256,
      source: input.source,
      importedAt: '2026-10-01T00:00:00.000Z',
      repositoryIds: [],
      projectGroupIds: [],
      folderWorkspaceIds: []
    }
  }
}

describe('octopod migration receipt ledger', () => {
  it('keeps answering for a commit whose receipt aged out of the bounded list', () => {
    const state = getDefaultPersistedState('/tmp/octopod-receipt-ledger')
    const first = receiptFor('migration-0')
    recordOctopodMigrationImportReceipt(state, first.receipt)
    for (let index = 1; index <= MAX_OCTOPOD_MIGRATION_IMPORT_RECEIPTS; index++) {
      recordOctopodMigrationImportReceipt(state, receiptFor(`migration-${index}`).receipt)
    }
    expect(state.octopodMigrationImportReceipts).toHaveLength(MAX_OCTOPOD_MIGRATION_IMPORT_RECEIPTS)
    expect(findOctopodMigrationImportReceipt(state, first.input)).toEqual(first.receipt)
    expect(findOctopodMigrationImportReceipt(state, receiptFor('never').input)).toBeUndefined()
  })

  it('expires a stage no client came back for', () => {
    const state = getDefaultPersistedState('/tmp/octopod-receipt-ledger')
    const stagedAt = '2026-10-01T00:00:00.000Z'
    state.octopodMigrationStagedCatalogs = [{ version: 1, manifest: manifest(), stagedAt }]
    const start = Date.parse(stagedAt)
    expect(expireOctopodMigrationStages(state, start + OCTOPOD_MIGRATION_STAGE_TTL_MS - 1)).toBe(false)
    expect(expireOctopodMigrationStages(state, start + OCTOPOD_MIGRATION_STAGE_TTL_MS)).toBe(true)
    expect(state.octopodMigrationStagedCatalogs).toEqual([])
  })
})
