import { pairedRuntimeConnectionFromOffer } from '../../shared/paired-runtime-connection'
import { parsePairingCode, type PairingOffer } from '../../shared/pairing'
import type { ServeReadiness } from '../server/serve-readiness'
import {
  octopodIdentityRefusal,
  verifyOctopodPairingIdentity,
  type OctopodTunnelIdentity
} from '../managed-server/lifecycle/octopod-managed-tunnel-identity'
import { tunneledOctopodPairingCode } from '../ssh/octopod-tunneled-pairing'
import { getPreferredPairingOffer } from '../../shared/runtime-environments'
import {
  buildWithPairingRepair,
  type ManagedOctopodPairingRecovery
} from '../managed-server/lifecycle/octopod-managed-tunnel-pairing-recovery'
import type { WslOctopodLaunch } from './wsl-octopod-deploy'

/** The managed repair gate a refused enrolled token goes through, for one WSL host. */
export type WslOctopodPairingRecovery = Omit<ManagedOctopodPairingRecovery, 'ensure'> & {
  environmentId: string
}

/** Reconnect with enrolled token/pinned host key. Repair refusal once through the gate and verify the replacement; startup offers are for enrollment only. */
export async function resolveWslOctopodPairing(
  launch: Extract<WslOctopodLaunch, { outcome: 'ready' }>,
  localPort: number,
  paired: PairingOffer | null,
  verifyIdentity = verifyWslOctopodIdentity,
  recovery?: WslOctopodPairingRecovery
): Promise<string> {
  const verified = (offer: PairingOffer | null) =>
    verifyWslOctopodPairing(launch, localPort, offer, verifyIdentity)
  // First-time pairing has no enrolled token to repair.
  if (!recovery || !paired) {
    return verified(paired)
  }
  let pairingOffer = ''
  await buildWithPairingRepair(
    {
      ...recovery,
      ensure: async (environment) => {
        pairingOffer = await verified(getPreferredPairingOffer(environment))
      }
    },
    recovery.environmentId,
    async () => {
      pairingOffer = await verified(paired)
    }
  )
  return pairingOffer
}

async function verifyWslOctopodPairing(
  launch: Extract<WslOctopodLaunch, { outcome: 'ready' }>,
  localPort: number,
  paired: PairingOffer | null,
  verifyIdentity: typeof verifyWslOctopodIdentity
): Promise<string> {
  const pairingOffer = tunneledOctopodPairingCode(launch.readiness, localPort, paired)
  const identity = await verifyIdentity(pairingOffer, launch.readiness)
  if (identity.verdict === 'foreign' || identity.verdict === 'unpaired') {
    throw octopodIdentityRefusal(launch.port, identity)
  }
  if (identity.verdict === 'unreachable') {
    console.warn(
      `[wsl] Shield server in ${launch.distro} did not answer its bridge: ${identity.detail}`
    )
  }
  return pairingOffer
}

/** Whether the server behind a WSL bridge is the octopod that published `readiness`. */
export async function verifyWslOctopodIdentity(
  pairingOffer: string,
  readiness: ServeReadiness
): Promise<OctopodTunnelIdentity> {
  const offer = parsePairingCode(pairingOffer)
  return offer
    ? verifyOctopodPairingIdentity(pairedRuntimeConnectionFromOffer(offer), {
        runtimeId: readiness.runtimeId || null
      })
    : { verdict: 'foreign', detail: 'The Shield server in WSL published an invalid pairing offer.' }
}
