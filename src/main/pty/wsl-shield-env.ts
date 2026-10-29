import {
  OSHIELD_SCRUB_SAFE_PANE_ENV,
  OSHIELD_SCRUB_SAFE_LAUNCH_ENV
} from '../../shared/agent-hook-scrub-safe-env'
import {
  ORCHESTRATION_COMPATIBILITY_ATTACHMENT_ENV,
  ORCHESTRATION_COMPATIBILITY_HOST_ID_ENV,
  ORCHESTRATION_COMPATIBILITY_HOST_INCARNATION_ENV,
  ORCHESTRATION_COMPATIBILITY_HOST_KIND_ENV
} from '../../shared/orchestration-compatibility-evidence'
import {
  SETUP_AGENT_SEQUENCE_STARTUP_COMMAND_ENV,
  SETUP_AGENT_SEQUENCE_STARTUP_SCRIPT_ENV
} from '../../shared/setup-agent-sequencing'
import { getShellReadyWrapperRoot } from '../providers/local-pty-shell-ready-wrapper-root'
import { OSHIELD_IMAGE_PROTOCOL_ENV } from '../../shared/terminal-image-protocol'
import {
  RUNTIME_SOURCE_ID_ENV,
  RUNTIME_SOURCE_INCARNATION_ENV,
  RUNTIME_SOURCE_PROFILE_PATH_ENV
} from '../../shared/runtime-source-env'
import {
  CODEX_REMOTE_VIEWER_SSH_CONNECTION,
  PI_CLIPBOARD_OSC52_ENV
} from '../ipc/pty/host-env/remote-viewer-clipboard-env'

const WSLENV_ENTRY_SEPARATOR = ':'

function parseWslenvEntries(value: string | undefined): string[] {
  return value ? value.split(WSLENV_ENTRY_SEPARATOR).filter(Boolean) : []
}

function upsertWslenvEntry(entries: string[], entry: string): void {
  const variableName = entry.split('/')[0]
  const existingIndex = entries.findIndex((value) => value.split('/')[0] === variableName)
  if (existingIndex === -1) {
    entries.push(entry)
    return
  }
  entries[existingIndex] = entry
}

function applyWslenvPassthrough(
  env: Record<string, string | undefined>,
  passthroughEntries: string[]
): void {
  const entries = parseWslenvEntries(env.WSLENV)
  for (const entry of passthroughEntries) {
    const variableName = entry.split('/')[0]
    if (env[variableName]) {
      upsertWslenvEntry(entries, entry)
    }
  }
  env.WSLENV = entries.join(WSLENV_ENTRY_SEPARATOR)
}

function worktreeSetupWslenvEntries(env: Record<string, string | undefined>): string[] {
  return [
    // Hooks need raw host paths translated (/p) and already-Linux paths unchanged (/u) (#9206).
    ...['OSHIELD_ROOT_PATH', 'OSHIELD_WORKTREE_PATH', 'CONDUCTOR_ROOT_PATH', 'GHOSTX_ROOT_PATH'].map(
      (name) => `${name}/${env[name]?.startsWith('/') ? 'u' : 'p'}`
    ),
    // A display name, never a path.
    'OSHIELD_WORKSPACE_NAME/u'
  ]
}

/** Adds the host environment values required by a WSL PTY and its guest relay. */
export function addShieldWslInteropEnv(env: Record<string, string>): void {
  // Local and daemon WSL spawns resolve the same content-addressed host wrapper tree.
  env.OSHIELD_SHELL_READY_ROOT = getShellReadyWrapperRoot()
  // The hook endpoint starts as a host path; guest relay discovery can replace it with an already-Linux path.
  const endpointFlag = env.OSHIELD_AGENT_HOOK_ENDPOINT?.startsWith('/') ? 'u' : 'p'
  // Only guest overlays may cross; translating inherited Windows overlays would make OpenCode adopt host config.
  const opencodeOverlayEntries = (['OPENCODE_CONFIG_DIR', 'OSHIELD_OPENCODE_CONFIG_DIR'] as const)
    .filter((name) => env[name]?.startsWith('/'))
    .map((name) => `${name}/u`)
  // wsl.exe imports only selected variables; publish pane identity and hook/wrapper coordinates.
  const passthroughEntries = [
    'OSHIELD_TERMINAL_HANDLE/u',
    'OSHIELD_USER_DATA_PATH/p',
    // Guests cannot derive the content hash; translate the resolved host wrapper root.
    'OSHIELD_SHELL_READY_ROOT/p',
    'OSHIELD_CLI_COMMAND/u',
    // Managed launcher lives in host userData.
    'OSHIELD_WSL_CLI_DIR/p',
    'OSHIELD_CODEX_LAUNCH_PREFLIGHT/p',
    'OSHIELD_CODEX_ISOLATE/u',
    'OSHIELD_PANE_KEY/u',
    `${OSHIELD_SCRUB_SAFE_PANE_ENV}/u`,
    'OSHIELD_TAB_ID/u',
    'OSHIELD_WORKTREE_ID/u',
    // Workspace identity must remain untranslated.
    'OSHIELD_WORKSPACE_ID/u',
    'OSHIELD_AGENT_LAUNCH_TOKEN/u',
    `${OSHIELD_SCRUB_SAFE_LAUNCH_ENV}/u`,
    // Select the pane-owning OpenCode variant when native and WSL installs coexist.
    'OSHIELD_OPENCODE_AGENT/u',
    `${SETUP_AGENT_SEQUENCE_STARTUP_COMMAND_ENV}/u`,
    `${SETUP_AGENT_SEQUENCE_STARTUP_SCRIPT_ENV}/u`,
    'OSHIELD_ORCHESTRATION_COMPATIBILITY_HOST_KIND/u',
    'OSHIELD_ORCHESTRATION_COMPATIBILITY_HOST_ID/u',
    'OSHIELD_ORCHESTRATION_COMPATIBILITY_HOST_INCARNATION/u',
    `${RUNTIME_SOURCE_ID_ENV}/u`,
    `${RUNTIME_SOURCE_INCARNATION_ENV}/u`,
    // Compare with the host CLI's userData path, never a translated guest path.
    `${RUNTIME_SOURCE_PROFILE_PATH_ENV}/u`,
    'OSHIELD_AGENT_HOOK_PORT/u',
    'OSHIELD_AGENT_HOOK_TOKEN/u',
    'OSHIELD_AGENT_HOOK_ENV/u',
    'OSHIELD_AGENT_HOOK_VERSION/u',
    'OSHIELD_AGENT_HOOK_TRANSPORT/u',
    `OSHIELD_AGENT_HOOK_ENDPOINT/${endpointFlag}`,
    ...opencodeOverlayEntries,
    'OSHIELD_WSL_HOOK_RELAY_VERSION/u',
    'OSHIELD_WSL_HOOK_INSTANCE/u',
    'OSHIELD_OMP_SOURCE_AGENT_DIR/p',
    `OSHIELD_OMP_STATUS_EXTENSION/${env.OSHIELD_OMP_STATUS_EXTENSION?.startsWith('/') ? 'u' : 'p'}`,
    ...(env.OSHIELD_PI_SOURCE_AGENT_DIR?.startsWith('/') ? ['OSHIELD_PI_SOURCE_AGENT_DIR/u'] : []),
    `${OSHIELD_IMAGE_PROTOCOL_ENV}/u`,
    'CLAUDE_CODE_FORCE_TERMINAL_IMAGES/u',
    ...(env.OSHIELD_CLAUDE_AGENT_VIEW_PLUGIN_DIR?.startsWith('/')
      ? ['OSHIELD_CLAUDE_AGENT_VIEW_PLUGIN_DIR/u', 'OSHIELD_CLAUDE_CONFIG_DIR/u']
      : []),
    // Forward only Shield's clipboard marker; a host SSH session must not leak into bare guest shells.
    ...(env.SSH_CONNECTION === CODEX_REMOTE_VIEWER_SSH_CONNECTION ? ['SSH_CONNECTION/u'] : []),
    `${PI_CLIPBOARD_OSC52_ENV}/u`,
    'OSHIELD_OMP_FRESH_CONFIG/p',
    ...worktreeSetupWslenvEntries(env)
  ]
  applyWslenvPassthrough(env, passthroughEntries)
}

export function stampWslOrchestrationCompatibilityHost(
  env: Record<string, string>,
  hostId: string | null | undefined,
  distro: string | null | undefined
): void {
  delete env[ORCHESTRATION_COMPATIBILITY_HOST_KIND_ENV]
  delete env[ORCHESTRATION_COMPATIBILITY_HOST_ID_ENV]
  delete env[ORCHESTRATION_COMPATIBILITY_HOST_INCARNATION_ENV]
  delete env[ORCHESTRATION_COMPATIBILITY_ATTACHMENT_ENV]
  const normalizedHostId = hostId?.trim()
  const normalizedDistro = distro?.trim()
  if (!normalizedHostId || !normalizedDistro) {
    return
  }
  env[ORCHESTRATION_COMPATIBILITY_HOST_KIND_ENV] = 'wsl'
  env[ORCHESTRATION_COMPATIBILITY_HOST_ID_ENV] = normalizedHostId
  env[ORCHESTRATION_COMPATIBILITY_HOST_INCARNATION_ENV] = normalizedDistro
}
