import { describe, expect, it } from 'vitest'
import { loadConnectorConfig } from './config.js'

const ENV = {
  OSHIELD_CONNECTOR_PUBLIC_URL: 'https://connector.octopusshield.invalid',
  OSHIELD_CONNECTOR_AUTH_ISSUER: 'https://login.octopusshield.invalid',
  OSHIELD_CONNECTOR_JWKS_URL: 'https://login.octopusshield.invalid/.well-known/jwks.json'
}

describe('connector config', () => {
  it('fills defaults around the required settings', () => {
    expect(loadConnectorConfig(ENV)).toEqual({
      mode: 'active',
      role: 'api',
      port: 8080,
      publicUrl: 'https://connector.octopusshield.invalid',
      dataDir: './data/connector',
      databasePoolMax: 10,
      authIssuer: 'https://login.octopusshield.invalid',
      jwksUrl: 'https://login.octopusshield.invalid/.well-known/jwks.json',
      trustedProxyHops: 0
    })
  })

  it('treats a blank database URL as absent', () => {
    expect(loadConnectorConfig({ ...ENV, OSHIELD_CONNECTOR_DATABASE_URL: ' ' }).databaseUrl).toBe(
      undefined
    )
  })

  it.each([
    ['a path on the public URL', { OSHIELD_CONNECTOR_PUBLIC_URL: 'https://connector.octopusshield.invalid/x' }],
    ['plain HTTP off loopback', { OSHIELD_CONNECTOR_AUTH_ISSUER: 'http://login.octopusshield.invalid' }],
    ['a missing key set URL', { OSHIELD_CONNECTOR_JWKS_URL: undefined }],
    ['a plain HTTP key set URL', { OSHIELD_CONNECTOR_JWKS_URL: 'http://login.octopusshield.invalid/jwks' }],
    ['the gateway role without Discord', { OSHIELD_CONNECTOR_ROLE: 'discord-gateway' }]
  ])('rejects %s', (_name, override) => {
    expect(() => loadConnectorConfig({ ...ENV, ...override })).toThrow()
  })

  it('allows plain HTTP on loopback for local development', () => {
    expect(
      loadConnectorConfig({ ...ENV, OSHIELD_CONNECTOR_PUBLIC_URL: 'http://127.0.0.1:8080' }).publicUrl
    ).toBe('http://127.0.0.1:8080')
  })
})
