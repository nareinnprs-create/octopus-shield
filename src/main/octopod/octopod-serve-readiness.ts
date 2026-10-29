import type { ServeReadiness } from '../server/serve-readiness'
import type { ShieldRuntimeRpcServer } from '../runtime/runtime-rpc'
import { buildServePairingReadiness } from '../server/serve-pairing-readiness'
import type { OctopodHealth } from './octopod-health'
import type { OctopodOptions } from './octopod-start-contract'

export async function buildOctopodServeReadiness(input: {
  options: OctopodOptions
  runtimeId: string
  rpc: Pick<ShieldRuntimeRpcServer, 'getWebSocketEndpoint' | 'createPairingOffer'>
  collectHealth: () => Promise<OctopodHealth>
}): Promise<ServeReadiness> {
  return {
    runtimeId: input.runtimeId,
    ...(await buildServePairingReadiness(input.options, input.rpc)),
    // WSL CLI reconciliation runs only in desktop launch, so no repair is pending here.
    managedWslCliReconciliation: 'settled',
    // Deployers inspect readiness health to reject hosts whose terminal daemon is unavailable.
    health: await input.collectHealth()
  }
}
