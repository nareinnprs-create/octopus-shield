import { OCTOPOD_LAUNCHER_FILENAME } from '../../../shared/octopod-artifacts'
import { quotePosixShell } from '../../../shared/shell-argument-quoting'
import { execOctopodRemote, type OctopodRemoteExecTarget } from './octopod-remote-runtime-control'
import { octopodWindowsSlotOpCommand } from './octopod-remote-windows-node'
import { OCTOPOD_BUILD_HASH_MARKER as BUILD_HASH_MARKER } from '../host-state/octopod-windows-host-script'
import {
  isWindowsRemoteHost,
  joinRemotePath,
  type RemoteHostPlatform
} from '../../ssh/ssh-remote-platform'

export async function readRemoteOctopodBuildHash(
  target: OctopodRemoteExecTarget,
  remoteInstallDir: string
): Promise<string> {
  const output = await execOctopodRemote(
    target,
    remoteOctopodBuildHashCommand(target.host, remoteInstallDir)
  )
  const match = output.match(new RegExp(`${BUILD_HASH_MARKER}\\s+([a-fA-F0-9]{16})`, 'u'))
  if (!match?.[1]) {
    throw new Error('Could not verify the installed octopod build hash.')
  }
  return match[1].toLowerCase()
}

export function remoteOctopodBuildHashCommand(
  host: RemoteHostPlatform,
  remoteInstallDir: string
): string {
  if (isWindowsRemoteHost(host)) {
    return octopodWindowsSlotOpCommand(host, remoteInstallDir, 'build-hash', [
      joinRemotePath(host, remoteInstallDir, OCTOPOD_LAUNCHER_FILENAME)
    ])
  }
  const path = quotePosixShell(joinRemotePath(host, remoteInstallDir, OCTOPOD_LAUNCHER_FILENAME))
  // GNU/BusyBox provide sha256sum, macOS shasum; both print the digest first.
  return [
    `[ -f ${path} ] && [ -r ${path} ] || exit 1;`,
    `shield_hash=$(if command -v sha256sum >/dev/null 2>&1; then sha256sum ${path} | awk '{print $1}';`,
    `elif command -v shasum >/dev/null 2>&1; then shasum -a 256 ${path} | awk '{print $1}'; fi);`,
    `case "$shield_hash" in [0-9a-fA-F][0-9a-fA-F]*) printf '%s %.16s\\n' ${quotePosixShell(BUILD_HASH_MARKER)} "$shield_hash";; esac`
  ].join(' ')
}
