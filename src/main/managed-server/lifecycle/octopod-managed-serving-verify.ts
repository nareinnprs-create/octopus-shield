import { resolveEnvironment } from '../../../shared/runtime-environment-store'
import type { OctopodManagedServing } from './octopod-managed-serving'
import { verifyManagedTunnelServing } from './octopod-managed-tunnel'

/** Return unverifiable on failures rather than throwing. */
export function verifyOctopodManagedServing(
  userDataPath: string,
  selector: string
): Promise<OctopodManagedServing> {
  return Promise.resolve()
    .then(() => verifyManagedTunnelServing(resolveEnvironment(userDataPath, selector)))
    .catch((error: unknown) => ({ state: 'unverifiable', detail: String(error) }))
}
