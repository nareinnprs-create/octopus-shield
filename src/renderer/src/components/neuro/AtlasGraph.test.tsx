// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  AtlasGraphSnapshot,
  AtlasSemanticMatch,
  AtlasStatus
} from '../../../../shared/neuro-atlas-contract'

const atlasMocks = vi.hoisted(() => ({
  semantic: vi.fn(),
  symbol: vi.fn(),
  graph: vi.fn(),
  status: vi.fn()
}))

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string) => fallback
}))

import AtlasGraph from './AtlasGraph'

const graphWith = (overrides: Partial<AtlasGraphSnapshot> = {}): AtlasGraphSnapshot => ({
  nodes: [
    { id: 'src/auth.ts', kind: 'file', label: 'auth.ts', path: 'src/auth.ts' },
    { id: 'src/auth.ts:verifyToken', kind: 'symbol', label: 'verifyToken', path: 'src/auth.ts' }
  ],
  edges: [
    { source: 'src/auth.ts', target: 'src/auth.ts:verifyToken', kind: 'imports', strength: 0.9 }
  ],
  generatedAtEpochMs: 42,
  ...overrides
})

const match = (overrides: Partial<AtlasSemanticMatch> = {}): AtlasSemanticMatch => ({
  id: 'src/auth.ts',
  kind: 'file',
  label: 'auth.ts',
  path: 'src/auth.ts',
  score: 0.93,
  ...overrides
})

const status: AtlasStatus = { available: true, state: 'idle', fileCount: 7 }

describe('AtlasGraph', () => {
  beforeEach(() => {
    atlasMocks.graph.mockReset()
    atlasMocks.semantic.mockReset()
    atlasMocks.symbol.mockReset()
    atlasMocks.status.mockReset()
    atlasMocks.status.mockResolvedValue(status)
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { neuroAtlas: atlasMocks }
    })
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('shows the loading state while the first graph poll is in flight', () => {
    atlasMocks.graph.mockReturnValue(new Promise(() => undefined))
    render(<AtlasGraph />)
    expect(screen.getByTestId('atlas-loading')).toBeInTheDocument()
  })

  it('shows the empty state when the atlas has no nodes', async () => {
    atlasMocks.graph.mockResolvedValue(graphWith({ nodes: [], edges: [] }))
    render(<AtlasGraph />)
    expect(await screen.findByTestId('atlas-empty')).toBeInTheDocument()
  })

  it('renders the graph data and serves semantic search with node focus', async () => {
    const user = userEvent.setup()
    atlasMocks.graph.mockResolvedValue(graphWith())
    atlasMocks.semantic.mockResolvedValue([match()])
    render(<AtlasGraph />)

    await waitFor(() => expect(screen.queryByTestId('atlas-loading')).not.toBeInTheDocument())
    expect(screen.getByTestId('atlas-status')).toHaveTextContent('idle')

    await user.type(
      screen.getByLabelText('Semantic search'),
      'where is auth handled'
    )
    await user.click(screen.getByRole('button', { name: 'Search' }))
    expect(atlasMocks.semantic).toHaveBeenCalledWith({ text: 'where is auth handled', limit: 20 })

    const results = await screen.findByRole('button', { name: /auth\.ts/ })
    await user.click(results)
    const detail = await screen.findByTestId('atlas-detail')
    expect(detail).toHaveTextContent('auth.ts')
    expect(detail).toHaveTextContent('file')
    expect(detail).toHaveTextContent('links: 1')
  })

  it('surfaces a semantic search failure without killing the panel', async () => {
    const user = userEvent.setup()
    atlasMocks.graph.mockResolvedValue(graphWith())
    atlasMocks.semantic.mockRejectedValue(new Error('indexer offline'))
    render(<AtlasGraph />)

    await waitFor(() => expect(screen.queryByTestId('atlas-loading')).not.toBeInTheDocument())
    await user.type(screen.getByLabelText('Semantic search'), 'auth')
    await user.click(screen.getByRole('button', { name: 'Search' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('indexer offline')
  })
})
