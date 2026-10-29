/** macOS pins Local Network attribution at spawn: SSH-launched terminals can lose LAN access after sshd-session exits (#25934; Apple TN3179). Record the nearest session plus start time and matching slot PID; preserve earlier attribution while a live terminal daemon survives octopod restarts. */
import { quotePosixShell } from '../../shared/shell-argument-quoting'
import { joinRemotePath, type RemoteHostPlatform } from './ssh-remote-platform'
import { OCTOPOD_PID_FILENAME } from '../managed-server/install/octopod-remote-host-support'

export const OCTOPOD_LAUNCH_SSH_SESSION_FILENAME = '.octopod-launch-ssh-session'

const LOCAL_NETWORK_PRIVACY_MAJOR = 15
// Bounds the ancestor walk; real chains are a few processes deep.
const MAX_ANCESTOR_DEPTH = 32

export function recordsOctopodLaunchSshSession(host: RemoteHostPlatform): boolean {
  return host.os === 'darwin'
}

/** Choose the nearest sshd ancestor, which exits with this session; a listener farther up would remain alive. */
export function octopodSshSessionAncestorShellFunction(): string {
  return (
    'octopod_ssh_session() { octopod_sp=$1; octopod_si=0; ' +
    `while [ "$octopod_si" -lt ${MAX_ANCESTOR_DEPTH} ]; do ` +
    'case "$octopod_sp" in "" | *[!0-9]* | 0 | 1) return 1;; esac; ' +
    'octopod_sc=$(ps -o comm= -p "$octopod_sp" 2>/dev/null) || return 1; ' +
    'case "${octopod_sc##*/}" in sshd*) ' +
    'octopod_ss=$(ps -o lstart= -p "$octopod_sp" 2>/dev/null) || return 1; ' +
    // Why unquoted: normalizes lstart's padding so a later read compares equal.
    'echo "$octopod_sp" $octopod_ss; return 0;; esac; ' +
    'octopod_sp=$(ps -o ppid= -p "$octopod_sp" 2>/dev/null | tr -d " "); ' +
    'octopod_si=$((octopod_si + 1)); done; return 1; };'
  )
}

/** Capture before detach without failing launch. */
export function captureOctopodLaunchSshSessionCommand(): string {
  return (
    `${octopodSshSessionAncestorShellFunction()} ` +
    'octopod_session=$(octopod_ssh_session "$$" 2>/dev/null) || octopod_session=;'
  )
}

function recordPath(host: RemoteHostPlatform, userDataDir: string): string {
  return quotePosixShell(joinRemotePath(host, userDataDir, OCTOPOD_LAUNCH_SSH_SESSION_FILENAME))
}

/** Return 0 for this root's live daemon, 1 for absence, 2 for unreadable argv; PID files alone may name recycled processes. */
function liveDaemonShellFunction(host: RemoteHostPlatform, userDataDir: string): string {
  const daemonDir = quotePosixShell(joinRemotePath(host, userDataDir, 'daemon'))
  return (
    `octopod_daemon_live() { octopod_ddir=${daemonDir}; for octopod_df in "$octopod_ddir"/daemon-v*.pid; do ` +
    '[ -f "$octopod_df" ] || continue; ' +
    'octopod_dp=$(sed -n \'s/.*"pid":\\([0-9][0-9]*\\).*/\\1/p\' "$octopod_df" | head -n 1); ' +
    '[ -n "$octopod_dp" ] || continue; ' +
    'kill -0 "$octopod_dp" 2>/dev/null || continue; ' +
    'octopod_da=$(ps -o args= -p "$octopod_dp" 2>/dev/null); [ -n "$octopod_da" ] || return 2; ' +
    'case "$octopod_da" in *daemon-entry*"$octopod_ddir"* | *"$octopod_ddir"*daemon-entry*) return 0;; esac; ' +
    'done; return 1; };'
  )
}

/** After recording $!, preserve the live daemon's earlier session; otherwise record this launch's session. */
export function writeOctopodLaunchSshSessionCommand(
  host: RemoteHostPlatform,
  userDataDir: string
): string {
  const file = recordPath(host, userDataDir)
  return (
    // First-deploy detach may run before octopod creates its data root.
    `{ octopod_bg=$!; ( umask 077; mkdir -p ${quotePosixShell(userDataDir)} ); ` +
    `${liveDaemonShellFunction(host, userDataDir)} ` +
    'octopod_daemon_live; octopod_dl=$?; ' +
    'if [ "$octopod_dl" = 0 ]; then ' +
    `octopod_prev=$(cat ${file}); rm -f ${file}; set -- $octopod_prev; ` +
    `[ "$#" -lt 3 ] || { shift; ( umask 077; echo "$octopod_bg" "$@" > ${file} ); }; ` +
    // Unreadable daemon identity leaves attribution unknown, never assigned to this launch.
    `elif [ "$octopod_dl" = 2 ]; then rm -f ${file}; ` +
    `else rm -f ${file}; [ -z "$octopod_session" ] || ` +
    `( umask 077; echo "$octopod_bg" $octopod_session > ${file} ); fi; :; } 2>/dev/null`
  )
}

export function octopodLaunchSshSessionProbeCommand(
  host: RemoteHostPlatform,
  remoteInstallDir: string,
  userDataDir: string
): string {
  const file = recordPath(host, userDataDir)
  const pidFile = quotePosixShell(joinRemotePath(host, remoteInstallDir, OCTOPOD_PID_FILENAME))
  return [
    'octopod_mac=$(sw_vers -productVersion 2>/dev/null) || { echo NOT_APPLICABLE; exit 0; };',
    'octopod_major=${octopod_mac%%.*};',
    'case "$octopod_major" in "" | *[!0-9]*) echo UNVERIFIABLE; exit 0;; esac;',
    `[ "$octopod_major" -ge ${LOCAL_NETWORK_PRIVACY_MAJOR} ] || { echo NOT_APPLICABLE; exit 0; };`,
    `octopod_rec=$(cat ${file} 2>/dev/null) || { echo NOT_RECORDED; exit 0; };`,
    `octopod_pid=$(cat ${pidFile} 2>/dev/null);`,
    'set -- $octopod_rec;',
    'case "$1:$2" in *[!0-9:]* | :* | *:) echo NOT_RECORDED; exit 0;; esac;',
    '[ "$1" = "$octopod_pid" ] || { echo NOT_RECORDED; exit 0; };',
    'octopod_sshd=$2; shift 2; octopod_want=$*;',
    // A ps that can't list this shell can't prove another process absent.
    'ps -o pid= -p "$$" >/dev/null 2>&1 || { echo UNVERIFIABLE; exit 0; };',
    'octopod_now=$(ps -o lstart= -p "$octopod_sshd" 2>/dev/null); octopod_now=$(echo $octopod_now);',
    // A reused PID with another start time is a different process: the session is gone.
    'if [ -z "$octopod_now" ] || [ "$octopod_now" != "$octopod_want" ]; then echo EXITED; else echo LIVE; fi'
  ].join(' ')
}

/** `not-recorded` covers older launches and clients: the condition is unknown, never assumed. */
export type OctopodLaunchSshSession =
  | 'live'
  | 'exited'
  | 'unverifiable'
  | 'not-recorded'
  | 'not-applicable'

export function parseOctopodLaunchSshSession(output: string): OctopodLaunchSshSession {
  switch (output.trim().split('\n').pop()?.trim() ?? '') {
    case 'LIVE':
      return 'live'
    case 'EXITED':
      return 'exited'
    case 'NOT_RECORDED':
      return 'not-recorded'
    case 'NOT_APPLICABLE':
      return 'not-applicable'
    default:
      return 'unverifiable'
  }
}
