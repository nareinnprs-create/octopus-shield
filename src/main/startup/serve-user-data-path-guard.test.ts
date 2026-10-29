import { describe, expect, it, vi } from 'vitest'
import { checkServeUserDataPath } from './serve-user-data-path-guard'

describe('checkServeUserDataPath', () => {
  it('refuses a serve that landed on a profile other than the one the CLI chose', () => {
    const env: NodeJS.ProcessEnv = { OSHIELD_SERVE_USER_DATA_PATH: '/isolated/profile' }
    expect(
      checkServeUserDataPath({ isServeMode: true, userDataPath: '/default/shield', env })
    ).toContain('/isolated/profile')
    expect(env.OSHIELD_SERVE_USER_DATA_PATH).toBeUndefined()
  })

  it('allows the chosen profile, including another spelling of it', () => {
    expect(
      checkServeUserDataPath({
        isServeMode: true,
        userDataPath: '/isolated/profile',
        env: { OSHIELD_SERVE_USER_DATA_PATH: '/isolated/./profile/' }
      })
    ).toBeNull()
    expect(
      checkServeUserDataPath({
        isServeMode: true,
        userDataPath: 'C:\\Users\\Me\\Shield',
        env: { OSHIELD_SERVE_USER_DATA_PATH: 'c:\\users\\me\\shield' },
        platform: 'win32'
      })
    ).toBeNull()
  })

  it('leaves launches without a CLI choice, or outside serve, alone', () => {
    expect(checkServeUserDataPath({ isServeMode: true, userDataPath: '/a', env: {} })).toBeNull()
    const env: NodeJS.ProcessEnv = { OSHIELD_SERVE_USER_DATA_PATH: '/b' }
    expect(checkServeUserDataPath({ isServeMode: false, userDataPath: '/a', env })).toBeNull()
    expect(env.OSHIELD_SERVE_USER_DATA_PATH).toBeUndefined()
  })
})

describe('configureShieldUserDataPathEnv on a serve launch', () => {
  it('throws before the instance lock instead of publishing a mismatched profile', async () => {
    vi.doMock('electron', () => ({ app: { getPath: () => '/default/shield' } }))
    const { configureShieldUserDataPathEnv } = await import('./configure-process')
    const argv = process.argv
    const previous = process.env.OSHIELD_USER_DATA_PATH
    process.argv = [...argv, '--serve']
    process.env.OSHIELD_SERVE_USER_DATA_PATH = '/isolated/profile'
    process.env.OSHIELD_USER_DATA_PATH = '/isolated/profile'
    try {
      expect(() => configureShieldUserDataPathEnv()).toThrow('/isolated/profile')
      expect(process.env.OSHIELD_USER_DATA_PATH).toBe('/isolated/profile')
    } finally {
      process.argv = argv
      delete process.env.OSHIELD_SERVE_USER_DATA_PATH
      if (previous === undefined) {
        delete process.env.OSHIELD_USER_DATA_PATH
      } else {
        process.env.OSHIELD_USER_DATA_PATH = previous
      }
      vi.doUnmock('electron')
    }
  })
})
