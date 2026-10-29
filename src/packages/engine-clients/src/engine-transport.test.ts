import { describe, expect, it, vi } from 'vitest'

import {
  EngineTransportError,
  engineJson,
  engineRequest,
  engineUrl,
  type ShieldEngineClientConfig,
  type ShieldFetchLike,
  type ShieldResponseLike
} from './engine-transport'

const response = (status: number, body: string): ShieldResponseLike => ({
  status,
  ok: status >= 200 && status < 300,
  json: async () => JSON.parse(body) as unknown,
  text: async () => body
})

const configWith = (fetchLike: ShieldFetchLike, baseUrl = 'https://caldera.example.internal'): ShieldEngineClientConfig => ({
  baseUrl,
  fetchLike
})

describe('engineUrl', () => {
  it('joins relative paths onto the engine base URL', () => {
    expect(engineUrl('https://caldera.example.internal', 'api/v2/health')).toBe(
      'https://caldera.example.internal/api/v2/health'
    )
    expect(engineUrl('https://caldera.example.internal/', '/api/v2/health')).toBe(
      'https://caldera.example.internal/api/v2/health'
    )
  })

  it('keeps the configured origin, port, and scheme', () => {
    expect(engineUrl('http://localhost:8890', '/api/v2/health')).toBe('http://localhost:8890/api/v2/health')
    expect(engineUrl('https://mythic.internal:7443', 'graphql/')).toBe('https://mythic.internal:7443/graphql/')
  })

  it('rejects protocol-relative host escapes with RangeError', () => {
    expect(() => engineUrl('https://caldera.example.internal', '//evil.example/x')).toThrow(RangeError)
  })

  it('rejects absolute-URL and scheme-change escapes with RangeError', () => {
    expect(() => engineUrl('https://caldera.example.internal', 'https://evil.example/x')).toThrow(RangeError)
    expect(() => engineUrl('https://caldera.example.internal', 'http://caldera.example.internal/x')).toThrow(RangeError)
    expect(() => engineUrl('https://caldera.example.internal', 'file:///etc/passwd')).toThrow(RangeError)
  })

  it('still allows on-origin absolute and deep-relative paths (call-site contract)', () => {
    // new URL percent-encodes brace templating in the path.
    expect(engineUrl('https://caldera.example.internal', '/api/v2/abilities/{ability_id}')).toBe(
      'https://caldera.example.internal/api/v2/abilities/%7Bability_id%7D'
    )
    expect(engineUrl('https://caldera.example.internal', 'a/b/../c')).toBe('https://caldera.example.internal/a/c')
  })
})

describe('engineRequest', () => {
  it('passes method/headers/body through to fetchLike at the composed URL', async () => {
    const fetchLike = vi.fn(async () => response(200, '{"ok":true}'))
    const config = configWith(fetchLike)
    const result = await engineRequest('caldera', config, {
      method: 'POST',
      path: '/api/v2/abilities',
      headers: { KEY: 'k' },
      body: '{}'
    })
    expect(result.status).toBe(200)
    expect(fetchLike).toHaveBeenCalledWith('https://caldera.example.internal/api/v2/abilities', {
      method: 'POST',
      headers: { KEY: 'k' },
      body: '{}',
      signal: undefined
    })
  })

  it('returns ok responses untouched for engineJson', async () => {
    const config = configWith(async () => response(200, '{"application":"caldera"}'))
    const parsed = await engineJson<{ application: string }>(
      await engineRequest('caldera', config, { method: 'GET', path: '/api/v2/health' })
    )
    expect(parsed).toEqual({ application: 'caldera' })
  })

  it('throws EngineTransportError on 401 with a [redacted] body', async () => {
    const config = configWith(async () => response(401, 'Bearer token=SECRET-CREDENTIAL material'))
    const error = await engineRequest('caldera', config, { method: 'GET', path: '/api/v2/health' }).catch(
      (caught: unknown) => caught
    )
    expect(error).toBeInstanceOf(EngineTransportError)
    const transportError = error as EngineTransportError
    expect(transportError.status).toBe(401)
    expect(transportError.message).toContain('[redacted]')
    expect(transportError.message).not.toContain('SECRET-CREDENTIAL')
    expect(transportError.body).toBe('[redacted]')
    expect(transportError.name).toBe('EngineTransportError')
    expect(transportError).toBeInstanceOf(Error)
  })

  it('throws EngineTransportError on 403 with a [redacted] body', async () => {
    const config = configWith(async () => response(403, 'role=auditor SECRET'))
    const error = (await engineRequest('wazuh', config, { method: 'GET', path: '/' }).catch(
      (caught: unknown) => caught
    )) as EngineTransportError
    expect(error.status).toBe(403)
    expect(error.body).toBe('[redacted]')
    expect(error.message).toContain('wazuh request failed (403)')
    expect(error.message).not.toContain('SECRET')
  })

  it('keeps the body (message-truncated) for other non-ok statuses', async () => {
    const bodyText = 'boom '.repeat(200)
    const config = configWith(async () => response(500, bodyText))
    const error = (await engineRequest('caldera', config, { method: 'GET', path: '/x' }).catch(
      (caught: unknown) => caught
    )) as EngineTransportError
    expect(error.status).toBe(500)
    expect(error.body).toBe(bodyText)
    expect(error.message).toBe('caldera request failed (500): ' + bodyText.slice(0, 512))
  })
})
