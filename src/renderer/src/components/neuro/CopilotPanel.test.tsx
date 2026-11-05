// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  NeuroSessionView,
  NeuroSessionsSnapshot
} from '../../../../shared/neuro-sessions-contract'

const neuroMocks = vi.hoisted(() => ({
  list: vi.fn(),
  spawn: vi.fn(),
  stop: vi.fn(),
  retry: vi.fn()
}))

const providerMocks = vi.hoisted(() => ({
  getStatus: vi.fn()
}))

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string) => fallback
}))

vi.mock('@/store', () => ({
  useAppStore: (selector: (state: unknown) => unknown) => selector({ activeWorktreeId: 'wt-1' })
}))

import CopilotPanel from './CopilotPanel'

const task = (overrides: Partial<NeuroSessionView> = {}): NeuroSessionView => ({
  taskId: 'task-9',
  tentacle: 'Forge',
  title: 'Add logout',
  state: 'running',
  worktreeId: 'wt-1',
  createdAtEpochMs: 1,
  updatedAtEpochMs: 1,
  ...overrides
})

const snapshot = (tasks: readonly NeuroSessionView[]): NeuroSessionsSnapshot => ({
  tasks,
  tentacles: ['Archivist', 'Forge', 'Verifier']
})

describe('CopilotPanel', () => {
  beforeEach(() => {
    neuroMocks.list.mockResolvedValue(snapshot([]))
    neuroMocks.spawn.mockReset()
    providerMocks.getStatus.mockResolvedValue({
      profiles: [{ id: 'ollama', name: 'Ollama (local)', models: ['qwen3-coder'] }]
    })
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { neuroSessions: neuroMocks, neuroProviders: providerMocks }
    })
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('renders the 7 built-in persona tiles plus the Custom tile', async () => {
    render(<CopilotPanel />)
    for (const persona of [
      'Archivist',
      'Forge',
      'Sentinel',
      'Prism',
      'Inkwell',
      'Scaffold',
      'Verifier'
    ]) {
      expect(await screen.findByRole('button', { name: new RegExp(persona) })).toBeInTheDocument()
    }
    expect(screen.getByRole('button', { name: /Custom/ })).toBeInTheDocument()
    expect(screen.getAllByText('read-only · atlas').length).toBeGreaterThan(0)
  })

  it('delegates to the selected persona with the composed prompt (no raw LLM call)', async () => {
    const user = userEvent.setup()
    neuroMocks.spawn.mockResolvedValue({ ok: true, taskId: 'task-9' })
    render(<CopilotPanel />)

    await screen.findByRole('button', { name: /Forge/ })
    await user.click(screen.getByRole('button', { name: /Forge/ }))
    await user.type(screen.getByLabelText('Task'), 'Add logout')
    await user.type(screen.getByLabelText('Prompt'), 'Implement the logout button')
    await user.click(screen.getByRole('button', { name: 'Delegate to copilot' }))

    await waitFor(() => expect(neuroMocks.spawn).toHaveBeenCalledTimes(1))
    const request = neuroMocks.spawn.mock.calls[0]?.[0] as { tentacle: string; prompt: string }
    expect(request.tentacle).toBe('Forge')
    expect(request.prompt).toContain('Implement the logout button')
    expect(request.prompt.length).toBeGreaterThan('Implement the logout button'.length)
  })

  it('shows live session status for spawned copilot runs', async () => {
    neuroMocks.spawn.mockResolvedValue({ ok: true, taskId: 'task-9' })
    const user = userEvent.setup()
    render(<CopilotPanel />)

    await screen.findByRole('button', { name: /Archivist/ })
    await user.type(screen.getByLabelText('Task'), 'Add logout')
    await user.type(screen.getByLabelText('Prompt'), 'Implement the logout button')
    await user.click(screen.getByRole('button', { name: 'Delegate to copilot' }))

    await screen.findByText('queued')
    neuroMocks.list.mockResolvedValue(
      snapshot([task({ detail: 'npm test\nall green', state: 'completed' })])
    )
    await waitFor(() => expect(screen.getByText('completed')).toBeInTheDocument(), {
      timeout: 4000
    })
    expect(screen.getByText(/all green/)).toBeInTheDocument()
  })

  it('surfaces spawn rejections from the bridge', async () => {
    const user = userEvent.setup()
    neuroMocks.spawn.mockResolvedValue({ ok: false, reason: 'Unknown Tentacle: Nope' })
    render(<CopilotPanel />)

    await screen.findByRole('button', { name: /Archivist/ })
    await user.type(screen.getByLabelText('Task'), 'Add logout')
    await user.type(screen.getByLabelText('Prompt'), 'Implement the logout button')
    await user.click(screen.getByRole('button', { name: 'Delegate to copilot' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Unknown Tentacle: Nope')
  })

  it('registers a validated custom persona and targets its Tentacle', async () => {
    const user = userEvent.setup()
    neuroMocks.spawn.mockResolvedValue({ ok: true, taskId: 'task-10' })
    render(<CopilotPanel />)

    await user.click(await screen.findByRole('button', { name: /Custom/ }))
    await user.type(screen.getByLabelText('ID'), 'scout')
    await user.type(screen.getByLabelText('Persona'), 'Scout')
    await user.type(screen.getByLabelText('System prompt'), 'You are Scout. Map the repo.')
    await user.click(screen.getByLabelText('Tentacle'))
    await user.click(await screen.findByRole('option', { name: 'Archivist' }))
    await user.click(screen.getByRole('button', { name: 'Register copilot' }))

    expect(await screen.findByRole('button', { name: /Scout/ })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Scout/ }))
    await user.type(screen.getByLabelText('Task'), 'Map the repo')
    await user.type(screen.getByLabelText('Prompt'), 'List the top-level modules')
    await user.click(screen.getByRole('button', { name: 'Delegate to copilot' }))

    await waitFor(() => expect(neuroMocks.spawn).toHaveBeenCalledTimes(1))
    const request = neuroMocks.spawn.mock.calls[0]?.[0] as { tentacle: string }
    expect(request.tentacle).toBe('Archivist')
  })

  it('rejects a custom persona with an invalid slug', async () => {
    const user = userEvent.setup()
    render(<CopilotPanel />)

    await user.click(await screen.findByRole('button', { name: /Custom/ }))
    await user.type(screen.getByLabelText('ID'), 'Bad Id')
    await user.type(screen.getByLabelText('Persona'), 'Scout')
    await user.type(screen.getByLabelText('System prompt'), 'You are Scout.')
    await user.click(screen.getByRole('button', { name: 'Register copilot' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/slug/i)
  })

  it('offers model overrides from the provider registry', async () => {
    const user = userEvent.setup()
    render(<CopilotPanel />)

    await screen.findByRole('button', { name: /Archivist/ })
    await user.click(screen.getByLabelText('Model override'))
    expect(await screen.findByText('ollama/qwen3-coder')).toBeInTheDocument()
  })
})
