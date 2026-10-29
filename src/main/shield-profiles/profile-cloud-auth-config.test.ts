import { describe, expect, it, vi } from 'vitest'
import {
  allowsPlaintextShieldCloudSession,
  getShieldCloudAuthConfig,
  isShieldCloudDevAuthEnabled
} from './profile-cloud-auth-config'

vi.mock('electron', () => ({
  app: {
    isPackaged: false
  }
}))

describe('Shield cloud auth config', () => {
  it('reports unconfigured without both API URL and client ID', () => {
    expect(getShieldCloudAuthConfig({})).toEqual({
      configured: false,
      setupMessage: 'Shield Cloud sign-in is not configured for this build.'
    })
  })

  it('builds default desktop auth endpoints from the API URL', () => {
    const state = getShieldCloudAuthConfig({
      OSHIELD_CLOUD_API_URL: 'https://shield-cloud.example/',
      OSHIELD_CLOUD_CLIENT_ID: 'desktop-client'
    })

    expect(state).toEqual({
      configured: true,
      config: {
        apiBaseUrl: 'https://shield-cloud.example',
        authorizeEndpoint: 'https://shield-cloud.example/v1/desktop/auth/authorize',
        sessionEndpoint: 'https://shield-cloud.example/v1/desktop/auth/session',
        refreshEndpoint: 'https://shield-cloud.example/v1/desktop/auth/refresh',
        capabilitiesEndpoint: 'https://shield-cloud.example/v1/desktop/auth/capabilities',
        profileEndpoint: 'https://shield-cloud.example/v1/desktop/auth/profile',
        orgEndpoint: 'https://shield-cloud.example/v1/desktop/auth/org',
        logoutEndpoint: 'https://shield-cloud.example/v1/desktop/auth/logout',
        relayTokenEndpoint: 'https://shield-cloud.example/v1/desktop/auth/relay-token',
        connectorTokenEndpoint: 'https://shield-cloud.example/v1/desktop/auth/connector-token',
        relayDirectorUrl: 'https://relay.octopusshield.invalid',
        clientId: 'desktop-client',
        scope: 'openid profile email offline_access'
      }
    })
  })

  it('uses first-party production endpoints without runtime env in packaged builds', () => {
    expect(getShieldCloudAuthConfig({}, true)).toEqual({
      configured: true,
      config: {
        apiBaseUrl: 'https://login.octopusshield.invalid',
        authorizeEndpoint: 'https://login.octopusshield.invalid/v1/desktop/auth/authorize',
        sessionEndpoint: 'https://login.octopusshield.invalid/v1/desktop/auth/session',
        refreshEndpoint: 'https://login.octopusshield.invalid/v1/desktop/auth/refresh',
        capabilitiesEndpoint: 'https://login.octopusshield.invalid/v1/desktop/auth/capabilities',
        profileEndpoint: 'https://login.octopusshield.invalid/v1/desktop/auth/profile',
        orgEndpoint: 'https://login.octopusshield.invalid/v1/desktop/auth/org',
        logoutEndpoint: 'https://login.octopusshield.invalid/v1/desktop/auth/logout',
        relayTokenEndpoint: 'https://login.octopusshield.invalid/v1/desktop/auth/relay-token',
        connectorTokenEndpoint: 'https://login.octopusshield.invalid/v1/desktop/auth/connector-token',
        relayDirectorUrl: 'https://relay.octopusshield.invalid',
        clientId: 'shield-desktop',
        scope: 'openid profile email offline_access'
      }
    })
  })

  it('allows loopback HTTP endpoints for local desktop auth development', () => {
    const state = getShieldCloudAuthConfig({
      OSHIELD_CLOUD_API_URL: 'http://localhost:4100',
      OSHIELD_CLOUD_CLIENT_ID: 'desktop-client'
    })

    expect(state.configured).toBe(true)
  })

  it('rejects loopback HTTP endpoints in packaged builds', () => {
    expect(
      getShieldCloudAuthConfig(
        {
          OSHIELD_CLOUD_API_URL: 'http://localhost:4100',
          OSHIELD_CLOUD_CLIENT_ID: 'desktop-client'
        },
        true
      )
    ).toMatchObject({ configured: false })

    const httpsState = getShieldCloudAuthConfig(
      {
        OSHIELD_CLOUD_API_URL: 'https://shield-cloud.example',
        OSHIELD_CLOUD_CLIENT_ID: 'desktop-client'
      },
      true
    )
    expect(httpsState.configured).toBe(true)
  })

  it('rejects non-HTTPS non-loopback API URLs', () => {
    expect(
      getShieldCloudAuthConfig({
        OSHIELD_CLOUD_API_URL: 'http://shield-cloud.example',
        OSHIELD_CLOUD_CLIENT_ID: 'desktop-client'
      })
    ).toMatchObject({ configured: false })
  })

  it('allows dev plaintext sessions only outside production', () => {
    expect(
      allowsPlaintextShieldCloudSession({
        OSHIELD_CLOUD_ALLOW_PLAINTEXT_SESSION: '1',
        NODE_ENV: 'development'
      })
    ).toBe(true)
    expect(
      allowsPlaintextShieldCloudSession({
        OSHIELD_CLOUD_ALLOW_PLAINTEXT_SESSION: '1',
        NODE_ENV: 'production'
      })
    ).toBe(false)
  })

  it('ignores dev flags in packaged builds even without NODE_ENV', () => {
    expect(allowsPlaintextShieldCloudSession({ OSHIELD_CLOUD_ALLOW_PLAINTEXT_SESSION: '1' }, true)).toBe(
      false
    )
    expect(isShieldCloudDevAuthEnabled({ OSHIELD_CLOUD_DEV_AUTH: '1' }, true)).toBe(false)
  })

  it('allows local dev auth only outside production', () => {
    expect(
      isShieldCloudDevAuthEnabled({
        OSHIELD_CLOUD_DEV_AUTH: '1',
        NODE_ENV: 'development'
      })
    ).toBe(true)
    expect(
      isShieldCloudDevAuthEnabled({
        OSHIELD_CLOUD_DEV_AUTH: '1',
        NODE_ENV: 'production'
      })
    ).toBe(false)
  })
})
