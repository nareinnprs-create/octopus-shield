import { getLegacyOpenCodeEnvKeysToDelete } from '../../opencode/legacy-shared-config-dir'
import { restoreManagedDataAccountEnvironment } from '../../../shared/managed-data-account-environment'
import { restoreOrStripOverlayEnv } from '../../../shared/agent-overlay-env'
import { delimiter } from 'node:path'
import { dropInheritedShieldFishHistory } from '../../fish-history-session'
import { removeAppImageRuntimeEnv } from '../../pty/appimage-terminal-env'
import { removeChromiumDisabledSessionBus } from '../../pty/chromium-session-bus-env'
import { stripInheritedBuildModeEnv } from '../../pty/build-mode-env'
import { stripPiProcessOwnerEnv } from '../../pty/pi-process-owner-env'
import { dropIncoherentCondaActivationEnv } from '../../pty/conda-activation-env'
import { stripLegacyTerminalShimEnv } from '../../pty/legacy-terminal-shim-dir'
import { removeInheritedNoColor } from '../../pty/terminal-color-env'
import { resolvePathEnvKey } from '../../pty/windows-environment-path'
import { dropInheritedShieldHistFile } from '../../worktree-history-file-path'
import {
  gitCredentialPromptGuardEnv,
  mergeGitConfigEnvProtocol
} from '../../../shared/git-credential-prompt-env'
import { TERMINAL_GIT_CREDENTIAL_GUARD_POLICY_ENV } from '../../../shared/terminal-git-credential-guard'
import {
  OSHIELD_IMAGE_PROTOCOL_ENV,
  OSHIELD_IMAGE_PROTOCOL_VALUE
} from '../../../shared/terminal-image-protocol'
import {
  expandWindowsEnvironmentVariables,
  expandWindowsPathEnvironmentVariables
} from '../../../shared/windows-environment-expansion'
import { applyScrubSafeAgentEnvAliases } from '../../../shared/agent-hook-scrub-safe-env'
import type { TuiAgent } from '../../../shared/tui-agent'
import type { PtySubprocessOptions } from '../pty-subprocess'
import { OCTOPOD_MANAGED_ACTIVATION_ROOT_ENV } from '../../../shared/octopod-managed-launch-env'

const PANE_IDENTITY_ENV_KEYS = [
  'OSHIELD_PANE_KEY',
  'OSHIELD_TAB_ID',
  'OSHIELD_WORKTREE_ID',
  'OSHIELD_AGENT_LAUNCH_TOKEN',
  // Not identity but equally per-spawn: an inherited copy names another launch's CLI.
  'OSHIELD_WSL_CLI_DIR',
  'JCODE_RUNTIME_DIR',
  // A server's own launch marker; a user's `octopod` in this shell is not client-managed.
  OCTOPOD_MANAGED_ACTIVATION_ROOT_ENV
] as const
const WINDOWS_PATH_ENV_KEY_RE = /^path$/i

function composeGuardedDaemonGitConfigEnv(
  env: Record<string, string>,
  explicitEnv: Record<string, string> | undefined,
  launchAgent: TuiAgent | undefined
): void {
  const policy = explicitEnv?.[TERMINAL_GIT_CREDENTIAL_GUARD_POLICY_ENV]
  delete env[TERMINAL_GIT_CREDENTIAL_GUARD_POLICY_ENV]
  if (policy !== 'guard' && launchAgent === undefined) {
    return
  }
  // Preserve the long-lived daemon’s inherited Git config while appending the guard.
  Object.assign(env, gitCredentialPromptGuardEnv(env, process.platform))
}

function deleteRequestedDaemonEnvKeys(
  env: Record<string, string>,
  keys: readonly string[] | undefined
): void {
  const userDataPath = process.env.OSHIELD_USER_DATA_PATH
  if (userDataPath) {
    for (const key of getLegacyOpenCodeEnvKeysToDelete(env, userDataPath, {})) {
      delete env[key]
    }
  }
  // Persistent daemon state may differ from Electron; remove CODEX_HOME only if its Shield overlay owns it.
  const deleteShieldOwnedCodexHome =
    keys?.includes('OSHIELD_CODEX_HOME') === true &&
    env.OSHIELD_CODEX_HOME !== undefined &&
    env.CODEX_HOME === env.OSHIELD_CODEX_HOME
  // A merged caller config can supersede the daemon's recorded overlay source.
  if (
    keys?.includes('OSHIELD_OPENCODE_CONFIG_DIR') &&
    (env.OPENCODE_CONFIG_DIR === undefined ||
      env.OPENCODE_CONFIG_DIR === env.OSHIELD_OPENCODE_CONFIG_DIR)
  ) {
    restoreOrStripOverlayEnv(
      env,
      {
        primary: 'OPENCODE_CONFIG_DIR',
        overlay: 'OSHIELD_OPENCODE_CONFIG_DIR',
        source: 'OSHIELD_OPENCODE_SOURCE_CONFIG_DIR'
      },
      {}
    )
  }
  for (const key of keys ?? []) {
    delete env[key]
  }
  if (deleteShieldOwnedCodexHome) {
    delete env.CODEX_HOME
  }
}

function removeUnspecifiedPaneIdentityEnv(
  env: Record<string, string>,
  explicitEnv: Record<string, string> | undefined
): void {
  for (const key of PANE_IDENTITY_ENV_KEYS) {
    if (!explicitEnv || !Object.hasOwn(explicitEnv, key)) {
      delete env[key]
    }
  }
}

/** Removes the second PATH key only when the daemon's env merge created it. */
function collapseWindowsPathEnvKeys(
  env: Record<string, string>,
  requestedEnv: Record<string, string> | undefined
): void {
  if (process.platform !== 'win32') {
    return
  }
  const pathKeys = Object.keys(env).filter((key) => WINDOWS_PATH_ENV_KEY_RE.test(key))
  if (pathKeys.length < 2) {
    return
  }
  // A single explicit PATH spelling is authoritative; otherwise preserve inherited keys.
  const requestedKeys = requestedEnv
    ? Object.keys(requestedEnv).filter((key) => WINDOWS_PATH_ENV_KEY_RE.test(key))
    : []
  if (requestedKeys.length !== 1) {
    return
  }
  const survivingKey = requestedKeys[0]
  if (!survivingKey || env[survivingKey] === undefined) {
    return
  }
  for (const key of pathKeys) {
    if (key !== survivingKey) {
      delete env[key]
    }
  }
}

function promoteAgentTeamsShimPath(
  env: Record<string, string>,
  requestedPath: string | undefined
): void {
  if (!env.OSHIELD_AGENT_TEAMS_TEAM_ID || !requestedPath) {
    return
  }
  const normalizedRequestedPath =
    process.platform === 'win32'
      ? expandWindowsEnvironmentVariables(requestedPath, env)
      : requestedPath
  const pathDelimiter = process.platform === 'win32' ? ';' : delimiter
  const shimDir = normalizedRequestedPath.split(pathDelimiter)[0]
  if (!shimDir) {
    return
  }
  const pathKey = resolvePathEnvKey(env, process.platform)
  const currentParts = env[pathKey]?.split(pathDelimiter).filter(Boolean) ?? []
  env[pathKey] = [shimDir, ...currentParts.filter((part) => part !== shimDir)].join(pathDelimiter)
}

/** A dev receiver without an endpoint file must not fall back to another runtime's file. */
function removeInheritedDevAgentHookEndpoint(
  env: Record<string, string>,
  explicitEnv: Record<string, string> | undefined
): void {
  if (explicitEnv?.OSHIELD_AGENT_HOOK_ENV === 'development' && !explicitEnv.OSHIELD_AGENT_HOOK_ENDPOINT) {
    // Preserve explicit endpoints used by hooks that scrub token-like environment variables.
    delete env.OSHIELD_AGENT_HOOK_ENDPOINT
  }
}

/** A persistent daemon's inherited environment cannot supply ownership for a new pane. */
export function createDaemonPtyEnvironment(opts: PtySubprocessOptions): Record<string, string> {
  const inheritedEnv = stripInheritedBuildModeEnv(process.env)
  restoreManagedDataAccountEnvironment(inheritedEnv)
  const env: Record<string, string> = {
    ...mergeGitConfigEnvProtocol(inheritedEnv, opts.env),
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    TERM_PROGRAM: 'Shield',
    TERM_PROGRAM_VERSION: process.env.OSHIELD_APP_VERSION ?? '0.0.0-dev',
    FORCE_HYPERLINK: '1',
    [OSHIELD_IMAGE_PROTOCOL_ENV]: OSHIELD_IMAGE_PROTOCOL_VALUE
  } satisfies Record<string, string>
  stripLegacyTerminalShimEnv(env, process.platform)
  composeGuardedDaemonGitConfigEnv(env, opts.env, opts.launchAgent)
  deleteRequestedDaemonEnvKeys(env, opts.envToDelete)
  if (opts.env?.TERM) {
    env.TERM = opts.env.TERM
  }
  removeUnspecifiedPaneIdentityEnv(env, opts.env)
  stripPiProcessOwnerEnv(env)
  if (opts.env?.fish_history === undefined) {
    dropInheritedShieldFishHistory(env)
  }
  if (opts.env?.HISTFILE === undefined) {
    dropInheritedShieldHistFile(env)
  }
  if (opts.env?.OSHIELD_HISTFILE === undefined) {
    delete env.OSHIELD_HISTFILE
  }
  removeInheritedDevAgentHookEndpoint(env, opts.env)
  delete env.ELECTRON_RUN_AS_NODE
  removeAppImageRuntimeEnv(env)
  removeChromiumDisabledSessionBus(env)
  removeInheritedNoColor(env)
  // Mirror pane identity only after stripping, so aliases cannot retain removed ownership.
  applyScrubSafeAgentEnvAliases(env)
  env.LANG ??= 'en_US.UTF-8'
  return env
}

/** Platform launch preparation must not undo the caller's explicit environment deletions. */
export function rescrubDaemonPtyEnvironment(
  env: Record<string, string>,
  opts: PtySubprocessOptions
): void {
  deleteRequestedDaemonEnvKeys(env, opts.envToDelete)
  if (opts.env?.TERM) {
    env.TERM = opts.env.TERM
  }
}

/** Shell preparation can restore ambient state, so pane isolation is enforced again here. */
export function finalizeDaemonPtyEnvironment(
  env: Record<string, string>,
  requestedEnv: Record<string, string> | undefined
): void {
  expandWindowsPathEnvironmentVariables(env)
  collapseWindowsPathEnvKeys(env, requestedEnv)
  const requestedPath = requestedEnv
    ? requestedEnv[resolvePathEnvKey(requestedEnv, process.platform)]
    : undefined
  promoteAgentTeamsShimPath(env, requestedPath)
  stripLegacyTerminalShimEnv(env, process.platform)
  dropIncoherentCondaActivationEnv(env, process.platform)
  stripPiProcessOwnerEnv(env)
  // A live daemon pins this runtime across app updates; callers cannot name the host executable.
  for (const key of Object.keys(env)) {
    if (key.toUpperCase() === 'OSHIELD_AGENT_HOOK_NODE') {
      delete env[key]
    }
  }
  if (process.platform === 'win32') {
    env.OSHIELD_AGENT_HOOK_NODE = process.execPath
  }
}
