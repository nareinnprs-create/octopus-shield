// Redirect detached candidate stdout to its version directory so readiness does not hold SSH open.
import type { OctopodLaunchEnvEntry } from '../../ssh/octopod-host-transport'
import {
  OCTOPOD_LAUNCHER_FILENAME,
  OCTOPOD_SERVER_ENTRY_FILENAME
} from '../../../shared/octopod-artifacts'
import { quotePosixShell } from '../../../shared/shell-argument-quoting'
import {
  isWindowsRemoteHost,
  joinRemotePath,
  remoteBasename,
  remoteDirname,
  type RemoteHostPlatform
} from '../../ssh/ssh-remote-platform'
import { RELAY_REMOTE_DIR } from '../../ssh/remote-exec/remote-frame-protocol'
import { OCTOPOD_WSL_HOST_ENV } from '../../ipc/wsl-guest-windows-drive-path'
import {
  assertPosixOctopodHost as assertPosixHost,
  OCTOPOD_LOG_FILENAME,
  OCTOPOD_PID_FILENAME,
  OCTOPOD_LAUNCH_MACHINE_COMMAND,
  OCTOPOD_PID_MACHINE_FILENAME,
  OCTOPOD_READINESS_FILENAME,
  OCTOPOD_READINESS_MAX_BYTES,
  posixProcessAliveShellFunction
} from './octopod-remote-host-support'
import type { ServeReadiness } from '../../server/serve-readiness'
import { selectOctopodSlotRuntimeCommand } from './octopod-remote-runtime'
import { OCTOPOD_STOP_REQUEST_FILENAME } from '../../../shared/octopod-stop-request'
import { octopodWindowsSlotOpCommand } from './octopod-remote-windows-node'
import {
  captureOctopodLaunchSshSessionCommand,
  recordsOctopodLaunchSshSession,
  writeOctopodLaunchSshSessionCommand
} from '../../ssh/octopod-launch-ssh-session'
import {
  OCTOPOD_E2E_IDLE_TIMEOUT_ENV,
  readOctopodE2EIdleTimeoutMs
} from '../../../shared/octopod-idle-exit'
import { OCTOPOD_MANAGED_ACTIVATION_ROOT_ENV } from '../../../shared/octopod-managed-launch-env'

export type OctopodLaunchSpec = {
  remoteInstallDir: string
  nodePath: string
  fullVersion: string
  /** Shared across versions; rollback requires a snapshot. */
  userDataDir: string
  bindHost: string
  port: number
  /** Shared activation fence; managed SSH launches may idle out. */
  activationRoot: string
}

/** Older octopod versions ignore these launch variables. */
export function octopodManagedLaunchEnv(
  spec: OctopodLaunchSpec,
  env: NodeJS.ProcessEnv = process.env
): [string, string][] {
  const e2eTimeout = readOctopodE2EIdleTimeoutMs(env)
  return [
    [OCTOPOD_MANAGED_ACTIVATION_ROOT_ENV, spec.activationRoot],
    ...(e2eTimeout === null
      ? []
      : [[OCTOPOD_E2E_IDLE_TIMEOUT_ENV, String(e2eTimeout)] satisfies [string, string]])
  ]
}

/** WSL without systemd kills nohup children with wsl.exe --exec; use a separate session. */
export type OctopodLaunchDetach = 'nohup' | 'setsid'

const OCTOPOD_SETSID_PID_WAIT_TRIES = 100

/** Halving V8's 16 MB semi-spaces saves ~30 MB idle RSS; a CLI flag because the heap cannot be resized later. */
export const OCTOPOD_RUNTIME_V8_FLAGS = '--max-semi-space-size=8'

/** Pass bind explicitly so launch policy cannot change with installed-version defaults. */
export function octopodLaunchCommand(
  host: RemoteHostPlatform,
  spec: OctopodLaunchSpec,
  detach: OctopodLaunchDetach = 'nohup',
  hostEnv: readonly OctopodLaunchEnvEntry[] = []
): string {
  assertPosixHost(host)
  const dir = quotePosixShell(spec.remoteInstallDir)
  // Relative artifact paths reduce command size; every use follows the same-shell cd.
  const readiness = quotePosixShell(OCTOPOD_READINESS_FILENAME)
  const log = quotePosixShell(OCTOPOD_LOG_FILENAME)
  // PID writes run outside nohup’s backgrounded cd; reuse one absolute path to stay within command budgets.
  const pidFile = '"$octopod_pid"'
  // Liveness matches runtime argv against the absolute entry path.
  const entry = quotePosixShell(
    joinRemotePath(host, spec.remoteInstallDir, OCTOPOD_LAUNCHER_FILENAME)
  )
  const baseDir = remoteDirname(spec.remoteInstallDir.replace(/\/+$/u, ''), host)
  // Tighten only the managed root, never an unrelated custom-slot parent.
  const privateDirs = [
    ...(remoteBasename(baseDir, host) === RELAY_REMOTE_DIR ? [baseDir] : []),
    spec.remoteInstallDir
  ]
  // Capture in the launching shell; detached subshell variables do not return here.
  const recordSession = detach === 'nohup' && recordsOctopodLaunchSshSession(host)
  const launchEnv = [
    `OSHIELD_VERSION=${quotePosixShell(spec.fullVersion)}`,
    `OSHIELD_USER_DATA=${quotePosixShell(spec.userDataDir)}`,
    ...octopodManagedLaunchEnv(spec).map(([name, value]) => `${name}=${quotePosixShell(value)}`)
  ]
  return [
    `octopod_pid=${quotePosixShell(joinRemotePath(host, spec.remoteInstallDir, OCTOPOD_PID_FILENAME))};`,
    // Record the launching machine before detaching; absent boot identity leaves it unverified.
    `{ ${OCTOPOD_LAUNCH_MACHINE_COMMAND};}>"$octopod_pid${OCTOPOD_PID_MACHINE_FILENAME.slice(OCTOPOD_PID_FILENAME.length)}" 2>/dev/null;`,
    ...(recordSession ? [captureOctopodLaunchSshSessionCommand()] : []),
    // Preserve login umask for daemon children creating user files.
    'octopod_login_umask=$(umask);',
    // Pairing-token artifacts need umask 077 from creation; semicolon also covers the external PID write.
    'umask 077;',
    // Tighten existing artifacts best-effort; umask cannot repair their modes.
    `{ chmod 700 ${privateDirs.map(quotePosixShell).join(' ')} 2>/dev/null || :; } &&`,
    `cd ${dir} &&`,
    `${selectOctopodSlotRuntimeCommand(host, spec.remoteInstallDir, spec.nodePath)} &&`,
    // Truncate so relaunch cannot activate on the previous process’s readiness.
    `: > ${readiness} &&`,
    // Required: truncating redirects retain old file modes.
    `chmod 600 ${readiness} &&`,
    `{ chmod 600 ${pidFile} ${log} 2>/dev/null || :; } &&`,
    `rm -f ${quotePosixShell(OCTOPOD_STOP_REQUEST_FILENAME)} &&`,
    ...(detach === 'setsid' ? [`rm -f ${pidFile} &&`] : []),
    ...(detach === 'setsid'
      ? setsidLaunchTail(entry, spec, readiness, log, pidFile, launchEnv, hostEnv)
      : [
          // Open redirects under 077 before restoring daemon login umask.
          '{ umask "$octopod_login_umask" &&',
          ...launchEnv,
          // exec keeps $! equal to runtime PID; in-place launcher loading also preserves older clients’ argv checks.
          `exec nohup "$octopod_runtime" ${OCTOPOD_RUNTIME_V8_FLAGS} ${entry}`,
          `--json --bind ${quotePosixShell(spec.bindHost)} --port ${String(spec.port)};`,
          `} > ${readiness} 2>> ${log} < /dev/null &`,
          `echo $! > ${pidFile} &&`,
          ...(recordSession
            ? [`${writeOctopodLaunchSshSessionCommand(host, spec.userDataDir)} &&`]
            : []),
          `cat ${pidFile}`
        ])
  ].join(' ')
}

/** setsid -f exits its parent, so the exec child records $$; BusyBox uses background setsid without -f. */
function setsidLaunchTail(
  entry: string,
  spec: OctopodLaunchSpec,
  readiness: string,
  log: string,
  pidFile: string,
  launchEnv: readonly string[],
  hostEnv: readonly OctopodLaunchEnvEntry[]
): string[] {
  return [
    ...launchEnv,
    // Only WSL setsid launches receive this marker.
    `${OCTOPOD_WSL_HOST_ENV}=1`,
    ...hostEnv.map(launchEnvAssignment),
    'sh -c \'octopod_detach() { if setsid -f true >/dev/null 2>&1; then setsid -f "$@"; ' +
      'else setsid "$@" & fi; }; octopod_detach "$@"\' octopod-detach',
    `sh -c 'echo $$ > "$1" && umask "$2" && shift 2 && exec "$@"' octopod-launch ${pidFile}`,
    '"$octopod_login_umask"',
    `"$octopod_runtime" ${OCTOPOD_RUNTIME_V8_FLAGS} ${entry}`,
    `--json --bind ${quotePosixShell(spec.bindHost)} --port ${String(spec.port)}`,
    `> ${readiness} 2>> ${log} < /dev/null &&`,
    `octopod_wait=0; while [ ! -s ${pidFile} ] && [ "$octopod_wait" -lt ${OCTOPOD_SETSID_PID_WAIT_TRIES} ];`,
    'do sleep 0.05; octopod_wait=$((octopod_wait + 1)); done;',
    `cat ${pidFile}`
  ]
}

function launchEnvAssignment([name, value, mode]: OctopodLaunchEnvEntry): string {
  if (mode !== 'keep-existing') {
    return `${assertEnvName(name)}=${quotePosixShell(value)}`
  }
  // Inside "${NAME:-default}" quotes are literal, so only quote-free defaults are expressible.
  if (!/^[A-Za-z0-9._=:,/-]+$/.test(value)) {
    throw new Error(`octopod_launch_env_default_invalid:${name}`)
  }
  return `${assertEnvName(name)}="\${${name}:-${value}}"`
}

function assertEnvName(name: string): string {
  if (!/^[A-Z_][A-Z0-9_]*$/.test(name)) {
    throw new Error(`octopod_launch_env_name_invalid:${name}`)
  }
  return name
}

export function readOctopodReadinessCommand(
  host: RemoteHostPlatform,
  remoteInstallDir: string
): string {
  assertPosixHost(host)
  const readiness = quotePosixShell(
    joinRemotePath(host, remoteInstallDir, OCTOPOD_READINESS_FILENAME)
  )
  return `head -c ${OCTOPOD_READINESS_MAX_BYTES + 1} ${readiness} 2>/dev/null || true`
}

/** LIVE/DEAD/UNKNOWN distinguish proven state from missing/denied identity probes.
 * No PID or readiness file means NEVER_LAUNCHED, which also proves this slot has no process. */
export function octopodLivenessProbeCommand(
  host: RemoteHostPlatform,
  remoteInstallDir: string
): string {
  if (isWindowsRemoteHost(host)) {
    return octopodWindowsSlotOpCommand(host, remoteInstallDir, 'liveness', [remoteInstallDir])
  }
  const pidFile = quotePosixShell(joinRemotePath(host, remoteInstallDir, OCTOPOD_PID_FILENAME))
  const readiness = quotePosixShell(
    joinRemotePath(host, remoteInstallDir, OCTOPOD_READINESS_FILENAME)
  )
  const launcher = quotePosixShell(joinRemotePath(host, remoteInstallDir, OCTOPOD_LAUNCHER_FILENAME))
  const server = quotePosixShell(
    joinRemotePath(host, remoteInstallDir, OCTOPOD_SERVER_ENTRY_FILENAME)
  )
  return [
    posixProcessAliveShellFunction({ refuseUnverifiable: true }),
    // PID reuse needs argv identity; absent ps leaves conservative liveness checks to decide.
    `octopod_launcher=${launcher}; octopod_server=${server};`,
    // The probe's own shell, or the shell wrapping it, carries the slot paths in its argv; after a
    // restart either can hold the old PID. A shell elsewhere may be an older launcher's live parent.
    'octopod_reused() { { [ "$1" = "$$" ] || [ "$1" = "$PPID" ]; } && return 0; ' +
      'args=$(ps -o args= -p "$1" 2>/dev/null) && [ -n "$args" ] && ' +
      'case "$args" in *"$octopod_launcher"* | *"$octopod_server"*) return 1;; *) return 0;; esac; };',
    `pid=$(cat ${pidFile} 2>/dev/null);`,
    'case "$pid" in',
    `"" ) if [ -e ${pidFile} ] || [ -e ${readiness} ]; then echo UNKNOWN; else echo ${OCTOPOD_NEVER_LAUNCHED}; fi;;`,
    '*[!0-9]* ) echo UNKNOWN;;',
    '* ) if octopod_reused "$pid"; then echo DEAD; elif octopod_alive "$pid"; then echo LIVE; else echo DEAD; fi;;',
    'esac'
  ].join(' ')
}

export const OCTOPOD_NEVER_LAUNCHED = 'NEVER_LAUNCHED'

export type OctopodLiveness = 'LIVE' | 'DEAD' | 'UNKNOWN' | typeof OCTOPOD_NEVER_LAUNCHED

export function parseOctopodLiveness(output: string): OctopodLiveness {
  const value = output.trim().split('\n').pop()?.trim()
  return value === 'LIVE' || value === 'DEAD' || value === OCTOPOD_NEVER_LAUNCHED ? value : 'UNKNOWN'
}

/** Only DEAD/NEVER_LAUNCHED permit lifecycle changes; UNKNOWN proves nothing. */
export function octopodLivenessProvenExited(liveness: OctopodLiveness): boolean {
  return liveness === 'DEAD' || liveness === OCTOPOD_NEVER_LAUNCHED
}

export function octopodLivenessAnswerBlocksGc(output: string): boolean {
  return octopodLivenessBlocksGc(parseOctopodLiveness(output))
}

export function octopodLivenessBlocksGc(liveness: OctopodLiveness): boolean {
  return !octopodLivenessProvenExited(liveness)
}

export type OctopodReadinessParse =
  | { state: 'ready'; readiness: ServeReadiness }
  | { state: 'pending' }
  | { state: 'malformed'; reason: string }

/** Treat an unfinished last line as pending; polling can race a candidate stdout append. */
export function parseOctopodReadinessOutput(raw: string): OctopodReadinessParse {
  if (Buffer.byteLength(raw, 'utf8') > OCTOPOD_READINESS_MAX_BYTES) {
    return { state: 'malformed', reason: 'readiness payload exceeds the 256 KiB limit' }
  }
  const lines = raw.split('\n')
  for (const [index, line] of lines.entries()) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('{')) {
      continue
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      // Only an unterminated last line can recover from a partial write.
      return index === lines.length - 1
        ? { state: 'pending' }
        : { state: 'malformed', reason: 'readiness line is not valid JSON' }
    }
    if (typeof parsed !== 'object' || parsed === null) {
      continue
    }
    const payload = parsed as { type?: unknown }
    if (payload.type !== 'shield_server_ready') {
      return {
        state: 'malformed',
        reason: `expected an shield_server_ready line, got type=${JSON.stringify(payload.type)}`
      }
    }
    return { state: 'ready', readiness: toServeReadiness(payload as Record<string, unknown>) }
  }
  return { state: 'pending' }
}

function toServeReadiness(payload: Record<string, unknown>): ServeReadiness {
  return {
    runtimeId: typeof payload.runtimeId === 'string' ? payload.runtimeId : '',
    boundEndpoint: typeof payload.boundEndpoint === 'string' ? payload.boundEndpoint : null,
    advertisedEndpoint:
      typeof payload.advertisedEndpoint === 'string' ? payload.advertisedEndpoint : null,
    managedWslCliReconciliation:
      payload.managedWslCliReconciliation === 'pending' ||
      payload.managedWslCliReconciliation === 'failed'
        ? payload.managedWslCliReconciliation
        : 'settled',
    pairing: payload.pairing as ServeReadiness['pairing'],
    ...(payload.health ? { health: payload.health as ServeReadiness['health'] } : {})
  }
}
