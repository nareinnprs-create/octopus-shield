import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  sanitizeNeuroProviderProfile,
  testNeuroProviderConnection,
  type NeuroProviderFetchLike
} from './neuro-provider-registry'
import { NEURO_BUILTIN_PROFILES } from '../../shared/neuro-provider-types'
import { createNeuroProviderRegistryStore } from './neuro-provider-registry-store'

const validProfile = {
  id: 'my-endpoint',
  name: 'My Endpoint',
  kind: 'cloud' as const,
  baseUrl: 'https://llm.example.com/v1/',
  chatPath: '/chat/completions',
  authScheme: 'bearer' as const,
  authLocation: null,
  authRef: 'neuro-my-endpoint',
  models: ['gpt-4o', '  gpt-4o-mini  ', ''],
  responsePath: null,
  requestTemplate: null
}

describe('sanitizeNeuroProviderProfile', () => {
  it('fills defaults and normalizes base URL and models', () => {
    const profile = sanitizeNeuroProviderProfile(validProfile)
    expect(profile).not.toBeNull()
    expect(profile?.baseUrl).toBe('https://llm.example.com/v1')
    expect(profile?.chatPath).toBe('/chat/completions')
    expect(profile?.authRef).toBe('neuro-my-endpoint')
    expect(profile?.responsePath).toBe('choices.0.message.content')
    expect(profile?.models).toEqual(['gpt-4o', 'gpt-4o-mini'])
  })

  it('rejects unusable profiles', () => {
    expect(sanitizeNeuroProviderProfile(null)).toBeNull()
    expect(sanitizeNeuroProviderProfile({ ...validProfile, id: 'Bad_ID Space' })).toBeNull()
    expect(sanitizeNeuroProviderProfile({ ...validProfile, baseUrl: 'not a url' })).toBeNull()
    expect(sanitizeNeuroProviderProfile({ ...validProfile, baseUrl: 'ftp://x' })).toBeNull()
    expect(sanitizeNeuroProviderProfile({ ...validProfile, kind: 'quantum' })).toBeNull()
    expect(sanitizeNeuroProviderProfile({ ...validProfile, authScheme: 'secret' })).toBeNull()
  })

  it('defaults authLocation per scheme and clears authRef for none', () => {
    expect(
      sanitizeNeuroProviderProfile({ ...validProfile, authScheme: 'header' })?.authLocation
    ).toBe('x-api-key')
    expect(
      sanitizeNeuroProviderProfile({
        ...validProfile,
        authScheme: 'query',
        authLocation: 'api-key'
      })?.authLocation
    ).toBe('api-key')
    expect(
      sanitizeNeuroProviderProfile({ ...validProfile, authScheme: 'none', authRef: null })?.authRef
    ).toBeNull()
  })

  it('exposes keyless local defaults for ollama', () => {
    const ollama = NEURO_BUILTIN_PROFILES.find((profile) => profile.id === 'ollama')
    expect(ollama).toMatchObject({
      baseUrl: 'http://localhost:11434',
      chatPath: '/api/chat',
      authScheme: 'none'
    })
  })
})

describe('createNeuroProviderRegistryStore', () => {
  const parent = mkdtempSync(join(tmpdir(), 'neuro-registry-'))
  const filePath = join(parent, 'neuro-providers.json')

  afterEach(() => {
    rmSync(parent, { recursive: true, force: true })
  })

  it('starts empty, persists upserts, and reloads from disk', () => {
    const store = createNeuroProviderRegistryStore(filePath)
    expect(store.list()).toEqual([])
    const profile = sanitizeNeuroProviderProfile(validProfile)
    expect(profile).not.toBeNull()
    store.upsert(profile!)

    expect(existsSync(filePath)).toBe(true)
    const reloaded = createNeuroProviderRegistryStore(filePath)
    expect(reloaded.list()).toEqual([profile])
    expect(reloaded.get('my-endpoint')?.name).toBe('My Endpoint')

    const raw: unknown = JSON.parse(readFileSync(filePath, 'utf8'))
    expect(raw).toMatchObject({ version: 1 })
  })

  it('replaces an existing id and removes by id', () => {
    const store = createNeuroProviderRegistryStore(filePath)
    const profile = sanitizeNeuroProviderProfile(validProfile)!
    store.upsert(profile)
    store.upsert({ ...profile, name: 'Renamed' })
    expect(store.list()).toHaveLength(1)
    expect(store.get('my-endpoint')?.name).toBe('Renamed')

    store.remove('my-endpoint')
    expect(store.list()).toEqual([])
    expect(createNeuroProviderRegistryStore(filePath).list()).toEqual([])
  })

  it('refuses invalid upserts without writing', () => {
    const store = createNeuroProviderRegistryStore(filePath)
    expect(() => store.upsert({ ...validProfile, id: 'not valid' } as never)).toThrow(/invalid/i)
    expect(existsSync(filePath)).toBe(false)
  })

  it('survives a corrupted file by starting over', () => {
    const store = createNeuroProviderRegistryStore(filePath)
    store.upsert(sanitizeNeuroProviderProfile(validProfile)!)
    const corrupted = createNeuroProviderRegistryStore(join(parent, 'corrupt.json'))
    expect(corrupted.list()).toEqual([])
  })
})

function fetchScript(
  respond: (
    url: string,
    init: { headers: Record<string, string>; body: string }
  ) => {
    status: number
    body: unknown
  }
): {
  fetchLike: NeuroProviderFetchLike
  calls: { url: string; init: Parameters<NeuroProviderFetchLike>[1] }[]
} {
  const calls: { url: string; init: Parameters<NeuroProviderFetchLike>[1] }[] = []
  return {
    calls,
    fetchLike: async (url, init) => {
      calls.push({ url, init })
      const outcome = respond(url, init)
      return {
        ok: outcome.status >= 200 && outcome.status < 300,
        status: outcome.status,
        text: async () =>
          typeof outcome.body === 'string' ? outcome.body : JSON.stringify(outcome.body)
      }
    }
  }
}

describe('testNeuroProviderConnection', () => {
  const profile = sanitizeNeuroProviderProfile(validProfile)!

  it('sends the key as a bearer token and reads the completion text', async () => {
    const script = fetchScript(() => ({
      status: 200,
      body: { choices: [{ message: { content: 'pong' } }] }
    }))
    const result = await testNeuroProviderConnection(profile, {
      fetchLike: script.fetchLike,
      readKey: () => 'sk-test'
    })
    expect(result.ok).toBe(true)
    expect(result.detail).toBe('pong')
    expect(result.latencyMs).toBeGreaterThanOrEqual(0)
    expect(script.calls[0]?.url).toBe('https://llm.example.com/v1/chat/completions')
    expect(script.calls[0]?.init.headers.authorization).toBe('Bearer sk-test')
    expect(JSON.parse(script.calls[0]?.init.body ?? '{}')).toMatchObject({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'ping' }]
    })
  })

  it('fails fast when a key is required but missing', async () => {
    const script = fetchScript(() => ({ status: 200, body: {} }))
    const result = await testNeuroProviderConnection(profile, {
      fetchLike: script.fetchLike,
      readKey: () => null
    })
    expect(result).toMatchObject({ ok: false, detail: expect.stringContaining('No API key') })
    expect(script.calls).toHaveLength(0)
  })

  it('applies header, query, and basic auth schemes', async () => {
    const headerProfile = sanitizeNeuroProviderProfile({
      ...validProfile,
      id: 'hdr',
      authScheme: 'header',
      authLocation: 'x-custom-key'
    })!
    const headerScript = fetchScript(() => ({ status: 200, body: { ok: true } }))
    await testNeuroProviderConnection(headerProfile, {
      fetchLike: headerScript.fetchLike,
      readKey: () => 'k1'
    })
    expect(headerScript.calls[0]?.init.headers['x-custom-key']).toBe('k1')

    const queryProfile = sanitizeNeuroProviderProfile({
      ...validProfile,
      id: 'qry',
      authScheme: 'query',
      authLocation: 'api-key'
    })!
    const queryScript = fetchScript(() => ({ status: 200, body: {} }))
    await testNeuroProviderConnection(queryProfile, {
      fetchLike: queryScript.fetchLike,
      readKey: () => 'k2'
    })
    expect(queryScript.calls[0]?.url).toContain('api-key=k2')

    const basicProfile = sanitizeNeuroProviderProfile({
      ...validProfile,
      id: 'bas',
      authScheme: 'basic'
    })!
    const basicScript = fetchScript(() => ({ status: 200, body: {} }))
    await testNeuroProviderConnection(basicProfile, {
      fetchLike: basicScript.fetchLike,
      readKey: () => 'user:pass'
    })
    expect(basicScript.calls[0]?.init.headers.authorization).toBe(
      `Basic ${Buffer.from('user:pass', 'utf8').toString('base64')}`
    )
  })

  it('uses request templates with placeholders and falls back when unusable', async () => {
    const templated = sanitizeNeuroProviderProfile({
      ...validProfile,
      id: 'tmpl',
      requestTemplate: '{"model":"{{model}}","input":"{{prompt}}"}',
      responsePath: 'output_text'
    })!
    const script = fetchScript(() => ({ status: 200, body: { output_text: 'hi' } }))
    const result = await testNeuroProviderConnection(templated, {
      fetchLike: script.fetchLike,
      readKey: () => 'k'
    })
    expect(result.ok).toBe(true)
    expect(JSON.parse(script.calls[0]?.init.body ?? '{}')).toEqual({
      model: 'gpt-4o',
      input: 'ping'
    })

    const broken = sanitizeNeuroProviderProfile({
      ...templated,
      requestTemplate: '{"model":"{{model}}"'
    })!
    const fallback = fetchScript(() => ({ status: 200, body: { output_text: 'hi' } }))
    await testNeuroProviderConnection(broken, { fetchLike: fallback.fetchLike, readKey: () => 'k' })
    expect(JSON.parse(fallback.calls[0]?.init.body ?? '{}')).toMatchObject({
      messages: expect.anything()
    })
  })

  it('reports HTTP errors, non-JSON payloads, and transport failures', async () => {
    const httpError = fetchScript(() => ({ status: 503, body: 'overloaded' }))
    expect(
      await testNeuroProviderConnection(profile, {
        fetchLike: httpError.fetchLike,
        readKey: () => 'k'
      })
    ).toMatchObject({ ok: false, detail: expect.stringContaining('HTTP 503') })

    const nonJson = fetchScript(() => ({ status: 200, body: '<html>' }))
    expect(
      await testNeuroProviderConnection(profile, {
        fetchLike: nonJson.fetchLike,
        readKey: () => 'k'
      })
    ).toMatchObject({ ok: false, detail: expect.stringContaining('non-JSON') })

    expect(
      await testNeuroProviderConnection(profile, {
        fetchLike: async () => {
          throw new Error('ECONNREFUSED')
        },
        readKey: () => 'k'
      })
    ).toMatchObject({ ok: false, detail: 'ECONNREFUSED' })
  })
})
