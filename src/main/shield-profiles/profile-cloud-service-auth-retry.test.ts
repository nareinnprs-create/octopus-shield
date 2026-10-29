import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  ShieldCloudCapabilities,
  ShieldCloudOrgSummary,
  ShieldProfileCloudSummary
} from '../../shared/shield-profiles'
import type { ShieldCloudSessionExchangeResponse } from './profile-cloud-session-exchange'

const {
  beginShieldCloudPkceFlowMock,
  createShieldCloudProfileMock,
  exchangeShieldCloudAuthCodeMock,
  refreshShieldCloudCapabilitiesMock,
  refreshShieldCloudSessionMock,
  selectShieldCloudOrgMock,
  ShieldCloudRequestErrorMock,
  safeStorageMock
} = vi.hoisted(() => ({
  beginShieldCloudPkceFlowMock: vi.fn(),
  createShieldCloudProfileMock: vi.fn(),
  exchangeShieldCloudAuthCodeMock: vi.fn(),
  refreshShieldCloudCapabilitiesMock: vi.fn(),
  refreshShieldCloudSessionMock: vi.fn(),
  selectShieldCloudOrgMock: vi.fn(),
  ShieldCloudRequestErrorMock: class ShieldCloudRequestError extends Error {
    constructor(public readonly statusCode: number) {
      super(`shield_cloud_request_failed_${statusCode}`)
      this.name = 'ShieldCloudRequestError'
    }
  },
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
  ShieldCloudRequestError: ShieldCloudRequestErrorMock,
  isAmbiguousCloudRequestFailure: (error: unknown) => !(error instanceof ShieldCloudRequestErrorMock),
  createShieldCloudProfile: createShieldCloudProfileMock,
  exchangeShieldCloudAuthCode: exchangeShieldCloudAuthCodeMock,
  refreshShieldCloudCapabilities: refreshShieldCloudCapabilitiesMock,
  refreshShieldCloudSession: refreshShieldCloudSessionMock,
  revokeShieldCloudSession: vi.fn(),
  selectShieldCloudOrg: selectShieldCloudOrgMock
}))

import {
  connectCurrentShieldProfile,
  createCloudLinkedShieldProfile,
  getCurrentShieldProfileAuthStatus,
  refreshCurrentShieldProfileAuth,
  selectCurrentShieldProfileOrg
} from './profile-cloud-service'

const cloudSummary: ShieldProfileCloudSummary = {
  cloudProfileId: 'cloud-profile-1',
  userId: 'user-1',
  email: 'nina@example.com',
  displayName: 'Nina',
  linkedAt: 10
}

const capabilities: ShieldCloudCapabilities = {
  flags: { share: true },
  refreshedAt: 11
}

const organizations: ShieldCloudOrgSummary[] = [
  { orgId: 'org-1', name: 'Acme', role: 'Admin' },
  { orgId: 'org-2', name: 'Personal' }
]

function futureExpiresAt(): number {
  return Date.now() + 3_600_000
}

function configureCloudEnv(): void {
  vi.stubEnv('OSHIELD_CLOUD_API_URL', 'https://shield-cloud.example')
  vi.stubEnv('OSHIELD_CLOUD_CLIENT_ID', 'desktop-client')
}

function mockSuccessfulConnect(): void {
  beginShieldCloudPkceFlowMock.mockResolvedValue({
    code: 'auth-code',
    codeVerifier: 'code-verifier',
    nonce: 'nonce',
    redirectUri: 'http://127.0.0.1:4100/auth/callback',
    state: 'state'
  })
  exchangeShieldCloudAuthCodeMock.mockResolvedValue({
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    expiresAt: futureExpiresAt(),
    cloud: cloudSummary,
    organizations,
    capabilities
  } satisfies ShieldCloudSessionExchangeResponse)
}

function mockSuccessfulSessionRefresh(): void {
  refreshShieldCloudSessionMock.mockResolvedValue({
    accessToken: 'rotated-access-token',
    refreshToken: 'rotated-refresh-token',
    expiresAt: futureExpiresAt(),
    cloud: cloudSummary,
    organizations,
    capabilities
  } satisfies ShieldCloudSessionExchangeResponse)
}

describe('Shield cloud profile auth-failure retry', () => {
  beforeEach(() => {
    userDataPath = mkdtempSync(join(tmpdir(), 'shield-cloud-service-auth-retry-'))
    beginShieldCloudPkceFlowMock.mockReset()
    createShieldCloudProfileMock.mockReset()
    exchangeShieldCloudAuthCodeMock.mockReset()
    refreshShieldCloudCapabilitiesMock.mockReset()
    refreshShieldCloudSessionMock.mockReset()
    selectShieldCloudOrgMock.mockReset()
    safeStorageMock.decryptString.mockReset()
    safeStorageMock.encryptString.mockReset()
    safeStorageMock.isEncryptionAvailable.mockReset()
    safeStorageMock.decryptString.mockImplementation((value: Buffer) => value.toString('utf-8'))
    safeStorageMock.encryptString.mockImplementation((value: string) => Buffer.from(value, 'utf-8'))
    safeStorageMock.isEncryptionAvailable.mockReturnValue(true)
    vi.unstubAllEnvs()
    vi.stubEnv('OSHIELD_CLOUD_API_URL', '')
    vi.stubEnv('OSHIELD_CLOUD_CLIENT_ID', '')
  })

  afterEach(() => {
    rmSync(userDataPath, { recursive: true, force: true })
    vi.unstubAllEnvs()
  })

  it('refreshes and retries cloud profile creation after an auth failure', async () => {
    configureCloudEnv()
    mockSuccessfulConnect()
    mockSuccessfulSessionRefresh()
    await connectCurrentShieldProfile(userDataPath)
    createShieldCloudProfileMock
      .mockRejectedValueOnce(new ShieldCloudRequestErrorMock(401))
      .mockResolvedValue({
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
        expiresAt: futureExpiresAt(),
        cloud: { ...cloudSummary, cloudProfileId: 'cloud-profile-2' },
        organizations,
        capabilities
      } satisfies ShieldCloudSessionExchangeResponse)

    const result = await createCloudLinkedShieldProfile(userDataPath, { name: 'Acme' })

    expect(result.status).toBe('created')
    expect(createShieldCloudProfileMock).toHaveBeenNthCalledWith(
      2,
      expect.any(Object),
      expect.objectContaining({ accessToken: 'rotated-access-token' }),
      { name: 'Acme' }
    )
  })

  it('refreshes and retries capability refresh after an auth failure', async () => {
    configureCloudEnv()
    mockSuccessfulConnect()
    mockSuccessfulSessionRefresh()
    await connectCurrentShieldProfile(userDataPath)
    refreshShieldCloudCapabilitiesMock
      .mockRejectedValueOnce(new ShieldCloudRequestErrorMock(403))
      .mockResolvedValue({
        capabilities: { flags: { share: false }, refreshedAt: 26 } satisfies ShieldCloudCapabilities
      })

    const result = await refreshCurrentShieldProfileAuth(userDataPath)

    expect(result.status).toBe('refreshed')
    expect(refreshShieldCloudCapabilitiesMock).toHaveBeenNthCalledWith(
      2,
      expect.any(Object),
      expect.objectContaining({ accessToken: 'rotated-access-token' })
    )
    expect(getCurrentShieldProfileAuthStatus(userDataPath).capabilities).toEqual({
      flags: { share: false },
      refreshedAt: 26
    })
  })

  it('requires reconnect when a retried capability refresh is still unauthorized', async () => {
    configureCloudEnv()
    mockSuccessfulConnect()
    mockSuccessfulSessionRefresh()
    await connectCurrentShieldProfile(userDataPath)
    refreshShieldCloudCapabilitiesMock
      .mockRejectedValueOnce(new ShieldCloudRequestErrorMock(401))
      .mockRejectedValueOnce(new ShieldCloudRequestErrorMock(401))

    const result = await refreshCurrentShieldProfileAuth(userDataPath)

    expect(result.status).toBe('reconnect-required')
    expect(getCurrentShieldProfileAuthStatus(userDataPath)).toMatchObject({
      state: 'reconnect-required',
      persistence: 'none',
      cloud: cloudSummary
    })
  })

  it('refreshes and retries organization selection after an auth failure', async () => {
    configureCloudEnv()
    mockSuccessfulConnect()
    mockSuccessfulSessionRefresh()
    await connectCurrentShieldProfile(userDataPath)
    selectShieldCloudOrgMock
      .mockRejectedValueOnce(new ShieldCloudRequestErrorMock(401))
      .mockResolvedValue({
        cloud: { ...cloudSummary, activeOrgId: 'org-1', activeOrgName: 'Acme' },
        organizations,
        capabilities
      })

    const result = await selectCurrentShieldProfileOrg(userDataPath, 'org-1')

    expect(result.status).toBe('selected')
    expect(selectShieldCloudOrgMock).toHaveBeenNthCalledWith(
      2,
      expect.any(Object),
      expect.objectContaining({ accessToken: 'rotated-access-token' }),
      'org-1'
    )
  })
})
