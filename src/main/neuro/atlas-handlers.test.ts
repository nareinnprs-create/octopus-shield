import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const handlers = vi.hoisted(
  () => new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
)

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (event: unknown, ...args: unknown[]) => unknown) => {
      handlers.set(channel, handler)
    })
  }
}))
vi.mock('../ipc/ui', () => ({ isTrustedUIRenderer: () => true }))

import type { NeuroAtlasQueryBackend } from './atlas-handlers'
import {
  UnavailableAtlasBackend,
  createAtlasBackendResolver,
  registerNeuroAtlasHandlers
} from './atlas-handlers'
import type { AtlasGraphSnapshot } from '../../shared/neuro-atlas-contract'

const invoke = async <T>(channel: string, ...args: unknown[]): Promise<T> =>
  handlers.get(channel)?.({}, ...args) as T

const backendWith = (overrides: Partial<NeuroAtlasQueryBackend> = {}): NeuroAtlasQueryBackend => ({
  semantic: async () => [{ id: 'auth.ts:verifyToken', kind: 'symbol', label: 'verifyToken', path: 'src/auth.ts', score: 0.91 }],
  symbol: async () => [],
  graph: async () => ({
    nodes: [{ id: 'src/auth.ts', kind: 'file', label: 'auth.ts', path: 'src/auth.ts' }],
    edges: [],
    generatedAtEpochMs: 1234
  }),
  status: async () => ({ available: true, state: 'idle', fileCount: 12 }),
  ...overrides
})

describe('AtlasQueryService IPC surface', () => {
  beforeEach(() => {
    handlers.clear()
    registerNeuroAtlasHandlers({ resolveBackend: () => Promise.resolve(backendWith()) })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('registers the four atlas channels', () => {
    for (const channel of [
      'neuro:atlas:semantic',
      'neuro:atlas:symbol',
      'neuro:atlas:graph',
      'neuro:atlas:status'
    ]) {
      expect(handlers.has(channel)).toBe(true)
    }
  })

  it('serves semantic, symbol, graph and status through the backend', async () => {
    const matches = await invoke<readonly unknown[]>('neuro:atlas:semantic', {
      text: 'where is auth handled'
    })
    expect(matches).toHaveLength(1)
    const graph = await invoke<AtlasGraphSnapshot>('neuro:atlas:graph', {})
    expect(graph.nodes.map((node) => node.id)).toContain('src/auth.ts')
    await expect(invoke('neuro:atlas:symbol', { name: 'verifyToken' })).resolves.toBeDefined()
    await expect(invoke('neuro:atlas:status')).resolves.toMatchObject({ state: 'idle' })
  })

  it('rejects malformed queries and scopes with a validation error', async () => {
    await expect(invoke('neuro:atlas:semantic', { text: '   ' })).rejects.toThrow('Query is empty')
    await expect(invoke('neuro:atlas:semantic', { text: 'x', limit: 9999 })).rejects.toThrow()
    await expect(invoke('neuro:atlas:symbol', { name: '' })).rejects.toThrow()
    await expect(invoke('neuro:atlas:graph', { limit: 50_000 })).rejects.toThrow()
  })

  it('answers empty with an unavailable status when @shield/neuro is absent', async () => {
    registerNeuroAtlasHandlers()
    const graph = await invoke<AtlasGraphSnapshot>('neuro:atlas:graph', {})
    expect(graph.nodes).toEqual([])
    await expect(invoke('neuro:atlas:status')).resolves.toMatchObject({
      available: false,
      state: 'unavailable'
    })
  })

  it('resolves the structural query surface from a @shield/neuro-like module', async () => {
    const backend = await createAtlasBackendResolver()()
    expect(backend).toBeInstanceOf(UnavailableAtlasBackend)
  })
})
