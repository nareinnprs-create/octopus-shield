import type { OctopodMigrationManifest } from '../../../shared/octopod-migration/octopod-migration-manifest'
import {
  OCTOPOD_MIGRATION_DEPENDENCY_KINDS,
  type OctopodMigrationDependencyKind
} from '../../../shared/octopod-migration/octopod-migration-preflight'
import type { PersistedState } from '../../../shared/persisted-state-types'
import type { TerminalScrollbackSnapshotStorage } from '../../terminal-scrollback-snapshots'
import {
  inspectOctopodMigrationSourceSessions,
  type OctopodMigrationSourceSessionInspection
} from './octopod-source-session-dependencies'
import {
  collectOctopodMigrationSourceDormantState,
  octopodMigrationLeavesBehind
} from './octopod-source-dormant-state'
import {
  createOctopodMigrationSourceScope,
  octopodMigrationOwnerMatchesScope,
  octopodMigrationPartitionScope,
  type OctopodMigrationSourceScope
} from './octopod-source-scope'
import { paneBelongsToTabs } from '../../../shared/workspace-session-pane-ownership'

export type OctopodMigrationSourceDependencyCensus = {
  totalCount: number
  counts: Record<OctopodMigrationDependencyKind, number>
  /** Blocker names and remedies where available. */
  names?: Partial<Record<OctopodMigrationDependencyKind, string[]>>
}

export function collectOctopodMigrationUntransferredDependencyCensus(
  state: PersistedState,
  manifest: OctopodMigrationManifest,
  storage?: TerminalScrollbackSnapshotStorage
): OctopodMigrationSourceDependencyCensus {
  const scope = createOctopodMigrationSourceScope({
    source: manifest.source,
    catalog: manifest.payload,
    repos: state.repos
  })
  const sessions = inspectOctopodMigrationSourceSessions(state, {
    hostId: scope.hostId,
    ownerMatches: (ownerKey, partitionHostId) =>
      octopodMigrationOwnerMatchesScope(
        ownerKey,
        octopodMigrationPartitionScope(scope, partitionHostId)
      )
  })
  const dormant = collectOctopodMigrationSourceDormantState(
    state,
    manifest.source,
    manifest.payload,
    storage,
    manifest.destinationEnvironmentId
  )
  const counts: Record<OctopodMigrationDependencyKind, number> = {
    ...dormant.blockedCounts,
    'terminal-lease': state.sshRemotePtyLeases.filter(
      (lease) => lease.targetId === scope.targetId && lease.state !== 'terminated'
    ).length,
    // Retained recoveries can stay behind; the terminal gate still requires exit.
    'terminal-recovery': octopodMigrationLeavesBehind(state, scope.targetId)
      ? 0
      : countTerminalRecoveryState(state, scope, sessions)
  }
  return {
    counts,
    totalCount: OCTOPOD_MIGRATION_DEPENDENCY_KINDS.reduce((total, kind) => total + counts[kind], 0),
    names: {
      ...(dormant.blockedSessionItems.length > 0
        ? { 'workspace-session': dormant.blockedSessionItems }
        : {}),
      ...(dormant.runningAutomationItems.length > 0
        ? { 'automation-run': dormant.runningAutomationItems }
        : {})
    }
  }
}

// The terminal gate proves recovery leases exited; hook aliases add no independent terminal ownership.
function countTerminalRecoveryState(
  state: PersistedState,
  scope: OctopodMigrationSourceScope,
  sessions: OctopodMigrationSourceSessionInspection
): number {
  return state.migrationUnsupportedPtyEntries.filter(
    (entry) =>
      octopodMigrationOwnerMatchesScope(entry.worktreeId, scope) ||
      (entry.tabId ? sessions.tabIds.has(entry.tabId) : false) ||
      sessions.ptyIds.has(entry.ptyId) ||
      (entry.paneKey ? paneBelongsToTabs(entry.paneKey, sessions.tabIds) : false)
  ).length
}
