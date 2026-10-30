// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'

import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
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

const setActiveWorktree = vi.hoisted(() => vi.fn())

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string) => fallback
}))

vi.mock('@/store', () => ({
  useAppStore: (selector: (state: unknown) => unknown) =>
    selector({ activeWorktreeId: 'wt-1', setActiveWorktree })
}))

import NeuroSessionsPage from './NeuroSessionsPage'

const task = (overrides: Partial<NeuroSessionView> = {}): NeuroSessionView => ({
  taskId: 'task-1',
  tentacle: 'Forge',
  title: 'Summarize auth',
  state: 'running',
  terminalHandle: 'term_1',
  tabId: 'tab_1',
  worktreeId: 'wt-1',
  createdAtEpochMs: 1,
  updatedAtEpochMs: 1,
  ...overrides
})

const snapshot = (tasks: readonly NeuroSessionView[]): NeuroSessionsSnapshot => ({
  tasks,
  tentacles: ['Archivist', 'Forge', 'Verifier']
})

describe('NeuroSessionsPage', () => {
  beforeEach(() => {
    neuroMocks.list.mockResolvedValue(
      snapshot([
        task(),
        task({ taskId: 'task-2', title: 'Broken run', state: 'failed', detail: 'exit 1' }),
        task({
          taskId: 'task-3',
          title: 'Crashed run',
          state: 'interrupted'
        })
      ])
    )
    neuroMocks.spawn.mockReset()
    neuroMocks.stop.mockReset()
    neuroMocks.retry.mockReset()
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { neuroSessions: neuroMocks }
    })
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('lists live Tentacle sessions with status and workspace link', async () => {
    render(<NeuroSessionsPage />)

    const table = await screen.findByRole('table')
    expect(within(table).getByText('Summarize auth')).toBeInTheDocument()
    expect(within(table).getByText('Broken run')).toBeInTheDocument()
    const runningRow = within(
      screen.getByText('Summarize auth').closest('tr') as HTMLTableRowElement
    )
    expect(runningRow.getByText('running')).toBeInTheDocument()
    expect(runningRow.getByRole('button', { name: 'Stop' })).toBeInTheDocument()
    expect(runningRow.getByRole('button', { name: 'Open workspace' })).toBeInTheDocument()
    const failedRow = within(screen.getByText('Broken run').closest('tr') as HTMLTableRowElement)
    expect(failedRow.getByText('failed')).toBeInTheDocument()
    expect(failedRow.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
    const interruptedRow = within(
      screen.getByText('Crashed run').closest('tr') as HTMLTableRowElement
    )
    expect(interruptedRow.getByText('interrupted')).toBeInTheDocument()
  })

  it('stops a running session through the bridge', async () => {
    const user = userEvent.setup()
    neuroMocks.stop.mockResolvedValue(true)
    render(<NeuroSessionsPage />)

    await screen.findByRole('table')
    await user.click(screen.getByRole('button', { name: 'Stop' }))
    await waitFor(() => expect(neuroMocks.stop).toHaveBeenCalledWith('task-1'))
  })

  it('retries an interrupted session through the bridge', async () => {
    const user = userEvent.setup()
    neuroMocks.retry.mockResolvedValue({ ok: true, taskId: 'task-9' })
    render(<NeuroSessionsPage />)

    await screen.findByRole('table')
    const interruptedRow = within(
      screen.getByText('Crashed run').closest('tr') as HTMLTableRowElement
    )
    await user.click(interruptedRow.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(neuroMocks.retry).toHaveBeenCalledWith('task-3'))
  })

  it('delegates a new task into the active workspace', async () => {
    const user = userEvent.setup()
    neuroMocks.spawn.mockResolvedValue({ ok: true, taskId: 'task-8' })
    render(<NeuroSessionsPage />)

    await screen.findByRole('table')
    await user.type(screen.getByLabelText('Task'), 'Review diffs')
    await user.type(screen.getByLabelText('Prompt'), 'Review the pending diff')
    await user.click(screen.getByRole('button', { name: 'Delegate task' }))

    await waitFor(() =>
      expect(neuroMocks.spawn).toHaveBeenCalledWith({
        tentacle: 'Archivist',
        title: 'Review diffs',
        prompt: 'Review the pending diff',
        worktree: 'wt-1'
      })
    )
  })

  it('opens the session workspace on link click', async () => {
    const user = userEvent.setup()
    render(<NeuroSessionsPage />)

    await screen.findByRole('table')
    const runningRow = within(
      screen.getByText('Summarize auth').closest('tr') as HTMLTableRowElement
    )
    await user.click(runningRow.getByRole('button', { name: 'Open workspace' }))
    expect(setActiveWorktree).toHaveBeenCalledWith('wt-1')
  })
})
