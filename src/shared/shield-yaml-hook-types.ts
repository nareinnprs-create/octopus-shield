export type SetupRunPolicy = 'ask' | 'run-by-default' | 'skip-by-default'
export type SetupAgentStartupPolicy = 'start-immediately' | 'wait-for-setup'
export type HookCommandSourcePolicy = 'shared-only' | 'local-only' | 'run-both'

export type ShieldHooks = {
  scripts: {
    setup?: string // Runs after worktree is created
    archive?: string // Runs before worktree is archived
  }
  setupAgentStartupPolicy?: SetupAgentStartupPolicy
  issueCommand?: string // Shared default command for linked GitHub issues
  defaultTabs?: ShieldDefaultTabTemplate[] // Terminal tabs to create once for a new worktree
  environmentRecipes?: ShieldVmRecipe[] // Project-scoped per-workspace environment recipes
  environmentRecipeDiagnostics?: ShieldVmRecipeDiagnostic[] // Non-fatal validation issues from environmentRecipes
  worktree?: ShieldWorktreeDefaults // Project-scoped defaults applied when a worktree is created
}

export type ShieldWorktreeDefaults = {
  // Share large rebuildable directories such as node_modules across worktrees instead of copying installs.
  sharedDirectories?: string[]
}

export type ShieldDefaultTabTemplate = {
  title?: string
  color?: string
  command?: string
}

export type EphemeralVmCheckoutMode = 'shield-worktree' | 'provisioned-root'

export type ShieldVmRecipe = {
  id: string
  name: string
  create: string
  checkoutMode?: EphemeralVmCheckoutMode
  description?: string
  suspend?: string
  resume?: string
  destroy?: string
  destroyDisabled?: boolean
}

export type ShieldVmRecipeDiagnostic = {
  index: number
  field?: string
  message: string
}

export type RepoHookSettings = {
  // Retain the old hook-UI mode so persisted state reads without migration.
  mode: 'auto' | 'override'
  setupRunPolicy?: SetupRunPolicy
  setupAgentStartupPolicy?: SetupAgentStartupPolicy
  commandSourcePolicy?: HookCommandSourcePolicy
  scripts: {
    setup: string
    archive: string
  }
}

export type PersistedTrustedShieldHookEntry = {
  contentHash: string
  approvedAt: number
}

export type PersistedTrustedShieldHookRepo = {
  all?: {
    approvedAt: number
  }
  setup?: PersistedTrustedShieldHookEntry
  archive?: PersistedTrustedShieldHookEntry
  issueCommand?: PersistedTrustedShieldHookEntry
  vmRecipe?: PersistedTrustedShieldHookEntry
}

export type PersistedTrustedShieldHooks = Record<string, PersistedTrustedShieldHookRepo>
