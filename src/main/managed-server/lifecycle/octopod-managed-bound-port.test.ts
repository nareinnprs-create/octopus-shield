import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getRemoteHostPlatform } from '../../ssh/ssh-remote-platform'

const execOctopodRemote = vi.hoisted(() => vi.fn())
vi.mock('../install/octopod-remote-runtime-control', () => ({ execOctopodRemote }))
const resolveOctopodRemoteContext = vi.hoisted(() => vi.fn())
vi.mock('../install/octopod-remote-context', () => ({ resolveOctopodRemoteContext }))

import { octopodBoundPort, resolveManagedOctopodTunnelPort } from './octopod-managed-bound-port'
import type { KnownRuntimeEnvironment } from '../../../shared/runtime-environments'
import type { SshTarget } from '../../../shared/ssh-types'
import { unusedOctopodHostTransport } from '../../ssh/unused-host-transport.test-fixture'

function readinessLine(boundEndpoint: string | null): string {
  return `${JSON.stringify({ type: 'shield_server_ready', runtimeId: 'runtime-1', boundEndpoint })}\n`
}

describe('octopodBoundPort', () => {
  it('reads the port octopod actually bound', () => {
    expect(octopodBoundPort({ boundEndpoint: 'ws://127.0.0.1:58520' })).toBe(58_520)
  })

  it.each([null, 'not a url', 'ws://127.0.0.1'])('returns null for %s', (boundEndpoint) => {
    expect(octopodBoundPort({ boundEndpoint })).toBeNull()
  })
})

describe('resolveManagedOctopodTunnelPort', () => {
  const link = {
    sshTargetId: 'ssh-1',
    sshTargetGeneration: 1,
    localPort: 46_768,
    remotePort: 6_768
  }
  function input(kind: 'octopodDeployment' | 'sshAccess') {
    return {
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the resolver reads only the link fields.
      environment: { [kind]: link } as unknown as KnownRuntimeEnvironment,
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: passed through to the mocked context.
      target: { id: 'ssh-1' } as SshTarget,
      connection: unusedOctopodHostTransport()
    }
  }

  beforeEach(() => {
    execOctopodRemote.mockReset()
    resolveOctopodRemoteContext.mockReset()
  })

  it('reads the active slot of a managed server', async () => {
    resolveOctopodRemoteContext.mockResolvedValue({
      activationRecord: { active: '1.0.0+abc' },
      connection: {},
      host: getRemoteHostPlatform('linux-x64'),
      remoteHome: '/home/deploy'
    })
    execOctopodRemote.mockResolvedValue(readinessLine('ws://127.0.0.1:58520'))
    await expect(resolveManagedOctopodTunnelPort(input('octopodDeployment'))).resolves.toBe(58_520)
  })

  it.each([
    ['no readiness file', ''],
    ['a readiness without an endpoint', readinessLine(null)]
  ])('falls back to the preferred port for %s (older builds)', async (_label, output) => {
    resolveOctopodRemoteContext.mockResolvedValue({
      activationRecord: { active: '1.0.0+abc' },
      connection: {},
      host: getRemoteHostPlatform('linux-x64'),
      remoteHome: '/home/deploy'
    })
    execOctopodRemote.mockResolvedValue(output)
    await expect(resolveManagedOctopodTunnelPort(input('octopodDeployment'))).resolves.toBe(6_768)
  })

  it('keeps the configured port for independent SSH access without touching the host', async () => {
    await expect(resolveManagedOctopodTunnelPort(input('sshAccess'))).resolves.toBe(6_768)
    expect(resolveOctopodRemoteContext).not.toHaveBeenCalled()
  })

  it('tries the preferred port when the host cannot be read; the identity check still guards it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    resolveOctopodRemoteContext.mockRejectedValue(new Error('platform probe failed'))
    await expect(resolveManagedOctopodTunnelPort(input('octopodDeployment'))).resolves.toBe(6_768)
    warn.mockRestore()
  })
})
