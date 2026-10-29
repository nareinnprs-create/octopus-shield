import type { PairingOffer } from '../../shared/pairing'
import type { OctopodTunnelIdentity } from '../managed-server/lifecycle/octopod-managed-tunnel-identity'
import type { ServeReadiness } from '../server/serve-readiness'
import type { OctopodHostTransport } from '../ssh/octopod-host-transport'
import type { StartedPortForward } from '../ssh/port-forwarding/ssh-port-forward-provider'
import type { WslDistroHolder } from './wsl-distro-holder'
import type { WslOctopodConnectionStatus } from './wsl-octopod-connection-status'
import type {
  WslOctopodDeferredUpdate,
  WslOctopodDeployOptions,
  WslOctopodLaunch
} from './wsl-octopod-deploy'
import type { WslOctopodHostTarget } from './wsl-octopod-host-target'
import type { WslOctopodPairingRecovery } from './wsl-octopod-pairing-identity'
import type { WslOctopodStdioBridgeOptions } from './wsl-octopod-stdio-bridge'

/** One open bridge to a distro's octopod, as the connection manager publishes it. */
export type WslOctopodConnection = {
  distro: string
  environmentId: string
  /** The loopback port on this machine the pairing offer points at. */
  localPort: number
  /** octopod's port inside the distro. */
  remotePort: number
  fullVersion: string
  /** octopod's pid inside the distro, from its pid file; null when unreadable. */
  pid: number | null
  /** octopod's pairing code, with its endpoint rewritten to `ws://127.0.0.1:<localPort>`. */
  pairingOffer: string
  /** An app update the incumbent `fullVersion` is waiting to take (live terminals). */
  deferredUpdate: WslOctopodDeferredUpdate | null
  close(): Promise<void>
}

export type WslOctopodConnectionDependencies = {
  holder?: WslDistroHolder
  getPairingOffer?: (environmentId: string) => PairingOffer | null
  /** The bridge port the host's record saved: rebinding it keeps the pairing across app restarts. */
  recordedLocalPort?: (environmentId: string) => number | null
  deployAndLaunch?: (distro: string, options: WslOctopodDeployOptions) => Promise<WslOctopodLaunch>
  createTransport?: (target: WslOctopodHostTarget) => OctopodHostTransport
  listen?: (
    transport: OctopodHostTransport,
    options: WslOctopodStdioBridgeOptions
  ) => Promise<StartedPortForward>
  verifyIdentity?: (pairingOffer: string, readiness: ServeReadiness) => Promise<OctopodTunnelIdentity>
  /** Re-pairs a refused enrolled token; without it a refusal fails the connect. */
  pairingRecovery?: Omit<WslOctopodPairingRecovery, 'environmentId'>
  /** A connection (re)opened, its offer changed, or its status moved; null once it closed. */
  onChange?: (
    distro: string,
    connection: WslOctopodConnection | null,
    status: WslOctopodConnectionStatus
  ) => void
}
