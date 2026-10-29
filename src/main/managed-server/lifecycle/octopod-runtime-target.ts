import type { NodeRuntimeTarget } from '../../../shared/node-runtime-pin'
import { resolveOctopodDeploymentTargetFacts } from '../../ssh/octopod-deployment-target'
import { OctopodHostUnsupportedError } from '../../octopod/octopod-host-unavailable'
import type { OctopodHostTransport } from '../../ssh/octopod-host-transport'
import { pinnedRuntimeTargetForHost } from '../../ssh/pinned-runtime-host-target'
import type { RemoteHostPlatform } from '../../ssh/ssh-remote-platform'

export async function resolveOctopodRuntimeTarget(options: {
  conn: OctopodHostTransport
  host: RemoteHostPlatform
  signal?: AbortSignal
  exec?: (command: string) => Promise<string>
}): Promise<NodeRuntimeTarget> {
  const facts = await resolveOctopodDeploymentTargetFacts(options)
  const target = pinnedRuntimeTargetForHost(facts)
  if (!target) {
    const glibc = facts.glibc ? `${facts.glibc.major}.${facts.glibc.minor}` : 'unknown'
    throw new OctopodHostUnsupportedError(
      `No Shield runtime supports ${facts.target} with glibc ${glibc}.`
    )
  }
  return target
}
