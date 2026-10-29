import { refreshManagedOctopodPairing } from '../../shared/runtime-environment-managed-octopod-store'
import { resolveEnvironment } from '../../shared/runtime-environment-store'
import {
  getOctopodSshDeployment,
  getPreferredPairingOffer,
  type KnownRuntimeEnvironment
} from '../../shared/runtime-environments'
import type { ServeReadiness } from '../server/serve-readiness'
import { tunneledOctopodPairingCode } from './octopod-tunneled-pairing'

/** Saves the pairing a managed server published after an update, rollback or restart. */
export function refreshMaintainedOctopodPairing(
  userDataPath: string,
  environmentId: string,
  readiness: ServeReadiness
): KnownRuntimeEnvironment {
  // Reuse the enrolled grant after restart so pairing cannot replace this desktop’s identity (#29042).
  // Re-read because census may have repaired pairing or moved the tunnel port meanwhile.
  const current = resolveEnvironment(userDataPath, environmentId)
  const localPort = getOctopodSshDeployment(current)?.localPort
  if (localPort === undefined) {
    throw new Error('This server is no longer managed over SSH.')
  }
  const enrolled = getPreferredPairingOffer(current)
  const pairingCode = tunneledOctopodPairingCode(readiness, localPort, enrolled)
  return refreshManagedOctopodPairing(userDataPath, environmentId, pairingCode)
}
