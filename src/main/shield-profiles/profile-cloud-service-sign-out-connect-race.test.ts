import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  ShieldCloudCapabilities,
  ShieldCloudOrgSummary,
  ShieldProfileCloudSummary
} from '../../shared/shield-profiles'

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
  app: { getPath: () => userDataPath },
  safeStorage: safeStorageMock
}))

vi.mock('./profile-cloud-pkce', () => ({
  beginShieldCloudPkceFlow: beginShieldCloudPkceFlowMock
}))

vi.mock('./profile-cloud-client', () => ({
  createShieldCloudProfile: vi.fn(),
  exchangeShieldCloudAuthCode: exchangeShieldCloudAuthCodeMock,
  revokeShieldCloudSession: revokeShieldCloudSessionMock,
  selectShieldCloudOrg: vi.fn()
}))

import {
  connectCurrentShieldProfile,
  getCurrentShieldProfileAuthStatus,
  signOutCurrentShieldProfile
} from './profile-cloud-service'

const cloud: ShieldProfileCloudSummary = {
  cloudProfileId: 'cloud-profile-1',
  userId: 'user-1',
  email: 'nina@example.com',
  displayName: 'Nina',
  linkedAt: 10
}

const laterCloud: ShieldProfileCloudSummary = {
  ...cloud,
  cloudProfileId: 'cloud-profile-2',
  email: 'ada@example.com'
}

const capabilities: ShieldCloudCapabilities = { flags: { share: true }, refreshedAt: 11 }
const organizations: ShieldCloudOrgSummary[] = [{ orgId: 'org-1', name: 'Acme', role: 'Admin' }]

describe('Shield cloud sign-out vs newer connect', () => {
  beforeEach(() => {
    userDataPath = mkdtempSync(join(tmpdir(), 'shield-cloud-sign-out-connect-'))
    beginShieldCloudPkceFlowMock.mockReset()
    exchangeShieldCloudAuthCodeMock.mockReset()
    revokeShieldCloudSessionMock.mockReset()
    safeStorageMock.decryptString.mockReset()
    safeStorageMock.encryptString.mockReset()
    safeStorageMock.isEncryptionAvailable.mockReset()
    safeStorageMock.decryptString.mockImplementation((value: Buffer) => value.toString('utf-8'))
    safeStorageMock.encryptString.mockImplementation((value: string) => Buffer.from(value, 'utf-8'))
    safeStorageMock.isEncryptionAvailable.mockReturnValue(true)
    vi.stubEnv('OSHIELD_CLOUD_API_URL', 'https://shield-cloud.example')
    vi.stubEnv('OSHIELD_CLOUD_CLIENT_ID', 'desktop-client')
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
      expiresAt: Date.now() + 3_600_000,
      cloud,
      organizations,
      capabilities
    })
  })

  afterEach(() => {
    rmSync(userDataPath, { recursive: true, force: true })
    vi.unstubAllEnvs()
  })

  it('keeps a newer connect that finishes while sign-out is still revoking', async () => {
    await expect(connectCurrentShieldProfile(userDataPath)).resolves.toMatchObject({
      status: 'connected'
    })
    let finishRevoke!: () => void
    revokeShieldCloudSessionMock.mockReturnValue(
      new Promise<void>((resolve) => {
        finishRevoke = resolve
      })
    )
    const signingOut = signOutCurrentShieldProfile(userDataPath)
    exchangeShieldCloudAuthCodeMock.mockResolvedValue({
      accessToken: 'later-access',
      refreshToken: 'later-refresh',
      expiresAt: Date.now() + 3_600_000,
      cloud: laterCloud,
      organizations,
      capabilities
    })
    await expect(connectCurrentShieldProfile(userDataPath)).resolves.toMatchObject({
      status: 'connected'
    })
    expect(getCurrentShieldProfileAuthStatus(userDataPath).cloud?.email).toBe('ada@example.com')
    finishRevoke()
    await expect(signingOut).resolves.toMatchObject({ status: 'signed-out' })
    expect(getCurrentShieldProfileAuthStatus(userDataPath)).toMatchObject({
      state: 'connected',
      cloud: { email: 'ada@example.com' }
    })
  })
})
