import type { PersistedState } from '../../../shared/persisted-state-types'
import type { OctopodMigrationDormantStatePayload } from '../../../shared/octopod-migration/octopod-migration-manifest'
import { serializeOctopodMigrationValue } from '../../../shared/octopod-migration/octopod-migration-manifest'
import { canonicalWorktreeIdentity } from '../../../shared/worktree/identity'
import { composeWorktreeHostIdentity } from '../../../shared/worktree/host-qualified-identity'
import { omitDefaultWorktreeMetaFields } from '../../../shared/worktree/meta-persisted-defaults'

export function assertOctopodDestinationCanonicalMetadata(
  state: PersistedState,
  entries: OctopodMigrationDormantStatePayload['worktreeMeta']
): void {
  for (const { worktreeId, meta } of entries) {
    const alias = composeWorktreeHostIdentity('local', worktreeId)
    const identities = state.worktreeIdentityAliases?.[alias] ?? []
    const expectedKey = meta.instanceId
      ? canonicalWorktreeIdentity({
          worktreeId,
          executionHostId: 'local',
          instanceId: meta.instanceId
        })
      : undefined
    const candidates = new Set([
      ...identities,
      ...(expectedKey && state.worktreeMetaByIdentity?.[expectedKey] ? [expectedKey] : [])
    ])
    if (
      candidates.size > 1 ||
      [...candidates].some((key) => {
        const current = state.worktreeMetaByIdentity?.[key]
        return (
          !current ||
          key !== expectedKey ||
          serializeOctopodMigrationValue(omitDefaultWorktreeMetaFields(current)) !==
            serializeOctopodMigrationValue(omitDefaultWorktreeMetaFields(meta))
        )
      })
    ) {
      throw new Error(`octopod_migration_dormant_id_conflict:worktree_meta:${worktreeId}`)
    }
  }
}
