import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  octopodBashStdioBridgeCommand,
  octopodPosixStdioBridgeCommand
} from '../managed-server/lifecycle/octopod-stdio-bridge-script'
import type { OctopodHostTransport } from './octopod-host-transport'
import { getRemoteHostPlatform } from './ssh-remote-platform'
import { resolveOctopodStdioBridge } from './octopod-stdio-bridge'

const detect = vi.hoisted(() => vi.fn())
vi.mock('./ssh-remote-platform-detection', () => ({ detectRemoteHostPlatform: detect }))

function transport(target: ReturnType<OctopodHostTransport['getTarget']>): OctopodHostTransport {
  const refuse = (): never => {
    throw new Error('no remote command expected')
  }
  return {
    getTarget: () => target,
    exec: refuse,
    usesSystemSshTransport: () => false,
    getConnectGeneration: () => 0,
    writeFile: refuse,
    uploadDirectory: refuse
  }
}

afterEach(() => {
  vi.resetAllMocks()
})

describe('resolving the stdio bridge', () => {
  it('uses the bash bridge for a WSL distro without probing its platform again', async () => {
    const bridge = await resolveOctopodStdioBridge(
      transport({ kind: 'wsl', id: 'wsl:ubuntu', distro: 'Ubuntu', label: 'Ubuntu' }),
      6768
    )
    expect(bridge).toEqual({
      command: octopodBashStdioBridgeCommand(6768),
      mode: 'raw',
      wrapCommand: true
    })
    expect(detect).not.toHaveBeenCalled()
  })

  it('still probes an SSH host before choosing its bridge', async () => {
    detect.mockResolvedValue(getRemoteHostPlatform('linux-x64'))
    const bridge = await resolveOctopodStdioBridge(
      transport({ id: 'ssh-1', label: 'box', host: 'box', port: 22, username: 'me' }),
      6768
    )
    expect(detect).toHaveBeenCalledOnce()
    expect(bridge.mode).toBe('raw')
    expect(bridge.command).toBe(octopodPosixStdioBridgeCommand(6768))
  })

  it('refuses an SSH host whose platform it cannot serve', async () => {
    detect.mockResolvedValue(null)
    await expect(
      resolveOctopodStdioBridge(
        transport({ id: 'ssh-1', label: 'box', host: 'box', port: 22, username: 'me' }),
        6768
      )
    ).rejects.toThrow('doesn’t support this SSH host’s platform')
  })
})
