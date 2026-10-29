// Lost channels drop their sockets but keep the listener; tunnel reconnect logic owns recovery.
import { OctopodStdioBridgeUnavailableError } from '../../octopod/octopod-host-unavailable'
import type { OctopodHostTransport } from '../../ssh/octopod-host-transport'
import {
  checkOctopodStdioBridge,
  openOctopodStdioBridgeChannel,
  resolveOctopodStdioBridge,
  type OctopodStdioBridge
} from '../../ssh/octopod-stdio-bridge'
import { listenOctopodStdioBridge } from './octopod-stdio-bridge-listener'
import { sshOctopodHostTransport } from '../../ssh/octopod-ssh-host-transport'
import type { RemoteCommandChannel } from '../install/remote-install-transport'
import type { SshConnection } from '../../ssh/connection/ssh-connection'
import type {
  PortForwardStartOptions,
  SshPortForwardProvider,
  StartedPortForward
} from '../../ssh/port-forwarding/ssh-port-forward-provider'

export type OctopodStdioBridgeDependencies = {
  resolveBridge: (conn: OctopodHostTransport, port: number) => Promise<OctopodStdioBridge>
  checkBridge: (conn: OctopodHostTransport, bridge: OctopodStdioBridge) => Promise<unknown>
  openChannel: (conn: OctopodHostTransport, bridge: OctopodStdioBridge) => Promise<RemoteCommandChannel>
}

export const OCTOPOD_STDIO_BRIDGE_DEPENDENCIES: OctopodStdioBridgeDependencies = {
  resolveBridge: resolveOctopodStdioBridge,
  checkBridge: checkOctopodStdioBridge,
  openChannel: openOctopodStdioBridgeChannel
}

export class OctopodStdioBridgePortForwardProvider implements SshPortForwardProvider {
  constructor(
    private readonly dependencies: OctopodStdioBridgeDependencies = OCTOPOD_STDIO_BRIDGE_DEPENDENCIES
  ) {}

  canHandle(conn: SshConnection): boolean {
    return conn.getClient() !== null || conn.usesSystemSshTransport()
  }

  start(conn: SshConnection, options: PortForwardStartOptions): Promise<StartedPortForward> {
    return startOctopodStdioBridge(sshOctopodHostTransport(conn), options, this.dependencies)
  }
}

export async function startOctopodStdioBridge(
  host: OctopodHostTransport,
  options: PortForwardStartOptions,
  deps: OctopodStdioBridgeDependencies
): Promise<StartedPortForward> {
  let bridge: Promise<OctopodStdioBridge> | null = null
  // Retry failed bridge resolution on the next socket.
  const resolveBridge = (): Promise<OctopodStdioBridge> => {
    bridge ??= deps.resolveBridge(host, options.remotePort).catch((error: unknown) => {
      bridge = null
      throw error
    })
    return bridge
  }
  try {
    await deps.checkBridge(host, await resolveBridge())
  } catch (error) {
    if (error instanceof OctopodStdioBridgeUnavailableError) {
      throw error
    }
    // Lost contact does not prove bridge absence; let new sockets resolve it again.
    console.warn('[ssh] Shield stdio bridge check was unverifiable:', error)
  }
  return listenOctopodStdioBridge(options, async () => {
    const resolved = await resolveBridge()
    return { channel: await deps.openChannel(host, resolved), mode: resolved.mode }
  })
}
