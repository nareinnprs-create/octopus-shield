import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as ProfileStoragePaths from '../shield-profiles/profile-storage-paths'

const {
  handlers,
  appExitMock,
  appQuitMock,
  appRelaunchMock,
  relaunchAppMock,
  destroySystemTrayMock,
  createLocalShieldProfileMock,
  getShieldProfileListStateMock,
  seedNewShieldProfileTelemetryConsentMock,
  setActiveShieldProfileMock,
  transferShieldProfileProjectMock,
  hasShieldProfileStateDatabaseMock
} = vi.hoisted(() => ({
  handlers: new Map<string, (_event: unknown, args?: unknown) => unknown>(),
  appExitMock: vi.fn(),
  appQuitMock: vi.fn(),
  appRelaunchMock: vi.fn(),
  relaunchAppMock: vi.fn(),
  destroySystemTrayMock: vi.fn(),
  createLocalShieldProfileMock: vi.fn(),
  getShieldProfileListStateMock: vi.fn(),
  seedNewShieldProfileTelemetryConsentMock: vi.fn(),
  setActiveShieldProfileMock: vi.fn(),
  transferShieldProfileProjectMock: vi.fn(),
  hasShieldProfileStateDatabaseMock: vi.fn()
}))

vi.mock('electron', () => ({
  app: {
    exit: appExitMock,
    quit: appQuitMock,
    relaunch: appRelaunchMock
  },
  ipcMain: {
    handle: vi.fn((channel: string, handler: (_event: unknown, args?: unknown) => unknown) => {
      handlers.set(channel, handler)
    })
  }
}))

vi.mock('../tray/system-tray', () => ({
  destroySystemTray: destroySystemTrayMock
}))

vi.mock('../app-relaunch', () => ({
  relaunchApp: relaunchAppMock
}))

vi.mock('../shield-profiles/profile-index-store', () => ({
  createLocalShieldProfile: createLocalShieldProfileMock,
  getShieldProfileListState: getShieldProfileListStateMock,
  seedNewShieldProfileTelemetryConsent: seedNewShieldProfileTelemetryConsentMock,
  setActiveShieldProfile: setActiveShieldProfileMock
}))

function makeStoreMock(flushPendingOrThrowAsync = vi.fn()) {
  const freezeWrites = vi.fn()
  const resumeMaintenance = vi.fn(async () => {})
  return {
    flushPendingOrThrowAsync,
    freezeWrites,
    resumeMaintenance,
    beginProfileMaintenance: vi.fn(async (options: unknown) => {
      await flushPendingOrThrowAsync(options)
      freezeWrites()
      return { resume: resumeMaintenance }
    }),
    getSettings: () => ({})
  }
}

vi.mock('../shield-profiles/profile-project-transfer', () => ({
  transferShieldProfileProject: transferShieldProfileProjectMock
}))

vi.mock('../shield-profiles/profile-storage-paths', async (importOriginal) => ({
  ...(await importOriginal<typeof ProfileStoragePaths>()),
  hasShieldProfileStateDatabase: hasShieldProfileStateDatabaseMock
}))

import { registerShieldProfileHandlers } from './shield-profiles'
import { installFakeAppEnvironment } from '../../../config/scripts/vitest-host-ports-setup'

const ipcEvent = { sender: { isDestroyed: () => false, send: vi.fn() } }

describe('registerShieldProfileHandlers', () => {
  beforeEach(() => {
    // Reinstall AppEnvironment per test after global beforeEach resets its fake.
    installFakeAppEnvironment({ getPath: () => '/tmp/shield-user-data' })
    vi.useFakeTimers()
    handlers.clear()
    ipcEvent.sender.send.mockClear()
    appExitMock.mockReset()
    appQuitMock.mockReset()
    appRelaunchMock.mockReset()
    relaunchAppMock.mockReset()
    relaunchAppMock.mockImplementation(() => appRelaunchMock())
    destroySystemTrayMock.mockReset()
    createLocalShieldProfileMock.mockReset()
    getShieldProfileListStateMock.mockReset()
    seedNewShieldProfileTelemetryConsentMock.mockReset()
    setActiveShieldProfileMock.mockReset()
    transferShieldProfileProjectMock.mockReset()
    hasShieldProfileStateDatabaseMock.mockReset().mockReturnValue(false)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('registers list and create handlers', async () => {
    const listState = {
      activeProfileId: 'local-default',
      profiles: [{ id: 'local-default', name: 'Personal' }]
    }
    const createState = {
      ...listState,
      profile: { id: 'local-work', name: 'Work' }
    }
    getShieldProfileListStateMock.mockReturnValue(listState)
    createLocalShieldProfileMock.mockReturnValue(createState)

    registerShieldProfileHandlers(makeStoreMock() as never)

    await expect(Promise.resolve(handlers.get('shieldProfiles:list')?.(ipcEvent))).resolves.toEqual({
      ...listState,
      multiProfileUi: false
    })
    await expect(
      Promise.resolve(handlers.get('shieldProfiles:createLocal')?.(ipcEvent, { name: 'Work' }))
    ).resolves.toBe(createState)
    expect(createLocalShieldProfileMock).toHaveBeenCalledWith({ name: 'Work' })
  })

  it('reports multiProfileUi when the env flag is set', async () => {
    const previous = process.env.OSHIELD_MULTI_PROFILE_UI
    process.env.OSHIELD_MULTI_PROFILE_UI = '1'
    try {
      getShieldProfileListStateMock.mockReturnValue({
        activeProfileId: 'local-default',
        profiles: []
      })
      registerShieldProfileHandlers(makeStoreMock() as never)

      await expect(Promise.resolve(handlers.get('shieldProfiles:list')?.(ipcEvent))).resolves.toEqual(
        {
          activeProfileId: 'local-default',
          profiles: [],
          multiProfileUi: true
        }
      )
    } finally {
      if (previous === undefined) {
        delete process.env.OSHIELD_MULTI_PROFILE_UI
      } else {
        process.env.OSHIELD_MULTI_PROFILE_UI = previous
      }
    }
  })

  it('marks the target profile active, flushes, and relaunches', async () => {
    const flush = vi.fn()
    const onBeforeRelaunch = vi.fn()
    getShieldProfileListStateMock.mockReturnValue({
      activeProfileId: 'local-default',
      profiles: []
    })
    setActiveShieldProfileMock.mockReturnValue({
      activeProfileId: 'local-work',
      profiles: []
    })
    registerShieldProfileHandlers(makeStoreMock(flush) as never, { onBeforeRelaunch })

    const resultPromise = Promise.resolve(
      handlers.get('shieldProfiles:switch')?.(ipcEvent, { profileId: 'local-work' })
    )

    await expect(resultPromise).resolves.toEqual({ status: 'relaunching' })
    expect(setActiveShieldProfileMock).toHaveBeenCalledWith('local-work')
    expect(flush).toHaveBeenCalledOnce()
    expect(onBeforeRelaunch).toHaveBeenCalledOnce()
    expect(flush.mock.invocationCallOrder[0]).toBeLessThan(
      setActiveShieldProfileMock.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY
    )
    expect(flush).toHaveBeenCalledBefore(onBeforeRelaunch)
    expect(appRelaunchMock).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(150)

    expect(appRelaunchMock).toHaveBeenCalledOnce()
    expect(relaunchAppMock).toHaveBeenCalledWith('profile-switch')
    // Profile switches must run normal quit teardown for scrollback, PTYs and daemon checkpoints.
    expect(appQuitMock).toHaveBeenCalledOnce()
    expect(appExitMock).not.toHaveBeenCalled()
  })

  it('does not mark a profile active when current profile flush fails', async () => {
    const flush = vi.fn(() => {
      throw new Error('flush_failed')
    })
    getShieldProfileListStateMock.mockReturnValue({
      activeProfileId: 'local-default',
      profiles: []
    })
    registerShieldProfileHandlers(makeStoreMock(flush) as never)

    await expect(
      Promise.resolve(handlers.get('shieldProfiles:switch')?.(ipcEvent, { profileId: 'local-work' }))
    ).rejects.toThrow('flush_failed')

    expect(setActiveShieldProfileMock).not.toHaveBeenCalled()
    expect(appRelaunchMock).not.toHaveBeenCalled()
  })

  it('does not switch profiles when persistence cannot reach quiescence', async () => {
    const flush = vi.fn(() => new Promise<void>(() => {}))
    const onBeforeRelaunch = vi.fn()
    getShieldProfileListStateMock.mockReturnValue({
      activeProfileId: 'local-default',
      profiles: []
    })
    registerShieldProfileHandlers(makeStoreMock(flush) as never, { onBeforeRelaunch })

    const switchProfile = Promise.resolve(
      handlers.get('shieldProfiles:switch')?.(ipcEvent, { profileId: 'local-work' })
    )
    const rejection = expect(switchProfile).rejects.toThrow('shield_profile_persistence_timeout')
    await vi.advanceTimersByTimeAsync(60_000)
    await rejection

    expect(setActiveShieldProfileMock).not.toHaveBeenCalled()
    expect(appRelaunchMock).not.toHaveBeenCalled()
    expect(onBeforeRelaunch).not.toHaveBeenCalled()
  })

  it('does not relaunch when switching to the active profile', async () => {
    getShieldProfileListStateMock.mockReturnValue({
      activeProfileId: 'local-default',
      profiles: []
    })
    registerShieldProfileHandlers(makeStoreMock() as never)

    await expect(
      Promise.resolve(
        handlers.get('shieldProfiles:switch')?.(ipcEvent, { profileId: 'local-default' })
      )
    ).resolves.toEqual({ status: 'already-active' })

    expect(setActiveShieldProfileMock).not.toHaveBeenCalled()
    expect(appRelaunchMock).not.toHaveBeenCalled()
  })

  it('rejects invalid profile ids', async () => {
    registerShieldProfileHandlers(makeStoreMock() as never)

    await expect(
      Promise.resolve(handlers.get('shieldProfiles:switch')?.(ipcEvent, { profileId: ' ' }))
    ).rejects.toThrow('invalid_shield_profile_id')
  })

  it('transfers projects between inactive profiles after flushing active state', async () => {
    const flush = vi.fn()
    const result = {
      status: 'transferred',
      mode: 'copy',
      sourceProfileId: 'personal',
      targetProfileId: 'work',
      sourceRepoId: 'repo-1',
      targetRepoId: 'repo-2',
      targetProjectId: 'repo:repo-2'
    }
    getShieldProfileListStateMock.mockReturnValue({
      activeProfileId: 'personal',
      profiles: []
    })
    transferShieldProfileProjectMock.mockReturnValue(result)
    registerShieldProfileHandlers(makeStoreMock(flush) as never)

    await expect(
      Promise.resolve(
        handlers.get('shieldProfiles:transferProject')?.(ipcEvent, {
          sourceProfileId: ' personal ',
          targetProfileId: ' work ',
          repoId: ' repo-1 ',
          mode: 'copy'
        })
      )
    ).resolves.toBe(result)

    expect(flush).toHaveBeenCalledOnce()
    expect(transferShieldProfileProjectMock).toHaveBeenCalledWith(
      {
        sourceProfileId: 'personal',
        targetProfileId: 'work',
        repoId: 'repo-1',
        mode: 'copy'
      },
      '/tmp/shield-user-data'
    )
  })

  it('moves a project out of the active profile and relaunches into the target profile', async () => {
    const flush = vi.fn()
    const onBeforeRelaunch = vi.fn()
    const result = {
      status: 'transferred',
      mode: 'move',
      sourceProfileId: 'personal',
      targetProfileId: 'work',
      sourceRepoId: 'repo-1',
      targetRepoId: 'repo-1',
      targetProjectId: 'repo:repo-1'
    }
    getShieldProfileListStateMock.mockReturnValue({
      activeProfileId: 'personal',
      profiles: []
    })
    transferShieldProfileProjectMock.mockReturnValue(result)
    registerShieldProfileHandlers(makeStoreMock(flush) as never, { onBeforeRelaunch })

    await expect(
      Promise.resolve(
        handlers.get('shieldProfiles:transferProject')?.(ipcEvent, {
          sourceProfileId: 'personal',
          targetProfileId: 'work',
          repoId: 'repo-1',
          mode: 'move'
        })
      )
    ).resolves.toEqual({ ...result, willRelaunch: true })

    expect(onBeforeRelaunch).toHaveBeenCalledOnce()
    expect(flush).toHaveBeenCalledOnce()
    expect(transferShieldProfileProjectMock).toHaveBeenCalledWith(
      {
        sourceProfileId: 'personal',
        targetProfileId: 'work',
        repoId: 'repo-1',
        mode: 'move'
      },
      '/tmp/shield-user-data'
    )
    expect(setActiveShieldProfileMock).toHaveBeenCalledWith('work')
    expect(appRelaunchMock).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(150)

    expect(appRelaunchMock).toHaveBeenCalledOnce()
    expect(ipcEvent.sender.send).toHaveBeenCalledWith('app:restart-committed')
    expect(relaunchAppMock).toHaveBeenCalledWith('profile-transfer')
    expect(appQuitMock).toHaveBeenCalledOnce()
    expect(appExitMock).not.toHaveBeenCalled()
  })

  it('relaunches the closed source when a completed move cannot update the profile index', async () => {
    const store = makeStoreMock()
    getShieldProfileListStateMock.mockReturnValue({ activeProfileId: 'personal', profiles: [] })
    transferShieldProfileProjectMock.mockReturnValue({ status: 'transferred', mode: 'move' })
    setActiveShieldProfileMock.mockImplementationOnce(() => {
      throw new Error('profile index disk full')
    })
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: This fixture supplies every Store operation exercised by these IPC handlers.
    registerShieldProfileHandlers(store as never)

    await expect(
      handlers.get('shieldProfiles:transferProject')?.(ipcEvent, {
        sourceProfileId: 'personal',
        targetProfileId: 'work',
        repoId: 'repo-1',
        mode: 'move'
      })
    ).rejects.toThrow('profile index disk full')

    expect(store.freezeWrites).toHaveBeenCalledOnce()
    expect(store.resumeMaintenance).not.toHaveBeenCalled()
    expect(ipcEvent.sender.send).toHaveBeenCalledWith('app:restart-committed')
    await vi.advanceTimersByTimeAsync(150)
    expect(relaunchAppMock).toHaveBeenCalledWith('profile-transfer')
    expect(appQuitMock).toHaveBeenCalledOnce()
  })

  it('keeps the active profile writable during a transfer between inactive profiles', async () => {
    const store = makeStoreMock()
    getShieldProfileListStateMock.mockReturnValue({ activeProfileId: 'active', profiles: [] })
    transferShieldProfileProjectMock.mockReturnValue({ status: 'transferred', mode: 'copy' })
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: This fixture supplies the Store operations exercised by the handlers.
    registerShieldProfileHandlers(store as never)
    await handlers.get('shieldProfiles:transferProject')?.(ipcEvent, {
      sourceProfileId: 'personal',
      targetProfileId: 'work',
      repoId: 'repo-1',
      mode: 'copy'
    })
    expect(store.beginProfileMaintenance).not.toHaveBeenCalled()
    expect(store.freezeWrites).not.toHaveBeenCalled()
    expect(store.flushPendingOrThrowAsync).toHaveBeenCalledBefore(transferShieldProfileProjectMock)
  })

  it('rejects transfers that would mutate the active target profile offline', async () => {
    getShieldProfileListStateMock.mockReturnValue({
      activeProfileId: 'work',
      profiles: []
    })
    registerShieldProfileHandlers(makeStoreMock() as never)

    await expect(
      Promise.resolve(
        handlers.get('shieldProfiles:transferProject')?.(ipcEvent, {
          sourceProfileId: 'personal',
          targetProfileId: 'work',
          repoId: 'repo-1',
          mode: 'copy'
        })
      )
    ).rejects.toThrow('active_target_shield_profile_transfer_requires_relaunch')

    expect(transferShieldProfileProjectMock).not.toHaveBeenCalled()
  })

  it('freezes a newly migrated source after transfer failure and reopens its current profile', async () => {
    const store = makeStoreMock()
    const onBeforeRelaunch = vi.fn()
    getShieldProfileListStateMock.mockReturnValue({ activeProfileId: 'personal', profiles: [] })
    transferShieldProfileProjectMock.mockImplementation(() => {
      hasShieldProfileStateDatabaseMock.mockReturnValue(true)
      throw new Error('source commit interrupted')
    })
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: This fixture supplies every Store operation exercised by these IPC handlers.
    registerShieldProfileHandlers(store as never, { onBeforeRelaunch })

    await expect(
      Promise.resolve(
        handlers.get('shieldProfiles:transferProject')?.(ipcEvent, {
          sourceProfileId: 'personal',
          targetProfileId: 'work',
          repoId: 'repo-1',
          mode: 'move'
        })
      )
    ).rejects.toThrow('source commit interrupted')

    expect(store.flushPendingOrThrowAsync).toHaveBeenCalledBefore(transferShieldProfileProjectMock)
    expect(store.freezeWrites).toHaveBeenCalledOnce()
    expect(store.freezeWrites).toHaveBeenCalledBefore(onBeforeRelaunch)
    expect(setActiveShieldProfileMock).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(150)
    expect(ipcEvent.sender.send).toHaveBeenCalledWith('app:restart-committed')
    expect(relaunchAppMock).toHaveBeenCalledWith('profile-transfer')
    expect(appQuitMock).toHaveBeenCalledOnce()
  })

  it('keeps an active JSON source writable after validation fails without a migration', async () => {
    const store = makeStoreMock()
    const onBeforeRelaunch = vi.fn()
    getShieldProfileListStateMock.mockReturnValue({ activeProfileId: 'personal', profiles: [] })
    transferShieldProfileProjectMock.mockImplementation(() => {
      throw new Error('unknown_source_repo')
    })
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: This fixture supplies every Store operation exercised by these IPC handlers.
    registerShieldProfileHandlers(store as never, { onBeforeRelaunch })

    await expect(
      Promise.resolve(
        handlers.get('shieldProfiles:transferProject')?.(ipcEvent, {
          sourceProfileId: 'personal',
          targetProfileId: 'work',
          repoId: 'repo-1',
          mode: 'move'
        })
      )
    ).rejects.toThrow('unknown_source_repo')

    expect(store.resumeMaintenance).toHaveBeenCalledOnce()
    expect(onBeforeRelaunch).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(150)
    expect(relaunchAppMock).not.toHaveBeenCalled()
  })

  it.each([
    null,
    {},
    { sourceProfileId: 4 },
    {
      sourceProfileId: 'personal',
      targetProfileId: 'work',
      repoId: 'repo-1',
      mode: 'invalid'
    }
  ])('rejects malformed transfer arguments before disk work: %j', async (args) => {
    const store = makeStoreMock()
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: This fixture supplies every Store operation exercised by these IPC handlers.
    registerShieldProfileHandlers(store as never)
    await expect(
      Promise.resolve(handlers.get('shieldProfiles:transferProject')?.(ipcEvent, args))
    ).rejects.toThrow('invalid_shield_profile_project_transfer')
    expect(store.flushPendingOrThrowAsync).not.toHaveBeenCalled()
    expect(transferShieldProfileProjectMock).not.toHaveBeenCalled()
  })
})
