// Preferred ports may belong to other runtimes; tunnel to the active slot's published bound port.
import {
  getRuntimeSshAccess,
  type KnownRuntimeEnvironment
} from '../../../shared/runtime-environments'
import type { SshTarget } from '../../../shared/ssh-types'
import type { ServeReadiness } from '../../server/serve-readiness'
import { managedOctopodInstallDir } from './octopod-managed-runtime-context'
import { resolveOctopodRemoteContext } from '../install/octopod-remote-context'
import {
  parseOctopodReadinessWaitOutput,
  readOctopodReadinessNowCommand
} from '../install/octopod-remote-readiness-wait'
import {
  execOctopodRemote,
  type OctopodRemoteExecTarget
} from '../install/octopod-remote-runtime-control'
import type { OctopodHostTarget, OctopodHostTransport } from '../../ssh/octopod-host-transport'

export type OctopodTunnelPortInput = {
  environment: KnownRuntimeEnvironment
  target: SshTarget
  connection: OctopodHostTransport
}

export function octopodBoundPort(readiness: Pick<ServeReadiness, 'boundEndpoint'>): number | null {
  if (!readiness.boundEndpoint) {
    return null
  }
  try {
    const port = Number(new URL(readiness.boundEndpoint).port)
    return Number.isInteger(port) && port > 0 && port <= 65_535 ? port : null
  } catch {
    return null
  }
}

async function readManagedOctopodSlotReadiness(
  target: OctopodRemoteExecTarget & { remoteInstallDir: string }
): Promise<ServeReadiness | null> {
  const parsed = parseOctopodReadinessWaitOutput(
    target.host,
    await execOctopodRemote(
      target,
      readOctopodReadinessNowCommand(target.host, target.remoteInstallDir)
    )
  )
  return parsed.state === 'ready' ? parsed.readiness : null
}

export async function readActiveManagedOctopodReadiness(input: {
  target: OctopodHostTarget
  connection: OctopodHostTransport
}): Promise<ServeReadiness | null> {
  const context = await resolveOctopodRemoteContext(input.target, input.connection)
  const active = context.activationRecord.active
  if (!active) {
    return null
  }
  return readManagedOctopodSlotReadiness({
    conn: context.connection,
    host: context.host,
    remoteHome: context.remoteHome,
    remoteInstallDir: managedOctopodInstallDir(context, active)
  })
}

async function readActiveSlotBoundPort(input: OctopodTunnelPortInput): Promise<number | null> {
  if (!input.environment.octopodDeployment) {
    return null
  }
  const readiness = await readActiveManagedOctopodReadiness(input)
  return readiness ? octopodBoundPort(readiness) : null
}

export async function resolveManagedOctopodTunnelPort(input: OctopodTunnelPortInput): Promise<number> {
  const access = getRuntimeSshAccess(input.environment)
  if (!access) {
    throw new Error('Managed octopod environment is missing its SSH tunnel dependency.')
  }
  try {
    return (await readActiveSlotBoundPort(input)) ?? access.remotePort
  } catch (error) {
    // Post-forward identity validation still detects a wrong server when falling back.
    console.warn(
      '[ssh] Could not read the managed Shield server port; trying the preferred one:',
      error
    )
    return access.remotePort
  }
}

/** Missing or unreadable published ports never justify moving an existing tunnel. */
export async function readManagedOctopodPublishedPort(
  input: OctopodTunnelPortInput
): Promise<number | null> {
  try {
    return await readActiveSlotBoundPort(input)
  } catch {
    return null
  }
}
