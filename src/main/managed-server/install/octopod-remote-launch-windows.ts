// Win32-OpenSSH kills session jobs; require native breakaway without WMI/PowerShell, then record PID plus creation time.
import {
  OCTOPOD_WINDOWS_BREAKAWAY_CONTRACT,
  parseWindowsBreakawayLaunchReport,
  WINDOWS_BREAKAWAY_ENV_FLAG,
  WINDOWS_BREAKAWAY_LAUNCH_FLAG,
  WINDOWS_BREAKAWAY_PROCESS_FILE_FLAG,
  WINDOWS_BREAKAWAY_STDERR_FLAG,
  WINDOWS_BREAKAWAY_STDERR_KEEP_PREVIOUS_FLAG,
  WINDOWS_BREAKAWAY_STDOUT_FLAG
} from '../../../shared/windows-breakaway-launch'
import { joinRemotePath, type RemoteHostPlatform } from '../../ssh/ssh-remote-platform'
import {
  octopodWindowsNodeCommandLine,
  octopodWindowsSlotOpCommand,
  readOctopodWindowsEncodedAnswer
} from './octopod-remote-windows-node'
import {
  OCTOPOD_WINDOWS_ENTRY_MARKER,
  OCTOPOD_WINDOWS_RUNTIME_MARKER
} from '../host-state/octopod-windows-host-script'
import {
  OCTOPOD_LOG_FILENAME,
  OCTOPOD_READINESS_FILENAME,
  OCTOPOD_WINDOWS_PROCESS_FILENAME
} from './octopod-remote-host-support'
import { octopodManagedLaunchEnv, type OctopodLaunchSpec } from './octopod-remote-launch'
import { OCTOPOD_WINDOWS_LAUNCH_REFUSED_CODE } from '../../octopod/octopod-host-unavailable'

export class OctopodWindowsLaunchRefusedError extends Error {
  readonly code = OCTOPOD_WINDOWS_LAUNCH_REFUSED_CODE
  constructor(reason: string) {
    super(
      `The Windows host refused to start octopod outside the SSH session (${reason}). octopod needs ` +
        'a job that allows breakaway and a slot with the process-tree launcher; it never falls ' +
        'back to WMI.'
    )
    this.name = 'OctopodWindowsLaunchRefusedError'
  }
}

/** Resolve pinned slot runtime and remove stale instance-stop intent before launch. */
export function windowsOctopodLaunchRuntimeCommand(
  host: RemoteHostPlatform,
  slotDir: string
): string {
  return octopodWindowsSlotOpCommand(host, slotDir, 'slot-runtime', [slotDir, 'clear-stop-request'])
}

export function readWindowsOctopodSlotRuntime(output: string): string {
  const runtime = readOctopodWindowsEncodedAnswer(output, OCTOPOD_WINDOWS_RUNTIME_MARKER)
  if (!runtime) {
    throw new Error('The Windows host did not name the runtime this octopod slot needs.')
  }
  return runtime
}

/** Older host scripts omit entry, implying the legacy single-file launcher. */
export function readWindowsOctopodSlotEntry(
  output: string,
  host: RemoteHostPlatform,
  slotDir: string
): string {
  return (
    readOctopodWindowsEncodedAnswer(output, OCTOPOD_WINDOWS_ENTRY_MARKER) ??
    joinRemotePath(host, slotDir, 'octopod.js')
  )
}

export function windowsOctopodLaunchCommand(
  host: RemoteHostPlatform,
  spec: OctopodLaunchSpec,
  slotRuntime: string,
  slotEntry = joinRemotePath(host, spec.remoteInstallDir, 'octopod.js')
): string {
  const dir = spec.remoteInstallDir
  return octopodWindowsNodeCommandLine(slotRuntime, [
    slotEntry,
    WINDOWS_BREAKAWAY_LAUNCH_FLAG,
    // CREATE_ALWAYS removes stale readiness before the launcher returns.
    WINDOWS_BREAKAWAY_STDOUT_FLAG,
    joinRemotePath(host, dir, OCTOPOD_READINESS_FILENAME),
    WINDOWS_BREAKAWAY_STDERR_FLAG,
    joinRemotePath(host, dir, OCTOPOD_LOG_FILENAME),
    // Preserve previous stderr for crash diagnosis across restart.
    WINDOWS_BREAKAWAY_STDERR_KEEP_PREVIOUS_FLAG,
    WINDOWS_BREAKAWAY_PROCESS_FILE_FLAG,
    joinRemotePath(host, dir, OCTOPOD_WINDOWS_PROCESS_FILENAME),
    WINDOWS_BREAKAWAY_ENV_FLAG,
    `OSHIELD_VERSION=${spec.fullVersion}`,
    WINDOWS_BREAKAWAY_ENV_FLAG,
    `OSHIELD_USER_DATA=${spec.userDataDir}`,
    ...octopodManagedLaunchEnv(spec).flatMap(([name, value]) => [
      WINDOWS_BREAKAWAY_ENV_FLAG,
      `${name}=${value}`
    ]),
    OCTOPOD_WINDOWS_BREAKAWAY_CONTRACT.argsFlag,
    '--json',
    '--bind',
    spec.bindHost,
    '--port',
    String(spec.port)
  ])
}

/** Return launched PID or surface native-breakaway refusal/failure. */
export function readWindowsOctopodLaunchReport(output: string): number {
  const report = parseWindowsBreakawayLaunchReport(OCTOPOD_WINDOWS_BREAKAWAY_CONTRACT, output)
  if (report?.method === 'breakaway') {
    return report.pid
  }
  if (report?.method === 'unavailable') {
    throw new OctopodWindowsLaunchRefusedError(
      report.step ? `${report.reason} at ${report.step}` : report.reason
    )
  }
  const detail =
    report?.method === 'failed'
      ? `${report.reason}${report.step ? ` at ${report.step}` : ''} (code ${String(report.code ?? 0)})`
      : 'no launch report'
  throw new Error(`octopod's Windows launcher did not start the candidate: ${detail}.`)
}
