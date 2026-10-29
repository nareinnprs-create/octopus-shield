import type { NodeRuntimeTarget } from '../../../shared/node-runtime-pin'
import type { SshTarget } from '../../../shared/ssh-types'
import type { OctopodActivationRecord } from '../activation/octopod-activation-record'
import { readOctopodActivationRecord } from '../activation/octopod-activation-record-store'
import { resolveOctopodRuntimeTarget } from '../lifecycle/octopod-runtime-target'
import { prepareWindowsOctopodHost } from '../host-state/octopod-windows-host-preparation'
import {
  isWslOctopodHostTarget,
  type OctopodHostTarget,
  type OctopodHostTransport
} from '../../ssh/octopod-host-transport'
import {
  decideOctopodMachineHome,
  octopodMachineDataRoot,
  octopodMachineHomeDir,
  octopodMachineHomeProbeCommand,
  octopodMachineOwnershipUnresolvedMessage,
  parseOctopodMachineHomeProbe
} from '../host-state/octopod-machine-home'
import {
  octopodMachineClaimCommand,
  readOctopodMachineClaimAnswer
} from '../host-state/octopod-machine-claim-command'
import { execOctopodRemote, type OctopodRemoteExecTarget } from './octopod-remote-runtime-control'
import { readRemoteHomeCommand } from '../../ssh/ssh-remote-commands'
import { quotePosixShell } from '../../../shared/shell-argument-quoting'
import {
  isWindowsRemoteHost,
  joinRemotePath,
  normalizeRemoteHome,
  validateRemoteHome,
  type RemoteHostPlatform
} from '../../ssh/ssh-remote-platform'
import { detectRemoteHostPlatform } from '../../ssh/ssh-remote-platform-detection'
import { OctopodHostUnsupportedError } from '../../octopod/octopod-host-unavailable'
import { rememberSshHostPlatform } from '../../ssh/ssh-host-platform-memo'

/** Default SSH generic retains compatibility with lifecycle consumers requiring SSH-only fields. */
export type OctopodRemoteContext<Target extends OctopodHostTarget = SshTarget> = {
  activationRecord: OctopodActivationRecord
  /** Select a compatible runtime when host glibc is below the default pin's floor. */
  serverTarget: NodeRuntimeTarget
  connection: OctopodHostTransport
  host: RemoteHostPlatform
  /** Login or machine-specific home for shared-home isolation; userDataDir must follow the same owner. */
  remoteHome: string
  target: Target
  userDataDir: string
}

export async function resolveOctopodRemoteContext<Target extends OctopodHostTarget = SshTarget>(
  target: Target,
  connection: OctopodHostTransport,
  signal?: AbortSignal,
  detectedHost?: RemoteHostPlatform
): Promise<OctopodRemoteContext<Target>> {
  const host = detectedHost ?? (await detectRemoteHostPlatform(connection, { signal }))
  if (!host) {
    throw new OctopodHostUnsupportedError('Shield’s server doesn’t support this SSH host’s platform.')
  }
  const remote = { conn: connection, host, signal }
  const { octopodHome: remoteHome, userDataDir } = await resolveOctopodMachineHome(
    remote,
    !isWslOctopodHostTarget(target)
  )
  const serverTarget = await resolveOctopodRuntimeTarget({
    conn: connection,
    host,
    signal
  })
  if (!isWslOctopodHostTarget(target)) {
    rememberSshHostPlatform(target.id, host, serverTarget)
  }
  if (isWindowsRemoteHost(host)) {
    // Prepare pinned Node before even reading activation state on Windows.
    await prepareWindowsOctopodHost({
      conn: connection,
      host,
      remoteHome,
      serverTarget,
      signal
    })
  }
  const activationRecord = await readOctopodActivationRecord({
    ...remote,
    remoteHome
  })
  return {
    activationRecord,
    serverTarget,
    connection,
    host,
    remoteHome,
    target,
    userDataDir
  }
}

/** Resolve per-machine state for shared POSIX homes; Windows and WSL retain login-home placement. */
export async function resolveOctopodMachineHome(
  remote: OctopodRemoteExecTarget,
  keyByMachine: boolean
): Promise<{ loginHome: string; octopodHome: string; userDataDir: string }> {
  const { host } = remote
  if (!keyByMachine || isWindowsRemoteHost(host)) {
    const loginHome = normalizeRemoteHome(
      await execOctopodRemote(remote, readRemoteHomeCommand(host)),
      host
    )
    if (!validateRemoteHome(loginHome, host)) {
      throw new Error(`Remote home is not a valid path: ${loginHome.slice(0, 100)}`)
    }
    return {
      loginHome,
      octopodHome: loginHome,
      userDataDir: joinRemotePath(host, loginHome, '.shield')
    }
  }
  const probe = parseOctopodMachineHomeProbe(
    await execOctopodRemote(remote, octopodMachineHomeProbeCommand(host)),
    host
  )
  const { loginHome } = probe
  let decision = decideOctopodMachineHome(probe, host)
  if (decision.kind === 'unresolved') {
    throw new Error(
      octopodMachineOwnershipUnresolvedMessage(
        decision.machineKey,
        probe.identity?.hostname ?? null,
        decision.cause
      )
    )
  }
  if (decision.kind === 'claim') {
    const won = readOctopodMachineClaimAnswer(
      await execOctopodRemote(remote, octopodMachineClaimCommand(host, loginHome, decision.machineKey))
    )
    if (won.state !== 'present') {
      throw new Error(won.message)
    }
    decision =
      won.machineKey === decision.machineKey
        ? { kind: 'login-home' }
        : { kind: 'machine-home', machineKey: decision.machineKey }
  }
  if (decision.kind === 'login-home') {
    return {
      loginHome,
      octopodHome: loginHome,
      userDataDir: joinRemotePath(host, loginHome, '.shield')
    }
  }
  const octopodHome = octopodMachineHomeDir(host, loginHome, decision.machineKey)
  await execOctopodRemote(remote, `umask 077; mkdir -p ${quotePosixShell(octopodHome)}`)
  return {
    loginHome,
    octopodHome,
    userDataDir: octopodMachineDataRoot(host, loginHome, decision.machineKey)
  }
}
