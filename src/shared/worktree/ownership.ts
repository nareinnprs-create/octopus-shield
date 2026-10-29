import { isFolderRepo } from '../repo-kind'
import {
  getRuntimePathBasename,
  resolveRuntimePath,
  normalizeRuntimePathForComparison,
  relativePathInsideRoot
} from '../cross-platform-path'
import { parseWslUncPath } from '../wsl-paths'
import {
  isRuntimePathAbsoluteForRepo,
  resolveConfiguredWorktreeBasePaths,
  resolveWorkspaceLayoutPath
} from './configured-worktree-base-path'
import {
  isAgentScratchWorktreePath,
  type AgentScratchWorktreePathMatcher
} from '../agent-scratch-worktrees'
import {
  createWorktreeVisibilitySourceMatcher,
  resolveCustomWorktreeVisibilitySources,
  type WorktreeVisibilitySourceMatcher
} from './visibility-sources'
import { isLegacyRepoForExternalWorktreeVisibility } from '../external-worktree-visibility'
import { shouldShowWorktree } from '../worktree-visibility-resolution'
import type { GlobalSettings, ShieldWorkspaceLayout } from '../global-settings-types'
import type { Repo } from '../repo-types'
import type { WorktreeMeta } from './meta-types'
import type { DetectedWorktree, Worktree, WorktreeOwnership } from './types'

export {
  effectiveAgentWorktreeVisibility,
  effectiveExternalWorktreeVisibility,
  EXTERNAL_WORKTREE_VISIBILITY_ROLLOUT_AT,
  isLegacyRepoForExternalWorktreeVisibility
} from '../external-worktree-visibility'
export { shouldShowWorktree } from '../worktree-visibility-resolution'

export function buildKnownShieldWorkspaceLayouts(
  settings: Pick<GlobalSettings, 'workspaceDir' | 'nestWorkspaces' | 'workspaceDirHistory'>,
  repo?: Pick<Repo, 'path' | 'connectionId' | 'worktreeBasePath'>
): ShieldWorkspaceLayout[] {
  const layouts: ShieldWorkspaceLayout[] = []
  for (const basePath of resolveConfiguredWorktreeBasePaths(repo)) {
    layouts.push({ path: basePath, nestWorkspaces: settings.nestWorkspaces })
  }
  if (settings.workspaceDir && shouldIncludeWorkspaceLayout(repo, settings.workspaceDir)) {
    layouts.push({
      path: repo
        ? resolveWorkspaceLayoutPath(repo.path, settings.workspaceDir)
        : settings.workspaceDir,
      nestWorkspaces: settings.nestWorkspaces
    })
    appendWorkspaceLayouts(
      layouts,
      (settings.workspaceDirHistory ?? [])
        .filter((layout) => shouldIncludeWorkspaceLayout(repo, layout.path))
        .map((layout) => ({
          ...layout,
          path: repo ? resolveWorkspaceLayoutPath(repo.path, layout.path) : layout.path
        }))
    )
  }

  const wslLayouts = repo ? buildWslWorkspaceLayouts(repo.path, settings) : []
  appendWorkspaceLayouts(layouts, wslLayouts)

  const seen = new Set<string>()
  return layouts.filter((layout) => {
    const key = `${normalizeRuntimePathForComparison(layout.path)}:${layout.nestWorkspaces}`
    if (seen.has(key)) {
      return false
    }
    seen.add(key)
    return Boolean(layout.path)
  })
}

function appendWorkspaceLayouts(
  target: ShieldWorkspaceLayout[],
  source: readonly ShieldWorkspaceLayout[]
): void {
  // Persisted workspace history can exceed the argument limit of push(...source).
  for (const layout of source) {
    target.push(layout)
  }
}

function shouldIncludeWorkspaceLayout(
  repo: Pick<Repo, 'path' | 'connectionId'> | undefined,
  layoutPath: string
): boolean {
  return !repo?.connectionId || !isRuntimePathAbsoluteForRepo(repo.path, layoutPath)
}

function buildWslWorkspaceLayouts(
  repoPath: string,
  settings: Pick<GlobalSettings, 'nestWorkspaces' | 'workspaceDirHistory'>
): ShieldWorkspaceLayout[] {
  const parsed = parseWslUncPath(repoPath)
  if (!parsed) {
    return []
  }
  const homeMatch = parsed.linuxPath.match(/^\/home\/[^/]+(?:\/|$)/)
  const linuxHome = homeMatch?.[0].replace(/\/$/, '')
  if (!linuxHome) {
    return []
  }
  const root = `//wsl.localhost/${parsed.distro}${linuxHome}/shield/workspaces`
  const historicalModes = (settings.workspaceDirHistory ?? []).map(
    (layout) => layout.nestWorkspaces
  )
  const modes = [settings.nestWorkspaces, ...historicalModes]
  return [...new Set(modes)].map((nestWorkspaces) => ({ path: root, nestWorkspaces }))
}

export function classifyWorktreeOwnership(args: {
  repo: Repo
  worktree: Pick<Worktree, 'path' | 'isMainWorktree'>
  meta?: WorktreeMeta
  settings: Pick<GlobalSettings, 'workspaceDir' | 'nestWorkspaces' | 'workspaceDirHistory'>
  knownShieldLayouts: ShieldWorkspaceLayout[]
  agentScratchWorktreePathMatcher?: AgentScratchWorktreePathMatcher
  worktreeVisibilitySourceMatcher?: WorktreeVisibilitySourceMatcher
}): WorktreeOwnership {
  if (hasStrongShieldMetadata(args.meta)) {
    return 'shield-managed'
  }

  // Classify tool scratch before layout heuristics; explicitly configured project bases remain exempt (#9388, #15232).
  if (
    args.worktreeVisibilitySourceMatcher?.(args.worktree.path)?.kind === 'built-in' ||
    (args.agentScratchWorktreePathMatcher?.(args.worktree.path) ??
      isAgentScratchWorktreePath(
        args.repo.path,
        args.worktree.path,
        resolveConfiguredWorktreeBasePaths(args.repo)
      ))
  ) {
    return 'agent-scratch'
  }

  if (
    resolveConfiguredWorktreeBasePaths(args.repo).some(
      (basePath) => relativePathInsideRoot(basePath, args.worktree.path) !== null
    )
  ) {
    // Why: an explicit project base is trusted even when global workspace nesting is flat.
    return 'external'
  }

  if (isUnderFlatOrUntrustedShieldRoot(args.worktree.path, args.knownShieldLayouts)) {
    return 'unknown-legacy'
  }

  if (canClassifyAsExternal(args.worktree.path, args.knownShieldLayouts)) {
    // An Shield-shaped path alone cannot prove creation; users can git worktree add there.
    return 'external'
  }

  return 'unknown-legacy'
}

export function toDetectedWorktree(args: {
  repo: Repo
  worktree: Worktree
  meta?: WorktreeMeta
  settings: Pick<
    GlobalSettings,
    'workspaceDir' | 'nestWorkspaces' | 'workspaceDirHistory' | 'worktreeVisibilityDefaults'
  >
  knownShieldLayouts: ShieldWorkspaceLayout[]
  isLegacyRepoForVisibility?: boolean
  agentScratchWorktreePathMatcher?: AgentScratchWorktreePathMatcher
  worktreeVisibilitySourceMatcher?: WorktreeVisibilitySourceMatcher
}): DetectedWorktree {
  const sourceMatcher =
    args.worktreeVisibilitySourceMatcher ??
    createWorktreeVisibilitySourceMatcher(
      [args.repo.path],
      resolveCustomWorktreeVisibilitySources(args.repo, args.settings.worktreeVisibilityDefaults),
      resolveConfiguredWorktreeBasePaths(args.repo)
    )
  const visibilitySource = sourceMatcher(args.worktree.path)
  const ownership = classifyWorktreeOwnership({
    ...args,
    worktreeVisibilitySourceMatcher: sourceMatcher
  })
  const selectedCheckout = areRuntimePathsEqual(args.worktree.path, args.repo.path)
  const isLegacyRepoForVisibility =
    args.isLegacyRepoForVisibility ?? isLegacyRepoForExternalWorktreeVisibility(args.repo)
  const visible = shouldShowWorktree({
    worktree: args.worktree,
    ownership,
    repo: args.repo,
    isLegacyRepoForVisibility,
    isSelectedCheckout: selectedCheckout,
    importedExternalWorktreePaths: args.repo.importedExternalWorktreePaths,
    visibilityDefaults: args.settings.worktreeVisibilityDefaults,
    visibilitySource
  })

  return {
    ...args.worktree,
    ownership,
    selectedCheckout,
    visible,
    ...(visibilitySource ? { visibilitySource } : {})
  }
}

export function applyMetadataFallbackVisibility(detected: DetectedWorktree): DetectedWorktree {
  if (detected.ownership === 'agent-scratch' || detected.visibilitySource) {
    // Why: retain scratch policy, including explicit imports, while ordinary fallback fails open.
    return detected
  }
  return {
    ...detected,
    visible: true,
    ownership: detected.ownership === 'shield-managed' ? 'shield-managed' : 'unknown-legacy'
  }
}

export function areRuntimePathsEqual(leftPath: string, rightPath: string): boolean {
  return (
    normalizeRuntimePathForComparison(leftPath) === normalizeRuntimePathForComparison(rightPath)
  )
}

function hasStrongShieldMetadata(meta: WorktreeMeta | undefined): boolean {
  return Boolean(
    meta?.shieldCreatedAt ||
    meta?.shieldCreationWorkspaceLayout ||
    meta?.createdAt ||
    meta?.createdWithAgent ||
    meta?.pushTarget ||
    meta?.sparseBaseRef ||
    meta?.sparsePresetId ||
    meta?.preserveBranchOnDelete
  )
}

function isUnderFlatOrUntrustedShieldRoot(
  worktreePath: string,
  knownShieldLayouts: ShieldWorkspaceLayout[]
): boolean {
  for (const layout of knownShieldLayouts) {
    const relative = relativePathInsideRoot(layout.path, worktreePath)
    if (relative === null) {
      continue
    }
    if (!layout.nestWorkspaces) {
      return true
    }
  }
  return false
}

function canClassifyAsExternal(
  worktreePath: string,
  knownShieldLayouts: ShieldWorkspaceLayout[]
): boolean {
  if (knownShieldLayouts.length === 0) {
    return false
  }
  for (const layout of knownShieldLayouts) {
    const relative = relativePathInsideRoot(layout.path, worktreePath)
    if (relative === null) {
      continue
    }
    return layout.nestWorkspaces
  }
  return true
}

export function managedWorktreeDirectories(
  repo: Pick<Repo, 'path' | 'kind' | 'worktreeBasePath' | 'connectionId'>,
  settings: Pick<GlobalSettings, 'workspaceDir' | 'nestWorkspaces' | 'workspaceDirHistory'>
): string[] {
  if (isFolderRepo(repo)) {
    return []
  }
  const configured = new Set(
    resolveConfiguredWorktreeBasePaths(repo).map(normalizeRuntimePathForComparison)
  )
  const repoName = getRuntimePathBasename(repo.path).replace(/\.git$/, '')
  const directories: string[] = []
  for (const layout of buildKnownShieldWorkspaceLayouts(settings, repo)) {
    if (configured.has(normalizeRuntimePathForComparison(layout.path))) {
      directories.push(layout.path)
    } else if (layout.nestWorkspaces && repoName) {
      directories.push(resolveRuntimePath(layout.path, repoName))
    }
  }
  return directories
}
