import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  ConnectCurrentShieldProfileResult,
  ShieldProfileAuthStatus
} from '../../../../shared/shield-profiles'
import { createTestStore } from './store-test-helpers'

const { toastErrorMock } = vi.hoisted(() => ({
  toastErrorMock: vi.fn()
}))

vi.mock('sonner', () => ({
  toast: {
    error: toastErrorMock,
    info: vi.fn(),
    success: vi.fn(),
    warning: vi.fn()
  }
}))

const localAuth: ShieldProfileAuthStatus = {
  activeProfileId: 'local-default',
  configured: true,
  state: 'local',
  persistence: 'none'
}

const shieldProfilesApi = {
  connectCurrent: vi.fn()
}

function deferredConnect(): (result: ConnectCurrentShieldProfileResult) => void {
  let finish!: (result: ConnectCurrentShieldProfileResult) => void
  shieldProfilesApi.connectCurrent.mockReturnValueOnce(
    new Promise<ConnectCurrentShieldProfileResult>((resolve) => {
      finish = resolve
    })
  )
  return (result) => finish(result)
}

describe('shield profile sign-in timeout', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.stubGlobal('window', {
      api: { shieldProfiles: shieldProfilesApi }
    })
  })

  it('reports a timeout only for the newest wait', async () => {
    const finishFirst = deferredConnect()
    const finishSecond = deferredConnect()
    const store = createTestStore()

    const first = store.getState().connectCurrentShieldProfile()
    const second = store.getState().connectCurrentShieldProfile()
    finishFirst({ status: 'cancelled', auth: localAuth })
    await first
    expect(toastErrorMock).not.toHaveBeenCalled()

    finishSecond({ status: 'timed-out', auth: localAuth })
    await second
    expect(toastErrorMock).toHaveBeenCalledOnce()
    expect(toastErrorMock).toHaveBeenCalledWith('Sign-in timed out')
  })

  it('stays silent when the user cancels in the browser', async () => {
    shieldProfilesApi.connectCurrent.mockResolvedValueOnce({ status: 'cancelled', auth: localAuth })
    const store = createTestStore()

    await store.getState().connectCurrentShieldProfile()

    expect(toastErrorMock).not.toHaveBeenCalled()
  })
})
