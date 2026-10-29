import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  handle: vi.fn(),
  deploy: vi.fn(),
  status: vi.fn()
}))

vi.mock('electron', () => ({ ipcMain: { handle: mocks.handle } }))
vi.mock('../../managed-server/lifecycle/octopod-runtime-deployment', () => ({
  createManagedOctopodEnvironment: mocks.deploy
}))
vi.mock('../../managed-server/lifecycle/octopod-runtime-status', () => ({
  getManagedOctopodRuntimeStatus: mocks.status
}))

const { registerOctopodRuntimeLifecycleHandlers } = await import('./octopod-runtime-lifecycle-handlers')

function handler(channel: string): (_event: unknown, args: unknown) => unknown {
  const registration = mocks.handle.mock.calls.find(([name]) => name === channel)
  if (!registration) {
    throw new Error(`${channel} handler was not registered`)
  }
  return registration[1]
}

describe('managed octopod lifecycle IPC', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    registerOctopodRuntimeLifecycleHandlers({ getUserDataPath: () => '/profile' })
  })

  it('registers only deploy and status; maintenance and stop are not exposed', () => {
    expect(mocks.handle.mock.calls.map(([channel]) => channel)).toEqual([
      'runtimeEnvironments:deployOctopod',
      'runtimeEnvironments:getOctopodStatus'
    ])
  })

  it('trims deploy input and treats only a literal true as force', async () => {
    await handler('runtimeEnvironments:deployOctopod')(null, {
      name: ' Managed ',
      sshTargetId: ' ssh-1 ',
      force: 'yes'
    })
    expect(mocks.deploy).toHaveBeenCalledWith('/profile', {
      name: 'Managed',
      sshTargetId: 'ssh-1',
      force: false
    })
  })

  it('rejects missing selectors before touching SSH', async () => {
    await expect(handler('runtimeEnvironments:deployOctopod')(null, { name: 'x' })).rejects.toThrow(
      'SSH target is required'
    )
    expect(() => handler('runtimeEnvironments:getOctopodStatus')(null, undefined)).toThrow(
      'Server is required'
    )
    expect(mocks.deploy).not.toHaveBeenCalled()
    expect(mocks.status).not.toHaveBeenCalled()
  })
})
