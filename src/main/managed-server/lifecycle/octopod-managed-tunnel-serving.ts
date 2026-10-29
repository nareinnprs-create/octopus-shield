// Reread readiness after unanswered tunnels: another desktop may have restarted octopod on a new port.
import type { KnownRuntimeEnvironment } from '../../../shared/runtime-environments'
import type { OctopodManagedServing } from './octopod-managed-serving'
import type { OctopodManagedServingCheck } from './octopod-managed-tunnel-resume'
import type { ActiveOctopodTunnel } from './octopod-managed-tunnel-active'
import type { SshPortForwardManager } from '../../ssh/port-forwarding/ssh-port-forward'
import type { SshTarget } from '../../../shared/ssh-types'
import type { OctopodManagedTunnelTargeting } from './octopod-managed-tunnel-target'

export type OctopodTunnelServing = OctopodManagedServing & { rebind?: true }

export async function checkManagedTunnelServing(input: {
  environment: KnownRuntimeEnvironment
  active: Map<string, ActiveOctopodTunnel>
  getTarget: (targetId: string) => SshTarget | null | undefined
  forwards: Pick<SshPortForwardManager, 'removeForwardAndWait'>
  ensureServing: OctopodManagedServingCheck | undefined
  readPublishedPort?: OctopodManagedTunnelTargeting['readPublishedPort']
}): Promise<OctopodTunnelServing> {
  const { environment, active: tunnels } = input
  const active = tunnels.get(environment.id)
  const target = active && input.getTarget(active.targetId)
  if (!active || !target || !input.ensureServing) {
    return { state: 'unverifiable', detail: 'The tunnel to this host’s Shield server is not up.' }
  }
  const serving = await input.ensureServing({
    environment,
    target,
    connection: active.connection,
    remotePort: active.remotePort
  })
  const boundPort =
    serving.state === 'started'
      ? serving.boundPort
      : serving.state === 'unverifiable'
        ? ((await input.readPublishedPort?.({
            environment,
            target,
            connection: active.connection
          })) ?? null)
        : null
  if (boundPort === null || boundPort === active.remotePort) {
    return serving
  }
  if (tunnels.get(environment.id) === active) {
    tunnels.delete(environment.id)
  }
  await input.forwards.removeForwardAndWait(active.forwardId)
  return { ...serving, rebind: true }
}
