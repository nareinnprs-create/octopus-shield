import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  handlers,
  createCloudLinkedShieldProfileMock,
  connectCurrentShieldProfileMock,
  getCurrentShieldProfileAuthStatusMock,
  refreshCurrentShieldProfileAuthMock,
  selectCurrentShieldProfileOrgMock,
  signOutCurrentShieldProfileMock
} = vi.hoisted(() => ({
  handlers: new Map<string, (_event: unknown, args?: unknown) => unknown>(),
  createCloudLinkedShieldProfileMock: vi.fn(),
  connectCurrentShieldProfileMock: vi.fn(),
  getCurrentShieldProfileAuthStatusMock: vi.fn(),
  refreshCurrentShieldProfileAuthMock: vi.fn(),
  selectCurrentShieldProfileOrgMock: vi.fn(),
  signOutCurrentShieldProfileMock: vi.fn()
}))

vi.mock('electron', () => ({
  app: {
    exit: vi.fn(),
    relaunch: vi.fn()
  },
  ipcMain: {
    handle: vi.fn((channel: string, handler: (_event: unknown, args?: unknown) => unknown) => {
      handlers.set(channel, handler)
    })
  }
}))

vi.mock('../tray/system-tray', () => ({
  destroySystemTray: vi.fn()
}))

vi.mock('../shield-profiles/profile-index-store', () => ({
  createLocalShieldProfile: vi.fn(),
  getShieldProfileListState: vi.fn(),
  seedNewShieldProfileTelemetryConsent: vi.fn(),
  setActiveShieldProfile: vi.fn()
}))

vi.mock('../shield-profiles/profile-project-transfer', () => ({
  transferShieldProfileProject: vi.fn()
}))

vi.mock('../shield-profiles/profile-cloud-service', () => ({
  createCloudLinkedShieldProfile: createCloudLinkedShieldProfileMock,
  connectCurrentShieldProfile: connectCurrentShieldProfileMock,
  getCurrentShieldProfileAuthStatus: getCurrentShieldProfileAuthStatusMock,
  refreshCurrentShieldProfileAuth: refreshCurrentShieldProfileAuthMock,
  selectCurrentShieldProfileOrg: selectCurrentShieldProfileOrgMock,
  signOutCurrentShieldProfile: signOutCurrentShieldProfileMock
}))

import { registerShieldProfileHandlers } from './shield-profiles'
import { installFakeAppEnvironment } from '../../../config/scripts/vitest-host-ports-setup'

describe('registerShieldProfileHandlers auth channels', () => {
  beforeEach(() => {
    // Reinstall AppEnvironment per test after global beforeEach resets its fake.
    installFakeAppEnvironment({ getPath: () => '/tmp/shield-user-data' })
    handlers.clear()
    createCloudLinkedShieldProfileMock.mockReset()
    connectCurrentShieldProfileMock.mockReset()
    getCurrentShieldProfileAuthStatusMock.mockReset()
    refreshCurrentShieldProfileAuthMock.mockReset()
    selectCurrentShieldProfileOrgMock.mockReset()
    signOutCurrentShieldProfileMock.mockReset()
  })

  it('returns auth status for the current profile', async () => {
    const status = {
      activeProfileId: 'local-default',
      configured: false,
      state: 'unconfigured',
      persistence: 'none'
    }
    getCurrentShieldProfileAuthStatusMock.mockReturnValue(status)
    registerShieldProfileHandlers({
      flush: vi.fn(),
      freezeWrites: vi.fn(),
      getSettings: () => ({})
    } as never)

    await expect(Promise.resolve(handlers.get('shieldProfiles:authStatus')?.(null))).resolves.toBe(
      status
    )
    expect(getCurrentShieldProfileAuthStatusMock).toHaveBeenCalledWith('/tmp/shield-user-data')
  })

  it('connects and signs out the current profile through the cloud service', async () => {
    const connectResult = { status: 'unconfigured', auth: { activeProfileId: 'local-default' } }
    const signOutResult = { status: 'signed-out', auth: { activeProfileId: 'local-default' } }
    connectCurrentShieldProfileMock.mockResolvedValue(connectResult)
    signOutCurrentShieldProfileMock.mockResolvedValue(signOutResult)
    registerShieldProfileHandlers({
      flush: vi.fn(),
      freezeWrites: vi.fn(),
      getSettings: () => ({})
    } as never)

    await expect(
      Promise.resolve(handlers.get('shieldProfiles:connectCurrent')?.(null))
    ).resolves.toBe(connectResult)
    await expect(
      Promise.resolve(handlers.get('shieldProfiles:signOutCurrent')?.(null))
    ).resolves.toBe(signOutResult)
    expect(connectCurrentShieldProfileMock).toHaveBeenCalledWith('/tmp/shield-user-data')
    expect(signOutCurrentShieldProfileMock).toHaveBeenCalledWith('/tmp/shield-user-data')
  })

  it('refreshes profile auth through the cloud service', async () => {
    const refreshResult = { status: 'refreshed', auth: { activeProfileId: 'local-default' } }
    refreshCurrentShieldProfileAuthMock.mockResolvedValue(refreshResult)
    registerShieldProfileHandlers({
      flush: vi.fn(),
      freezeWrites: vi.fn(),
      getSettings: () => ({})
    } as never)

    await expect(Promise.resolve(handlers.get('shieldProfiles:refreshAuth')?.(null))).resolves.toBe(
      refreshResult
    )
    expect(refreshCurrentShieldProfileAuthMock).toHaveBeenCalledWith('/tmp/shield-user-data')
  })

  it('validates organization selection before calling the cloud service', async () => {
    const selectResult = { status: 'selected', auth: { activeProfileId: 'local-default' } }
    selectCurrentShieldProfileOrgMock.mockResolvedValue(selectResult)
    registerShieldProfileHandlers({
      flush: vi.fn(),
      freezeWrites: vi.fn(),
      getSettings: () => ({})
    } as never)

    await expect(
      Promise.resolve(handlers.get('shieldProfiles:selectOrg')?.(null, { orgId: ' org-1 ' }))
    ).resolves.toBe(selectResult)
    expect(selectCurrentShieldProfileOrgMock).toHaveBeenCalledWith('/tmp/shield-user-data', 'org-1')

    await expect(
      Promise.resolve(handlers.get('shieldProfiles:selectOrg')?.(null, { orgId: ' ' }))
    ).rejects.toThrow('invalid_shield_profile_org_selection')
  })

  it('creates cloud-linked profiles with trimmed optional args', async () => {
    const createResult = {
      status: 'created',
      auth: { activeProfileId: 'local-default' },
      activeProfileId: 'local-default',
      profiles: [],
      profile: { id: 'cloud-1' }
    }
    createCloudLinkedShieldProfileMock.mockResolvedValue(createResult)
    registerShieldProfileHandlers({
      flush: vi.fn(),
      freezeWrites: vi.fn(),
      getSettings: () => ({})
    } as never)

    await expect(
      Promise.resolve(
        handlers.get('shieldProfiles:createCloudLinked')?.(null, { orgId: ' org-1 ', name: ' Acme ' })
      )
    ).resolves.toBe(createResult)
    expect(createCloudLinkedShieldProfileMock).toHaveBeenCalledWith('/tmp/shield-user-data', {
      orgId: 'org-1',
      name: 'Acme'
    })
  })
})
