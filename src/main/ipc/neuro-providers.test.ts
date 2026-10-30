import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  NeuroConnectionTestResult,
  NeuroProviderStatus
} from '../../shared/neuro-provider-types'

const ipcState = vi.hoisted(() => ({
  handleHandlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
}))

vi.mock('electron', () => ({
  app: { getPath: () => tmpRoot },
  ipcMain: {
    handle: (channel: string, handler: (event: unknown, ...args: unknown[]) => unknown) => {
      ipcState.handleHandlers.set(channel, handler)
    }
  }
}))

const keyStoreState = vi.hoisted(() => ({
  save: vi.fn(),
  clear: vi.fn(),
  has: vi.fn(() => false),
  read: vi.fn((): string | null => null),
  protection: vi.fn((): 'sealed' | 'plaintext' | null => 'sealed')
}))

vi.mock('../neuro/neuro-provider-key-store', () => ({
  getNeuroProviderKeyStore: () => keyStoreState
}))

import {
  registerNeuroProviderHandlers,
  resetNeuroProviderRegistryForTest,
  setNeuroProviderRegistryFilePathForTest
} from './neuro-providers'

let tmpRoot = ''

async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  const handler = ipcState.handleHandlers.get(channel)
  if (!handler) {
    throw new Error(`No handler registered for ${channel}`)
  }
  return (await handler({}, ...args)) as T
}

const profile = {
  id: 'test-endpoint',
  name: 'Test Endpoint',
  kind: 'cloud',
  baseUrl: 'https://llm.example.com',
  chatPath: '/v1/chat/completions',
  authScheme: 'bearer',
  authLocation: null,
  authRef: null,
  models: ['gpt-4o'],
  responsePath: null,
  requestTemplate: null
}

describe('registerNeuroProviderHandlers', () => {
  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'neuro-ipc-'))
    ipcState.handleHandlers.clear()
    keyStoreState.save.mockReset()
    keyStoreState.clear.mockReset()
    keyStoreState.has.mockReset().mockReturnValue(false)
    keyStoreState.read.mockReset().mockReturnValue(null)
    keyStoreState.protection.mockReset().mockReturnValue('sealed')
    resetNeuroProviderRegistryForTest()
    setNeuroProviderRegistryFilePathForTest(join(tmpRoot, 'neuro-providers.json'))
    registerNeuroProviderHandlers()
  })

  afterEach(() => {
    resetNeuroProviderRegistryForTest()
    rmSync(tmpRoot, { recursive: true, force: true })
  })

  it('registers the six neuroProviders channels', () => {
    for (const channel of [
      'neuroProviders:list',
      'neuroProviders:save',
      'neuroProviders:remove',
      'neuroProviders:saveApiKey',
      'neuroProviders:clearApiKey',
      'neuroProviders:test'
    ]) {
      expect(ipcState.handleHandlers.has(channel)).toBe(true)
    }
  })

  it('saves a profile, derives the vault authRef, and lists key state', async () => {
    const status = await invoke<NeuroProviderStatus>('neuroProviders:save', profile)
    expect(status.profiles).toHaveLength(1)
    expect(status.profiles[0]).toMatchObject({
      id: 'test-endpoint',
      authRef: 'neuro-test-endpoint'
    })
    expect(status.keyConfigured).toEqual({ 'test-endpoint': false })
    expect(status.keyProtection).toEqual({ 'test-endpoint': null })
  })

  it('stores and clears keys for saved profiles only', async () => {
    await expect(invoke('neuroProviders:saveApiKey', 'ghost', 'sk-x')).rejects.toThrow(/not found/)
    await invoke('neuroProviders:save', profile)
    await invoke('neuroProviders:saveApiKey', 'test-endpoint', '  sk-secret  ')
    expect(keyStoreState.save).toHaveBeenCalledWith('  sk-secret  ')
    await invoke('neuroProviders:clearApiKey', 'test-endpoint')
    expect(keyStoreState.clear).toHaveBeenCalled()
  })

  it('removes a profile together with its key envelope', async () => {
    await invoke('neuroProviders:save', profile)
    await invoke('neuroProviders:remove', 'test-endpoint')
    const status = await invoke<{ profiles: unknown[] }>('neuroProviders:list')
    expect(status.profiles).toEqual([])
    expect(keyStoreState.clear).toHaveBeenCalled()
  })

  it('tests a draft with a provided key without persisting either', async () => {
    const calls: { url: string; init: RequestInit }[] = []
    const fakeFetch = (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      calls.push({ url: String(url), init: init ?? {} })
      return Promise.resolve(
        new Response(JSON.stringify({ choices: [{ message: { content: 'pong' } }] }), {
          status: 200
        })
      )
    }
    vi.spyOn(globalThis, 'fetch').mockImplementation(fakeFetch)
    try {
      const result = await invoke<NeuroConnectionTestResult>('neuroProviders:test', {
        profile,
        key: 'sk-draft'
      })
      expect(result).toMatchObject({ ok: true, detail: 'pong' })
      expect(keyStoreState.read).not.toHaveBeenCalled()
      expect(keyStoreState.save).not.toHaveBeenCalled()
      expect(calls[0]?.url).toBe('https://llm.example.com/v1/chat/completions')
      const headers = calls[0]?.init.headers as Record<string, string>
      expect(headers.authorization).toBe('Bearer sk-draft')
    } finally {
      vi.restoreAllMocks()
    }
  })

  it('rejects invalid profile payloads', async () => {
    await expect(invoke('neuroProviders:save', { id: 'nope space' })).rejects.toThrow(/invalid/)
    await expect(invoke('neuroProviders:saveApiKey', 'x', '')).rejects.toThrow(/non-empty/)
  })
})
