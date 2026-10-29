import type { OctopodMigrationManifest } from '../../../shared/octopod-migration/octopod-migration-manifest'
import type { PersistedState } from '../../../shared/persisted-state-types'
import { subtractOctopodSourceWorktreeMetadata } from './octopod-source-worktree-metadata'
import { subtractOctopodMigrationSourceAutomationState } from './octopod-source-automation-subtraction'
import { subtractOctopodMigrationSourceWorkspaceSession } from './octopod-source-workspace-session-subtraction'
import { subtractOctopodMigrationClientState } from './octopod-source-client-subtraction'

/** Mutate a delta-view copy only. */
export function subtractOctopodMigrationSourceDormantState(
  state: PersistedState,
  manifest: OctopodMigrationManifest
): void {
  // Include state a downgraded build added even when the manifest had none.
  subtractOctopodSourceWorktreeMetadata(state, manifest)
  subtractOctopodMigrationSourceAutomationState(state, manifest)
  const dormant = manifest.payload.dormantState
  if (!dormant) {
    return
  }
  dormant.worktreeLineage.forEach((entry) => delete state.worktreeLineageById[entry.sourceKey])
  dormant.workspaceLineage.forEach(
    (entry) => delete state.workspaceLineageByChildKey[entry.sourceKey]
  )
  for (const preset of dormant.sparsePresets) {
    const remaining = (state.sparsePresetsByRepo[preset.repoId] ?? []).filter(
      (entry) => entry.id !== preset.id
    )
    if (remaining.length > 0) {
      state.sparsePresetsByRepo[preset.repoId] = remaining
    } else {
      delete state.sparsePresetsByRepo[preset.repoId]
    }
  }
  for (const entry of dormant.retiredWorktreeNames) {
    delete state.retiredWorktreeNamesByRepo?.[entry.repoId]
  }
  subtractOctopodMigrationSourceWorkspaceSession(state, manifest)
  subtractOctopodMigrationClientState(state, manifest)
  // Retain snapshot files: the prior durable profile and rollback evidence can still reference them.
}
