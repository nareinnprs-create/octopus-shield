// Wait on-host in one bounded exec; repeated SSH polling spawned process bursts and triggered Windows EDR.
import { quotePosixShell } from '../../../shared/shell-argument-quoting'
import {
  isWindowsRemoteHost,
  joinRemotePath,
  type RemoteHostPlatform
} from '../../ssh/ssh-remote-platform'
import {
  OCTOPOD_PID_FILENAME,
  OCTOPOD_PID_MACHINE_FILENAME,
  OCTOPOD_READINESS_FILENAME,
  OCTOPOD_READINESS_MAX_BYTES,
  OCTOPOD_LAUNCH_MACHINE_COMMAND
} from './octopod-remote-host-support'
import {
  parseOctopodReadinessOutput,
  readOctopodReadinessCommand,
  type OctopodReadinessParse
} from './octopod-remote-launch'
import {
  octopodWindowsSlotOpCommand,
  readOctopodWindowsEncodedAnswer
} from './octopod-remote-windows-node'
import { OCTOPOD_WINDOWS_READINESS_MARKER } from '../host-state/octopod-windows-host-script'

// Stay below the 30-second exec timeout so waits can answer before channel expiry.
export const OCTOPOD_READINESS_WAIT_MAX_SECONDS = 20

const OCTOPOD_LAUNCH_EXITED_MARKER = 'OCTOPOD_LAUNCH_EXITED'

function posixReadinessWaitCommand(
  host: RemoteHostPlatform,
  remoteInstallDir: string,
  waitSeconds: number
): string {
  const file = quotePosixShell(joinRemotePath(host, remoteInstallDir, OCTOPOD_READINESS_FILENAME))
  const read = `head -c ${OCTOPOD_READINESS_MAX_BYTES + 1} ${file} 2>/dev/null`
  const pidFile = quotePosixShell(joinRemotePath(host, remoteInstallDir, OCTOPOD_PID_FILENAME))
  const pidMachine = quotePosixShell(
    joinRemotePath(host, remoteInstallDir, OCTOPOD_PID_MACHINE_FILENAME)
  )
  return [
    // Fail early only on proven exit from the launching machine; shared homes and unverified PIDs must keep waiting.
    `octopod_launch_here() { octopod_recorded=$(cat ${pidMachine} 2>/dev/null) && [ -n "$octopod_recorded" ] && [ "$octopod_recorded" = "$(${OCTOPOD_LAUNCH_MACHINE_COMMAND} 2>/dev/null)" ]; };`,
    `octopod_launch_exited() { octopod_launch_here || return 1; pid=$(cat ${pidFile} 2>/dev/null); case "$pid" in "" | *[!0-9]*) return 1;; esac;`,
    'probe_error=$(LC_ALL=C kill -0 "$pid" 2>&1) || { case "$probe_error" in *"No such process"*) return 0;; esac; return 1; };',
    'case "$(ps -o stat= -p "$pid" 2>/dev/null)" in Z*) return 0;; esac; return 1; };',
    // Probe fractional sleep once; POSIX hosts may support only integer seconds.
    'if sleep 0.25 2>/dev/null; then octopod_readiness_wait_step=0.25;',
    'else octopod_readiness_wait_step=1; fi;',
    // Bound elapsed time, not iterations: slow filesystem reads otherwise overrun the client exec deadline.
    `octopod_readiness_wait_end=$(($(date +%s) + ${waitSeconds}));`,
    'while [ "$(date +%s)" -lt "$octopod_readiness_wait_end" ]; do',
    `[ "$(${read} | wc -l)" -gt 0 ] && break;`,
    `[ "$(${read} | wc -c)" -gt ${OCTOPOD_READINESS_MAX_BYTES} ] && break;`,
    `octopod_launch_exited && { echo ${OCTOPOD_LAUNCH_EXITED_MARKER}; break; };`,
    'sleep "$octopod_readiness_wait_step"; done;',
    `${read} || true`
  ].join(' ')
}

export function octopodReadinessWaitCommand(
  host: RemoteHostPlatform,
  remoteInstallDir: string,
  waitSeconds: number
): string {
  const seconds = Math.max(0, Math.min(OCTOPOD_READINESS_WAIT_MAX_SECONDS, Math.ceil(waitSeconds)))
  if (!isWindowsRemoteHost(host)) {
    return posixReadinessWaitCommand(host, remoteInstallDir, seconds)
  }
  return octopodWindowsSlotOpCommand(host, remoteInstallDir, 'readiness-wait', [
    joinRemotePath(host, remoteInstallDir, OCTOPOD_READINESS_FILENAME),
    String(OCTOPOD_READINESS_MAX_BYTES),
    String(seconds)
  ])
}

export function parseOctopodReadinessWaitOutput(
  host: RemoteHostPlatform,
  output: string
): OctopodReadinessParse {
  return parseOctopodReadinessOutput(
    isWindowsRemoteHost(host)
      ? (readOctopodWindowsEncodedAnswer(output, OCTOPOD_WINDOWS_READINESS_MARKER) ?? '')
      : withoutLaunchExitedMarker(output)
  )
}

export function octopodLaunchExitedDuringWait(host: RemoteHostPlatform, output: string): boolean {
  return !isWindowsRemoteHost(host) && output.startsWith(`${OCTOPOD_LAUNCH_EXITED_MARKER}\n`)
}

function withoutLaunchExitedMarker(output: string): string {
  return output.startsWith(`${OCTOPOD_LAUNCH_EXITED_MARKER}\n`)
    ? output.slice(OCTOPOD_LAUNCH_EXITED_MARKER.length + 1)
    : output
}

export function readOctopodReadinessNowCommand(
  host: RemoteHostPlatform,
  remoteInstallDir: string
): string {
  // Windows host wait with zero delay substitutes for the unavailable head command.
  return isWindowsRemoteHost(host)
    ? octopodReadinessWaitCommand(host, remoteInstallDir, 0)
    : readOctopodReadinessCommand(host, remoteInstallDir)
}
