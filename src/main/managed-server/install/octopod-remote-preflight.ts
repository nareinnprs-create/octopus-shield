import { randomUUID } from 'node:crypto'
import { OCTOPOD_NODE_RUNTIME_IDENTITY } from '../../../shared/octopod-node-runtime-identity'
import { OCTOPOD_NODE_RUNTIME_MARKER_FILENAME } from '../../../shared/octopod-artifacts'
import {
  OCTOPOD_PROFILE_PREFLIGHT_FLAG,
  OCTOPOD_PROFILE_PREFLIGHT_TIMEOUT_MS,
  parseOctopodProfilePreflight
} from '../../../shared/octopod-profile-preflight'
import { assertPosixOctopodHost } from './octopod-remote-host-support'
import {
  octopodWindowsNodeCommandLine,
  octopodWindowsSlotOpCommand,
  readOctopodWindowsEncodedAnswer
} from './octopod-remote-windows-node'
import { readWindowsOctopodSlotEntry } from './octopod-remote-launch-windows'
import { OCTOPOD_WINDOWS_RUNTIME_MARKER } from '../host-state/octopod-windows-host-script'
import { octopodNodeSlotRuntimeCommand, selectOctopodSlotEntryCommand } from './octopod-remote-runtime'
import { execCommand } from '../../ssh/remote-exec/remote-exec-command'
import { quotePosixShell } from '../../../shared/shell-argument-quoting'
import {
  isWindowsRemoteHost,
  joinRemotePath,
  type RemoteHostPlatform
} from '../../ssh/ssh-remote-platform'
import type { OctopodHostTransport } from '../../ssh/octopod-host-transport'

export function octopodProfilePreflightCommand(
  host: RemoteHostPlatform,
  directory: string,
  nonce: string
): string {
  assertPosixOctopodHost(host)
  // New candidates always use pinned Node; host Node fallback could mask an incomplete slot.
  const marker = quotePosixShell(
    joinRemotePath(host, directory, OCTOPOD_NODE_RUNTIME_MARKER_FILENAME)
  )
  const launch = [
    'OSHIELD_BACKGROUND_LAUNCH=1',
    '"$octopod_runtime"',
    '"$octopod_entry"',
    OCTOPOD_PROFILE_PREFLIGHT_FLAG,
    quotePosixShell(nonce)
  ].join(' ')
  return `[ -e ${marker} ] || exit 78; ${octopodNodeSlotRuntimeCommand(host, directory)}${selectOctopodSlotEntryCommand(host, directory)}; ${launch}`
}

export async function preflightInstalledOctopod(options: {
  conn: OctopodHostTransport
  host: RemoteHostPlatform
  remoteInstallDir: string
  fullVersion: string
  signal?: AbortSignal
}): Promise<void> {
  const nonce = randomUUID()
  const command = isWindowsRemoteHost(options.host)
    ? await windowsOctopodProfilePreflightCommand(options, nonce)
    : octopodProfilePreflightCommand(options.host, options.remoteInstallDir, nonce)
  const output = await execCommand(options.conn, command, {
    signal: options.signal,
    timeoutMs: OCTOPOD_PROFILE_PREFLIGHT_TIMEOUT_MS,
    wrapCommand: !isWindowsRemoteHost(options.host)
  })
  parseOctopodProfilePreflight(output, nonce, OCTOPOD_NODE_RUNTIME_IDENTITY, options.fullVersion)
}

// Windows uses plain argv; octopod opens no window and needs no background-launch environment.
async function windowsOctopodProfilePreflightCommand(
  options: {
    conn: OctopodHostTransport
    host: RemoteHostPlatform
    remoteInstallDir: string
    signal?: AbortSignal
  },
  nonce: string
): Promise<string> {
  const { host, remoteInstallDir } = options
  const slotAnswer = await execCommand(
    options.conn,
    octopodWindowsSlotOpCommand(host, remoteInstallDir, 'slot-runtime', [remoteInstallDir]),
    { signal: options.signal, wrapCommand: false }
  )
  const runtime = readOctopodWindowsEncodedAnswer(slotAnswer, OCTOPOD_WINDOWS_RUNTIME_MARKER)
  if (!runtime) {
    throw new Error('The Windows host did not name the runtime this octopod slot needs.')
  }
  return octopodWindowsNodeCommandLine(runtime, [
    readWindowsOctopodSlotEntry(slotAnswer, host, remoteInstallDir),
    OCTOPOD_PROFILE_PREFLIGHT_FLAG,
    nonce
  ])
}
