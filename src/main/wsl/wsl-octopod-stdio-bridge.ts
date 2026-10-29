/** D2: each accepted loopback socket owns a pinned-Node wsl.exe stdio bridge. Avoid WSL localhost forwarding, whose startup refusal window and network-mode dependence make it unreliable. */
import type { OctopodHostTransport } from '../ssh/octopod-host-transport'
import {
  OCTOPOD_STDIO_BRIDGE_DEPENDENCIES,
  startOctopodStdioBridge,
  type OctopodStdioBridgeDependencies
} from '../managed-server/lifecycle/octopod-stdio-bridge-provider'
import type { StartedPortForward } from '../ssh/port-forwarding/ssh-port-forward-provider'

export type WslOctopodStdioBridgeOptions = {
  environmentId: string
  /** octopod's loopback port inside the distro. */
  remotePort: number
  /** 0 picks a free one. */
  localPort: number
  label: string
}

export function listenWslOctopodStdioBridge(
  transport: OctopodHostTransport,
  options: WslOctopodStdioBridgeOptions,
  dependencies: OctopodStdioBridgeDependencies = OCTOPOD_STDIO_BRIDGE_DEPENDENCIES
): Promise<StartedPortForward> {
  return startOctopodStdioBridge(
    transport,
    {
      id: `wsl-octopod:${options.environmentId}`,
      connectionId: options.environmentId,
      localHost: '127.0.0.1',
      localPort: options.localPort,
      remoteHost: '127.0.0.1',
      remotePort: options.remotePort,
      label: options.label
    },
    dependencies
  )
}

type WslOctopodStdioBridgeListen = (
  transport: OctopodHostTransport,
  options: WslOctopodStdioBridgeOptions
) => Promise<StartedPortForward>

/** A persisted local port may be taken by now; a free one beats no connection. */
export async function listenWslOctopodStdioBridgeOnPreferredPort(
  transport: OctopodHostTransport,
  options: WslOctopodStdioBridgeOptions,
  listen: WslOctopodStdioBridgeListen = listenWslOctopodStdioBridge
): Promise<StartedPortForward> {
  try {
    return await listen(transport, options)
  } catch (error) {
    if (options.localPort === 0) {
      throw error
    }
    console.warn(
      `[wsl] Could not rebind local port ${options.localPort}; picking another:`,
      error instanceof Error ? error.message : error
    )
    return listen(transport, { ...options, localPort: 0 })
  }
}
