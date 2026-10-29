import { hostMallocTunablesLaunchEnv } from '../memory/host-malloc-tunables'
import type { OctopodHostTransport } from '../ssh/octopod-host-transport'

/** An older slot would leak GLIBC_TUNABLES to user shells, so only this build's own slot gets it. */
export function withOwnBuildLaunchEnv<T extends OctopodHostTransport>(
  conn: T,
  ownBuildVersion: () => string | null
): T {
  const octopodLaunchEnv: OctopodHostTransport['octopodLaunchEnv'] = async (launch) => [
    ...((await conn.octopodLaunchEnv?.(launch)) ?? []),
    ...(launch.fullVersion === ownBuildVersion() ? hostMallocTunablesLaunchEnv() : [])
  ]
  // Delegate rather than spread so prototype methods survive; #private fields would still need explicit forwarding.
  return Object.create(conn, { octopodLaunchEnv: { value: octopodLaunchEnv } })
}
