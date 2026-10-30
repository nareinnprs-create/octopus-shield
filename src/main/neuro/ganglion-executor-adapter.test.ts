import { describe, expect, it, vi } from 'vitest'
import type { GanglionSessionHost } from './ganglion-executor-adapter'
import {
  createGanglionSubagentExecutor,
  ganglionSessionId,
  mintAgentSessionOperationId
} from './ganglion-executor-adapter'

type WaitCall = { condition?: 'exit' | 'tui-idle'; timeoutMs?: number }

const fakeHost = (overrides: {
  create?: GanglionSessionHost['createAgentSession']
  wait?: (
    handle: string,
    options?: WaitCall & { signal?: AbortSignal }
  ) => Promise<{
    satisfied: boolean
    blockedReason?: string
  }>
  read?: GanglionSessionHost['readTerminal']
  close?: GanglionSessionHost['closeTerminal']
}): GanglionSessionHost => ({
  createAgentSession:
    overrides.create ??
    (async () => ({
      terminal: { handle: 'term_1', tabId: 'tab_1', worktreeId: 'wt-1', title: 't' },
      disposition: 'created' as const
    })),
  waitForTerminal: async (handle, options) =>
    overrides.wait
      ? overrides.wait(handle, options)
      : // Default: the initial idle probe sees a busy agent; the settle wait sees idle.
        options?.timeoutMs === 250
        ? { satisfied: false }
        : { satisfied: true },
  readTerminal: overrides.read ?? (async () => ({ tail: ['> done', 'summary: ok'] })),
  closeTerminal: overrides.close ?? (async () => ({ ptyKilled: true }))
})

const task = { id: 'task-1', title: 'Summarize auth', prompt: 'Summarize the auth module' }

const flushDeferredOnComplete = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('createGanglionSubagentExecutor', () => {
  it('spawns through terminal.createAgentSession and settles completed on tui-idle', async () => {
    const create = vi.fn(
      async (request: Parameters<GanglionSessionHost['createAgentSession']>[0]) => {
        expect(request.prompt).toBe(task.prompt)
        expect(request.promptDelivery).toBe('auto-submit')
        expect(request.presentation).toBe('background')
        expect(request.worktree).toBe('wt-9')
        expect(request.clientOperationId).toMatch(/^\d{13}-[0-9a-f]{32}$/)
        return {
          terminal: { handle: 'term_1', tabId: 'tab_1', worktreeId: 'wt-1', title: null },
          disposition: 'created' as const
        }
      }
    )
    const onComplete = vi.fn()
    const executor = createGanglionSubagentExecutor({
      host: fakeHost({ create: create as GanglionSessionHost['createAgentSession'] }),
      resolveWorktree: () => 'wt-9',
      agent: 'claude',
      onComplete
    })
    const execution = await executor('Forge', task)
    expect(execution).toEqual({
      sessionId: ganglionSessionId(task.id),
      status: 'completed',
      detail: '> done\nsummary: ok'
    })
    await flushDeferredOnComplete()
    expect(onComplete).toHaveBeenCalledWith(ganglionSessionId(task.id), {
      status: 'completed',
      detail: '> done\nsummary: ok'
    })
  })

  it('fails fail-visible when the agent never starts after an idle spawn', async () => {
    const onComplete = vi.fn()
    const executor = createGanglionSubagentExecutor({
      host: fakeHost({ wait: async () => ({ satisfied: true }) }),
      resolveWorktree: () => 'wt-1',
      agent: 'claude',
      onComplete,
      startDeadlineMs: 15,
      startPollMs: 1
    })
    const execution = await executor('Forge', task)
    expect(execution.status).toBe('failed')
    expect(execution.detail).toBe('agent never started after the prompt was submitted')
    await flushDeferredOnComplete()
    expect(onComplete).toHaveBeenCalledWith(ganglionSessionId(task.id), {
      status: 'failed',
      detail: 'agent never started after the prompt was submitted'
    })
  })

  it('reports blocked agents as failed with the blocked reason', async () => {
    const executor = createGanglionSubagentExecutor({
      host: fakeHost({
        wait: async (_handle, options) =>
          options?.timeoutMs === 250
            ? { satisfied: false }
            : { satisfied: false, blockedReason: 'agent-approval-prompt' }
      }),
      resolveWorktree: () => 'wt-1',
      agent: 'claude',
      onComplete: () => undefined
    })
    const execution = await executor('Forge', task)
    expect(execution.status).toBe('failed')
    expect(execution.detail).toBe('agent blocked: agent-approval-prompt')
  })

  it('settles stopped when the settlement watch is aborted', async () => {
    const executor = createGanglionSubagentExecutor({
      host: fakeHost({
        wait: async (_handle, options) => {
          if (options?.timeoutMs === 250) {
            return { satisfied: false }
          }
          if (options?.signal?.aborted) {
            throw new Error('Request was aborted')
          }
          throw new Error('timeout')
        }
      }),
      resolveWorktree: () => 'wt-1',
      agent: 'claude',
      onComplete: () => undefined,
      settlePollMs: 5
    })
    const pending = executor('Forge', task)
    // Let the run reach its settle loop, then stop it like the sessions panel does.
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(executor.stop(task.id)).toBe(true)
    const execution = await pending
    expect(execution.status).toBe('failed')
    expect(execution.detail).toBe('stopped by operator')
    expect(executor.stop(task.id)).toBe(false)
  })

  it('reports a closed terminal as failed instead of hanging', async () => {
    const executor = createGanglionSubagentExecutor({
      host: fakeHost({
        wait: async (_handle, options) => {
          if (options?.timeoutMs === 250) {
            return { satisfied: false }
          }
          throw new Error('unknown terminal handle')
        },
        read: async () => {
          throw new Error('handle gone')
        }
      }),
      resolveWorktree: () => 'wt-1',
      agent: 'claude',
      onComplete: () => undefined
    })
    const execution = await executor('Forge', task)
    expect(execution.status).toBe('failed')
    expect(execution.detail).toBe('agent session closed before completing')
  })

  it('defers onComplete until after the host registers the session', async () => {
    // Mirrors GanglionRuntime.delegate: the session map fills in a microtask on the executor promise.
    const sessions = new Map<string, string>()
    let onCompleteSawRegistration: boolean | null = null
    const executor = createGanglionSubagentExecutor({
      host: fakeHost({}),
      resolveWorktree: () => 'wt-1',
      agent: 'claude',
      onComplete: (sessionId) => {
        onCompleteSawRegistration = sessions.has(sessionId)
      }
    })
    const pending = executor('Forge', task).then((execution) => {
      sessions.set(execution.sessionId, task.id)
      return execution
    })
    await pending
    await flushDeferredOnComplete()
    expect(onCompleteSawRegistration).toBe(true)
  })

  it('mints host-authority operation ids', () => {
    expect(mintAgentSessionOperationId(() => 1_234)).toMatch(/^1234-[0-9a-f]{32}$/)
  })
})
