import type { FolderWorkspace } from '../folder-workspace-types'
import type { Repo } from '../repo-types'
import type { SavedPortForward, SshRemotePtyLease } from '../ssh-types'

export const OCTOPOD_MIGRATION_DEPENDENCY_KINDS = [
  'saved-port-forward',
  'terminal-lease',
  'terminal-recovery',
  'workspace-session',
  'worktree-metadata',
  'worktree-lineage',
  'workspace-lineage',
  'sparse-preset',
  'retired-worktree-name',
  'automation',
  'automation-run',
  'mobile-tab-selection',
  'ui-routing'
] as const

export type OctopodMigrationDependencyKind = (typeof OCTOPOD_MIGRATION_DEPENDENCY_KINDS)[number]

export type OctopodMigrationDependency = {
  kind: OctopodMigrationDependencyKind
  count: number
  /** A bounded sample of what holds the reference, so the user can find and clear it. */
  names?: string[]
}

export type OctopodMigrationRepository = Pick<Repo, 'id' | 'path' | 'displayName' | 'kind'>
export type OctopodMigrationFolderWorkspace = Pick<FolderWorkspace, 'id' | 'name' | 'folderPath'>
export type OctopodMigrationTerminalLease = Pick<
  SshRemotePtyLease,
  'ptyId' | 'worktreeId' | 'tabId' | 'leafId' | 'state' | 'updatedAt'
>

export type OctopodMigrationBlocker =
  | {
      code: 'octopod_migration_target_not_found'
      category: 'registration'
    }
  | {
      code: 'octopod_migration_target_owned'
      category: 'exclusive-ownership'
      holder:
        | { kind: 'runtime'; runtimeId: string }
        | { kind: 'managed-server'; environmentId: string }
    }
  | {
      /** Owned by the asking environment, but no durable record of why. */
      code: 'octopod_migration_owner_unrecorded'
      category: 'exclusive-ownership'
    }
  | {
      code: 'octopod_migration_direct_ssh_repositories'
      category: 'drainable-static-state'
      repositories: OctopodMigrationRepository[]
    }
  | {
      code: 'octopod_migration_direct_ssh_folder_workspaces'
      category: 'drainable-static-state'
      folderWorkspaces: OctopodMigrationFolderWorkspace[]
    }
  | {
      code: 'octopod_migration_direct_ssh_terminal_leases'
      category: 'live-or-unverifiable'
      terminalLeases: OctopodMigrationTerminalLease[]
    }
  | {
      code: 'octopod_migration_saved_port_forwards'
      category: 'client-owned-state'
      portForwards: SavedPortForward[]
    }
  | {
      code: 'octopod_migration_dependent_state'
      category: 'client-owned-state'
      dependencies: OctopodMigrationDependency[]
    }
  | {
      code: 'octopod_migration_dependency_unverifiable'
      category: 'live-or-unverifiable'
      sources: OctopodMigrationDependencyKind[]
    }

export type OctopodMigrationPreflight = {
  targetId: string
  targetLabel: string | null
  claimable: boolean
  blockers: OctopodMigrationBlocker[]
}
