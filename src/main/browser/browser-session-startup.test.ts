import { beforeEach, describe, expect, it, vi } from 'vitest'

function installRegistryMock(): {
  configureForShieldProfileMock: ReturnType<typeof vi.fn>
  configureRouteSessionsForShieldProfileMock: ReturnType<typeof vi.fn>
  configurePairedRuntimeBrowserClientHostsForShieldProfileMock: ReturnType<typeof vi.fn>
  collectOrphanedBrowserRoutePartitionStorageMock: ReturnType<typeof vi.fn>
  applyPendingCookieImportMock: ReturnType<typeof vi.fn>
  initializeBrowserSessionsFromPersistedStateMock: ReturnType<typeof vi.fn>
} {
  const configureForShieldProfileMock = vi.fn()
  const configureRouteSessionsForShieldProfileMock = vi.fn()
  const configurePairedRuntimeBrowserClientHostsForShieldProfileMock = vi.fn()
  const collectOrphanedBrowserRoutePartitionStorageMock = vi.fn(async () => [])
  const applyPendingCookieImportMock = vi.fn()
  const initializeBrowserSessionsFromPersistedStateMock = vi.fn()

  vi.doMock('./browser-session-registry', () => ({
    browserSessionRegistry: {
      configureForShieldProfile: configureForShieldProfileMock,
      applyPendingCookieImport: applyPendingCookieImportMock,
      initializeBrowserSessionsFromPersistedState: initializeBrowserSessionsFromPersistedStateMock
    }
  }))
  vi.doMock('./browser-route-session-runtime', () => ({
    configureRouteSessionsForShieldProfile: configureRouteSessionsForShieldProfileMock
  }))
  vi.doMock('./browser-route-partition-storage-runtime', () => ({
    collectOrphanedBrowserRoutePartitionStorage: collectOrphanedBrowserRoutePartitionStorageMock
  }))
  vi.doMock('./paired-runtime-browser-client-host-runtime', () => ({
    configurePairedRuntimeBrowserClientHostsForShieldProfile:
      configurePairedRuntimeBrowserClientHostsForShieldProfileMock
  }))

  return {
    configureForShieldProfileMock,
    configureRouteSessionsForShieldProfileMock,
    configurePairedRuntimeBrowserClientHostsForShieldProfileMock,
    collectOrphanedBrowserRoutePartitionStorageMock,
    applyPendingCookieImportMock,
    initializeBrowserSessionsFromPersistedStateMock
  }
}

describe('initializeBrowserSessionsForApp', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
  })

  it('replays pending cookie imports before initializing browser sessions', async () => {
    const { applyPendingCookieImportMock, initializeBrowserSessionsFromPersistedStateMock } =
      installRegistryMock()
    const { initializeBrowserSessionsForApp } = await import('./browser-session-startup')

    initializeBrowserSessionsForApp()

    expect(applyPendingCookieImportMock).toHaveBeenCalledOnce()
    expect(initializeBrowserSessionsFromPersistedStateMock).toHaveBeenCalledOnce()
    expect(applyPendingCookieImportMock.mock.invocationCallOrder[0]).toBeLessThan(
      initializeBrowserSessionsFromPersistedStateMock.mock.invocationCallOrder[0]
    )
  })

  it('configures the active Shield profile before replaying browser sessions', async () => {
    const {
      configureForShieldProfileMock,
      configureRouteSessionsForShieldProfileMock,
      configurePairedRuntimeBrowserClientHostsForShieldProfileMock,
      applyPendingCookieImportMock,
      initializeBrowserSessionsFromPersistedStateMock
    } = installRegistryMock()
    const { initializeBrowserSessionsForApp } = await import('./browser-session-startup')

    initializeBrowserSessionsForApp({
      shieldProfileId: 'local-work',
      profileDirectory: '/profiles/local-work'
    })

    expect(configureForShieldProfileMock).toHaveBeenCalledWith({
      shieldProfileId: 'local-work',
      profileDirectory: '/profiles/local-work'
    })
    expect(configureRouteSessionsForShieldProfileMock).toHaveBeenCalledWith({
      shieldProfileId: 'local-work',
      profileDirectory: '/profiles/local-work'
    })
    expect(configurePairedRuntimeBrowserClientHostsForShieldProfileMock).toHaveBeenCalledWith({
      shieldProfileId: 'local-work'
    })
    expect(configureForShieldProfileMock.mock.invocationCallOrder[0]).toBeLessThan(
      applyPendingCookieImportMock.mock.invocationCallOrder[0]
    )
    expect(configureRouteSessionsForShieldProfileMock.mock.invocationCallOrder[0]).toBeLessThan(
      applyPendingCookieImportMock.mock.invocationCallOrder[0]
    )
    expect(
      configurePairedRuntimeBrowserClientHostsForShieldProfileMock.mock.invocationCallOrder[0]
    ).toBeLessThan(applyPendingCookieImportMock.mock.invocationCallOrder[0])
    expect(applyPendingCookieImportMock.mock.invocationCallOrder[0]).toBeLessThan(
      initializeBrowserSessionsFromPersistedStateMock.mock.invocationCallOrder[0]
    )
  })

  it('sweeps orphaned route partitions once the profile binding runtime is configured', async () => {
    const {
      configureRouteSessionsForShieldProfileMock,
      collectOrphanedBrowserRoutePartitionStorageMock
    } = installRegistryMock()
    const { initializeBrowserSessionsForApp } = await import('./browser-session-startup')

    initializeBrowserSessionsForApp({
      shieldProfileId: 'local-work',
      profileDirectory: '/profiles/local-work'
    })

    expect(collectOrphanedBrowserRoutePartitionStorageMock).toHaveBeenCalledOnce()
    // Orphan collection needs the active profile configured first.
    expect(configureRouteSessionsForShieldProfileMock.mock.invocationCallOrder[0]).toBeLessThan(
      collectOrphanedBrowserRoutePartitionStorageMock.mock.invocationCallOrder[0]
    )
  })

  it('does not sweep route partitions when no profile is active', async () => {
    const { collectOrphanedBrowserRoutePartitionStorageMock } = installRegistryMock()
    const { initializeBrowserSessionsForApp } = await import('./browser-session-startup')

    initializeBrowserSessionsForApp()

    expect(collectOrphanedBrowserRoutePartitionStorageMock).not.toHaveBeenCalled()
  })

  it('initializes browser sessions once per app process', async () => {
    const { applyPendingCookieImportMock, initializeBrowserSessionsFromPersistedStateMock } =
      installRegistryMock()
    const { initializeBrowserSessionsForApp } = await import('./browser-session-startup')

    initializeBrowserSessionsForApp()
    initializeBrowserSessionsForApp()

    expect(applyPendingCookieImportMock).toHaveBeenCalledOnce()
    expect(initializeBrowserSessionsFromPersistedStateMock).toHaveBeenCalledOnce()
  })

  it('retries if initialization fails before completion', async () => {
    const { applyPendingCookieImportMock, initializeBrowserSessionsFromPersistedStateMock } =
      installRegistryMock()
    initializeBrowserSessionsFromPersistedStateMock.mockImplementationOnce(() => {
      throw new Error('session init failed')
    })
    const { initializeBrowserSessionsForApp } = await import('./browser-session-startup')

    expect(() => initializeBrowserSessionsForApp()).toThrow('session init failed')
    initializeBrowserSessionsForApp()

    expect(applyPendingCookieImportMock).toHaveBeenCalledTimes(2)
    expect(initializeBrowserSessionsFromPersistedStateMock).toHaveBeenCalledTimes(2)
  })
})
