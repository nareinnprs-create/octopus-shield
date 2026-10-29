import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  handle: vi.fn(),
  update: vi.fn(),
  rollback: vi.fn(),
  recover: vi.fn(),
  stop: vi.fn(),
  cancel: vi.fn(),
  retire: vi.fn()
}))

vi.mock('electron', () => ({ ipcMain: { handle: mocks.handle } }))
vi.mock('../../ssh/octopod-runtime-maintenance', () => ({
  updateManagedOctopodEnvironment: mocks.update,
  rollbackManagedOctopodEnvironment: mocks.rollback,
  recoverManagedOctopodEnvironment: mocks.recover
}))
vi.mock('../../managed-server/lifecycle/octopod-runtime-decommission', () => ({
  stopManagedOctopodEnvironment: mocks.stop,
  cancelManagedOctopodStop: mocks.cancel
}))
vi.mock('./runtime-environment-removal-cleanup', () => ({
  retireRemovedRuntimeEnvironment: mocks.retire
}))

const { registerOctopodRuntimeMaintenanceHandlers } =
  await import('./octopod-runtime-maintenance-handlers')

const invalidateTransport = vi.fn()
const clearHostServerStatus = vi.fn()
const clearHostServerNotes = vi.fn()
const store = {
  removeWorkspaceSessionHost: vi.fn(),
  getRemoteLayoutSnapshot: vi.fn(),
  setRemoteLayoutSnapshot: vi.fn()
}

function handler(channel: string): (_event: unknown, args: unknown) => Promise<unknown> {
  const registration = mocks.handle.mock.calls.find(([name]) => name === channel)
  if (!registration) {
    throw new Error(`${channel} handler was not registered`)
  }
  return registration[1]
}

describe('managed octopod maintenance IPC', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    registerOctopodRuntimeMaintenanceHandlers({
      getUserDataPath: () => '/profile',
      getActiveEnvironmentId: () => 'active-environment',
      invalidateTransport,
      clearHostServerStatus,
      clearHostServerNotes,
      store
    })
  })

  it('reconnects after an update restarts octopod, but not after a deferral', async () => {
    mocks.update.mockResolvedValueOnce({ outcome: 'deferred', code: 'busy' })
    await handler('runtimeEnvironments:updateOctopod')(null, { selector: 'Managed', force: 'yes' })
    expect(mocks.update).toHaveBeenCalledWith('/profile', { selector: 'Managed', force: false })
    expect(invalidateTransport).not.toHaveBeenCalled()
    expect(clearHostServerNotes).not.toHaveBeenCalled()
    mocks.update.mockResolvedValueOnce({ outcome: 'updated', environment: { id: 'e-1' } })
    await handler('runtimeEnvironments:updateOctopod')(null, { selector: 'Managed', force: true })
    expect(invalidateTransport).toHaveBeenCalledWith('e-1')
  })

  it.each(['updated', 'already-current'])(
    'clears the host notes after a verified %s update',
    async (outcome) => {
      mocks.update.mockResolvedValueOnce({
        outcome,
        environment: { id: 'e-1', octopodDeployment: { sshTargetId: 'ssh-1' } },
        activeVersion: 'candidate'
      })
      await handler('runtimeEnvironments:updateOctopod')(null, { selector: 'Managed', force: true })
      expect(clearHostServerNotes).toHaveBeenCalledExactlyOnceWith('ssh-1', 'e-1')
      expect(invalidateTransport).toHaveBeenCalledTimes(outcome === 'updated' ? 1 : 0)
    }
  )

  it('clears the notes only after the old transport has been retired', async () => {
    let finishRetirement: (() => void) | undefined
    invalidateTransport.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finishRetirement = resolve
      })
    )
    mocks.update.mockResolvedValueOnce({
      outcome: 'updated',
      environment: { id: 'e-1', octopodDeployment: { sshTargetId: 'ssh-1' } }
    })
    const updating = handler('runtimeEnvironments:updateOctopod')(null, { selector: 'Managed' })
    await vi.waitFor(() => expect(invalidateTransport).toHaveBeenCalledOnce())
    expect(clearHostServerNotes).not.toHaveBeenCalled()
    finishRetirement?.()
    await updating
    expect(clearHostServerNotes).toHaveBeenCalledOnce()
  })

  it('keeps the previous diagnostic when an update rejects', async () => {
    mocks.update.mockRejectedValueOnce(new Error('SSH contact lost'))
    await expect(
      handler('runtimeEnvironments:updateOctopod')(null, { selector: 'Managed' })
    ).rejects.toThrow('SSH contact lost')
    expect(clearHostServerNotes).not.toHaveBeenCalled()
    expect(invalidateTransport).not.toHaveBeenCalled()
  })

  it('reconnects after rollback and after recovery restores a serving slot', async () => {
    mocks.rollback.mockResolvedValueOnce({ outcome: 'rolled-back', environment: { id: 'e-1' } })
    await handler('runtimeEnvironments:rollbackOctopod')(null, { selector: 'Managed' })
    mocks.recover.mockResolvedValueOnce({
      outcome: 'recovered',
      activeVersion: null,
      environment: { id: 'e-1' }
    })
    await handler('runtimeEnvironments:recoverOctopod')(null, { selector: 'Managed' })
    expect(invalidateTransport).toHaveBeenCalledTimes(1)
  })

  it('stops with the Active Server guard and the shared removal cleanup', async () => {
    mocks.stop.mockResolvedValueOnce({ outcome: 'unlinked', sshTargetId: 'ssh-1' })
    await handler('runtimeEnvironments:stopOctopod')(null, { selector: ' Managed ' })
    const [, args, policy] = mocks.stop.mock.calls[0] ?? []
    expect(args).toEqual({ selector: 'Managed' })
    expect(policy.isActiveEnvironment('active-environment')).toBe(true)
    expect(policy.isActiveEnvironment('e-1')).toBe(false)
    policy.retireLocalState('e-1')
    expect(mocks.retire).toHaveBeenCalledWith('e-1', invalidateTransport, store, '/profile')
    // The SSH host stops naming the unlinked server without waiting for a reconnect.
    expect(clearHostServerStatus).toHaveBeenCalledWith('ssh-1')
  })

  it('keeps the SSH host’s managed state when the stop is refused', async () => {
    mocks.stop.mockResolvedValueOnce({
      outcome: 'refused',
      verdict: 'live',
      code: 'c',
      reason: 'r'
    })
    await handler('runtimeEnvironments:stopOctopod')(null, { selector: 'Managed' })
    expect(clearHostServerStatus).not.toHaveBeenCalled()
  })

  it('rejects a missing selector before touching SSH', async () => {
    await expect(handler('runtimeEnvironments:cancelOctopodStop')(null, {})).rejects.toThrow(
      'Server is required'
    )
    expect(mocks.cancel).not.toHaveBeenCalled()
  })
})
