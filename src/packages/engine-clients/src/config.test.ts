import { describe, expect, it } from 'vitest'

import { DEFAULT_ENGINE_FABRIC, readEngineFabricConfig, resolveEngineUrl } from './config'

describe('resolveEngineUrl', () => {
  it('returns the fallback when the variable is unset', () => {
    expect(resolveEngineUrl({}, 'OSHIELD_TEST_URL', 'https://fallback.internal:55000')).toBe(
      'https://fallback.internal:55000'
    )
  })

  it('accepts https URLs and returns them verbatim', () => {
    expect(resolveEngineUrl({ OSHIELD_TEST_URL: 'https://wazuh.internal:55000' }, 'OSHIELD_TEST_URL', 'x')).toBe(
      'https://wazuh.internal:55000'
    )
  })

  it('accepts http on localhost hosts only (dev convenience)', () => {
    for (const host of ['localhost', '127.0.0.1']) {
      expect(resolveEngineUrl({ OSHIELD_TEST_URL: `http://${host}:8890/` }, 'OSHIELD_TEST_URL', 'x')).toBe(
        `http://${host}:8890/`
      )
    }
  })

  it('throws on http to a non-localhost host', () => {
    expect(() => resolveEngineUrl({ OSHIELD_TEST_URL: 'http://10.0.0.5:8890' }, 'OSHIELD_TEST_URL', 'x')).toThrow(
      /must be https:\/\/ \(or http:\/\/ on localhost\)/
    )
  })

  it('throws on a URL without a hostname', () => {
    expect(() => resolveEngineUrl({ OSHIELD_TEST_URL: 'file:///etc/passwd' }, 'OSHIELD_TEST_URL', 'x')).toThrow(
      /missing a hostname/
    )
  })

  it('throws on an unparseable URL', () => {
    expect(() => resolveEngineUrl({ OSHIELD_TEST_URL: 'not a url at all' }, 'OSHIELD_TEST_URL', 'x')).toThrow(
      /is not a valid URL/
    )
  })
})

describe('readEngineFabricConfig', () => {
  it('falls back to the live deployment defaults with empty tokens', () => {
    expect(readEngineFabricConfig({})).toEqual({
      wazuhUrl: DEFAULT_ENGINE_FABRIC.wazuhUrl,
      wazuhApiToken: '',
      calderaUrl: DEFAULT_ENGINE_FABRIC.calderaUrl,
      calderaApiKey: '',
      mythicUrl: DEFAULT_ENGINE_FABRIC.mythicUrl,
      mythicApiToken: ''
    })
    expect(DEFAULT_ENGINE_FABRIC.wazuhUrl).toBe('https://localhost:55000')
    expect(DEFAULT_ENGINE_FABRIC.calderaUrl).toBe('http://localhost:8890')
    expect(DEFAULT_ENGINE_FABRIC.mythicUrl).toBe('https://localhost:7443')
  })

  it('overrides URLs and tokens from env; a bad URL is a loud failure', () => {
    const config = readEngineFabricConfig({
      OSHIELD_WAZUH_MANAGER_API_URL: 'https://wazuh.internal:55000',
      OSHIELD_WAZUH_API_TOKEN: 'wtoken',
      OSHIELD_CALDERA_API_KEY: 'ckey',
      OSHIELD_MYTHIC_UI_URL: 'http://127.0.0.1:7443'
    })
    expect(config.wazuhUrl).toBe('https://wazuh.internal:55000')
    expect(config.wazuhApiToken).toBe('wtoken')
    expect(config.calderaApiKey).toBe('ckey')
    expect(config.mythicUrl).toBe('http://127.0.0.1:7443')

    expect(() =>
      readEngineFabricConfig({ OSHIELD_CALDERA_API_URL: 'http://caldera.internal:8890' })
    ).toThrow(/must be https/)
  })
})
