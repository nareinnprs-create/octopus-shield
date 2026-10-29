import { describe, expect, it } from 'vitest'
import { hostMallocTunablesLaunchEnv } from '../memory/host-malloc-tunables'
import type { OctopodHostTransport } from '../ssh/octopod-host-transport'
import { withOwnBuildLaunchEnv } from './wsl-octopod-own-build-launch-env'

function transport(): OctopodHostTransport {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the wrapper reads only octopodLaunchEnv.
  return {
    octopodLaunchEnv: async () => [['OSHIELD_WSL_DISTRO_GUID', 'g']]
  } as unknown as OctopodHostTransport
}

describe('withOwnBuildLaunchEnv', () => {
  it('adds the malloc tunables when the launched slot is this build', async () => {
    const conn = withOwnBuildLaunchEnv(transport(), () => '0.1.0+own')
    await expect(conn.octopodLaunchEnv?.({ fullVersion: '0.1.0+own' })).resolves.toEqual([
      ['OSHIELD_WSL_DISTRO_GUID', 'g'],
      ...hostMallocTunablesLaunchEnv()
    ])
  })

  it('withholds them from an older slot, which would leak them to user shells', async () => {
    const conn = withOwnBuildLaunchEnv(transport(), () => '0.1.0+own')
    await expect(conn.octopodLaunchEnv?.({ fullVersion: '0.1.0+older' })).resolves.toEqual([
      ['OSHIELD_WSL_DISTRO_GUID', 'g']
    ])
  })

  it('withholds them before this build’s version is known', async () => {
    const conn = withOwnBuildLaunchEnv(transport(), () => null)
    await expect(conn.octopodLaunchEnv?.({ fullVersion: '0.1.0+own' })).resolves.toEqual([
      ['OSHIELD_WSL_DISTRO_GUID', 'g']
    ])
  })

  it('keeps a class-based transport’s prototype methods', async () => {
    class ClassTransport {
      readonly prefix = 'ran:'
      describe(command: string): string {
        return `${this.prefix}${command}`
      }
    }
    // The wrapper only reads octopodLaunchEnv; a bare instance stands in for the full transport.
    const transport: OctopodHostTransport & ClassTransport = Object.create(new ClassTransport())
    const conn = withOwnBuildLaunchEnv(transport, () => null)
    expect(conn.describe('true')).toBe('ran:true')
    await expect(conn.octopodLaunchEnv?.({ fullVersion: '0.1.0+own' })).resolves.toEqual([])
  })
})
