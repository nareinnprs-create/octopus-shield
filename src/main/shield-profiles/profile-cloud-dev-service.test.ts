import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const {
  beginShieldCloudPkceFlowMock,
  exchangeShieldCloudAuthCodeMock,
  revokeShieldCloudSessionMock,
  safeStorageMock
} = vi.hoisted(() => ({
  beginShieldCloudPkceFlowMock: vi.fn(),
  exchangeShieldCloudAuthCodeMock: vi.fn(),
  revokeShieldCloudSessionMock: vi.fn(),
  safeStorageMock: {
    decryptString: vi.fn((value: Buffer) => value.toString('utf-8')),
    encryptString: vi.fn((value: string) => Buffer.from(value, 'utf-8')),
    isEncryptionAvailable: vi.fn(() => true)
  }
}))

let userDataPath = ''

vi.mock('electron', () => ({
  app: {
    getPath: () => userDataPath
  },
  safeStorage: safeStorageMock
}))

vi.mock('./profile-cloud-pkce', () => ({
  beginShieldCloudPkceFlow: beginShieldCloudPkceFlowMock
}))

vi.mock('./profile-cloud-client', () => ({
  createShieldCloudProfile: vi.fn(),
  exchangeShieldCloudAuthCode: exchangeShieldCloudAuthCodeMock,
  refreshShieldCloudCapabilities: vi.fn(),
  refreshShieldCloudSession: vi.fn(),
  revokeShieldCloudSession: revokeShieldCloudSessionMock,
  selectShieldCloudOrg: vi.fn()
}))

import {
  connectCurrentShieldProfile,
  createCloudLinkedShieldProfile,
  getCurrentShieldProfileAuthStatus,
  selectCurrentShieldProfileOrg,
  signOutCurrentShieldProfile
} from './profile-cloud-service'

describe('Shield cloud dev auth service', () => {
  beforeEach(() => {
    userDataPath = mkdtempSync(join(tmpdir(), 'shield-cloud-dev-auth-'))
    beginShieldCloudPkceFlowMock.mockReset()
    exchangeShieldCloudAuthCodeMock.mockReset()
    revokeShieldCloudSessionMock.mockReset()
    safeStorageMock.decryptString.mockReset()
    safeStorageMock.encryptString.mockReset()
    safeStorageMock.isEncryptionAvailable.mockReset()
    safeStorageMock.decryptString.mockImplementation((value: Buffer) => value.toString('utf-8'))
    safeStorageMock.encryptString.mockImplementation((value: string) => Buffer.from(value, 'utf-8'))
    safeStorageMock.isEncryptionAvailable.mockReturnValue(true)
    vi.unstubAllEnvs()
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('OSHIELD_CLOUD_DEV_AUTH', '1')
    vi.stubEnv('OSHIELD_CLOUD_API_URL', '')
    vi.stubEnv('OSHIELD_CLOUD_CLIENT_ID', '')
  })

  afterEach(() => {
    rmSync(userDataPath, { recursive: true, force: true })
    vi.unstubAllEnvs()
  })

  it('connects the active profile without PKCE or cloud endpoints', async () => {
    expect(getCurrentShieldProfileAuthStatus(userDataPath)).toMatchObject({
      configured: true,
      state: 'local'
    })

    const result = await connectCurrentShieldProfile(userDataPath)

    expect(result.status).toBe('connected')
    expect(beginShieldCloudPkceFlowMock).not.toHaveBeenCalled()
    expect(exchangeShieldCloudAuthCodeMock).not.toHaveBeenCalled()
    expect(getCurrentShieldProfileAuthStatus(userDataPath)).toMatchObject({
      configured: true,
      state: 'connected',
      persistence: 'encrypted',
      cloud: {
        cloudProfileId: 'dev-cloud-local-default',
        email: 'dev@shield.local'
      },
      capabilities: {
        flags: expect.objectContaining({ 'share.create': true })
      }
    })
    expect(getCurrentShieldProfileAuthStatus(userDataPath).organizations).toHaveLength(2)
  })

  it('selects dev organizations and creates org-scoped cloud profiles locally', async () => {
    await connectCurrentShieldProfile(userDataPath)

    const selected = await selectCurrentShieldProfileOrg(userDataPath, 'dev-acme')
    const created = await createCloudLinkedShieldProfile(userDataPath, {
      orgId: 'dev-acme',
      name: 'Acme Dev'
    })

    expect(selected.status).toBe('selected')
    expect(getCurrentShieldProfileAuthStatus(userDataPath).cloud).toMatchObject({
      activeOrgId: 'dev-acme',
      activeOrgName: 'Acme Dev'
    })
    expect(created.status).toBe('created')
    if (created.status === 'created') {
      expect(created.profile).toMatchObject({
        name: 'Acme Dev',
        kind: 'cloud-linked',
        cloud: expect.objectContaining({
          activeOrgId: 'dev-acme',
          activeOrgName: 'Acme Dev'
        })
      })
    }
  })

  it('signs out locally without calling the cloud logout endpoint', async () => {
    await connectCurrentShieldProfile(userDataPath)
    const regionCache = join(userDataPath, 'shield-relay-region-preference.json')
    writeFileSync(regionCache, '{}')

    const result = await signOutCurrentShieldProfile(userDataPath)

    expect(result.status).toBe('signed-out')
    expect(existsSync(regionCache)).toBe(false)
    expect(revokeShieldCloudSessionMock).not.toHaveBeenCalled()
    expect(getCurrentShieldProfileAuthStatus(userDataPath)).toMatchObject({
      configured: true,
      state: 'local',
      persistence: 'none'
    })
  })
})
