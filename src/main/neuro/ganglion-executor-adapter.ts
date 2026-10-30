// Ganglion SubagentExecutor over the shell's real agent-session infra:
// terminal.createAgentSession spawns the PTY, waitForTerminal('tui-idle') settles the turn
// (same runtime idle detection the automations run observer uses).

import { randomBytes } from 'node:crypto'
import type {
  RuntimeAgentSessionRpcCaller,
  RuntimeCreateAgentSessionRequest,
  RuntimeCreateAgentSessionResult
} from '../../shared/agent-session-host-authority'
import type { TuiAgent } from '../../shared/tui-agent'
import type {
  SubagentExecution,
  SubagentExecutor,
  SubagentResult
} from '@shield/ganglion/ganglion-subagent'

/** Structural subset of ShieldRuntimeService the executor drives; structural fakes implement this in tests. */
export type GanglionSessionHost = {
  createAgentSession(
    request: RuntimeCreateAgentSessionRequest,
    caller?: RuntimeAgentSessionRpcCaller
  ): Promise<RuntimeCreateAgentSessionResult>
  waitForTerminal(
    handle: string,
    options?: { condition?: 'exit' | 'tui-idle'; timeoutMs?: number; signal?: AbortSignal }
  ): Promise<{ satisfied: boolean; blockedReason?: string }>
  readTerminal(handle: string, opts?: { limit?: number }): Promise<{ tail: string[] }>
  closeTerminal(terminal: string): Promise<unknown>
}

export type GanglionSessionAttached = {
  taskId: string
  sessionId: string
  terminalHandle: string
  tabId: string | null
  worktreeId: string
}

export type GanglionExecutorDeps = {
  host: GanglionSessionHost
  /** Spawn target per task (the shell runs each Tentacle session in a workspace). */
  resolveWorktree: (taskId: string) => string
  agent: TuiAgent
  /** Settles the graph; deferred past promise resolution so GanglionRuntime registers the session first. */
  onComplete: (sessionId: string, result: SubagentResult) => void
  onSessionAttached?: (attached: GanglionSessionAttached) => void
  now?: () => number
  mintOperationId?: () => string
  /** Idle right after spawn counts as "never started" past this deadline. */
  startDeadlineMs?: number
  /** Per-wait re-arm window; settlement keeps polling until the overall deadline. */
  settlePollMs?: number
  /** Overall watch budget (matches the automations observer's 6h). */
  settleDeadlineMs?: number
  /** Bound the busy-edge wait loop cadence. */
  startPollMs?: number
}

export type GanglionSubagentExecutor = SubagentExecutor & {
  /** Aborts the settlement watch for `taskId`; the run settles failed. */
  stop: (taskId: string) => boolean
}

export const GANGLION_SESSION_ID_PREFIX = 'ganglion:'

export const ganglionSessionId = (taskId: string): string =>
  `${GANGLION_SESSION_ID_PREFIX}${taskId}`

const DEFAULT_START_DEADLINE_MS = 2 * 60 * 1000
const DEFAULT_START_POLL_MS = 500
const DEFAULT_SETTLE_POLL_MS = 30 * 1000
const DEFAULT_SETTLE_DEADLINE_MS = 6 * 60 * 60 * 1000
const DETAIL_TAIL_LINES = 12

export const mintAgentSessionOperationId = (now = Date.now): string =>
  `${now()}-${randomBytes(16).toString('hex')}`

const isWaitTimeout = (error: unknown): boolean =>
  error instanceof Error && error.message === 'timeout'

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const REARM_DELAY_MS = 250

export function createGanglionSubagentExecutor(
  deps: GanglionExecutorDeps
): GanglionSubagentExecutor {
  const now = deps.now ?? Date.now
  const mintOperationId = deps.mintOperationId ?? (() => mintAgentSessionOperationId(now))
  const startDeadlineMs = deps.startDeadlineMs ?? DEFAULT_START_DEADLINE_MS
  const startPollMs = deps.startPollMs ?? DEFAULT_START_POLL_MS
  const settlePollMs = deps.settlePollMs ?? DEFAULT_SETTLE_POLL_MS
  const settleDeadlineMs = deps.settleDeadlineMs ?? DEFAULT_SETTLE_DEADLINE_MS
  const active = new Map<string, AbortController>()

  const readDetail = async (handle: string): Promise<string | undefined> => {
    try {
      const tail = (await deps.host.readTerminal(handle, { limit: 200 })).tail
      const lines = tail
        .map((line) => line.trimEnd())
        .filter((line) => line.trim().length > 0)
        .slice(-DETAIL_TAIL_LINES)
      return lines.length === 0 ? undefined : lines.join('\n')
    } catch {
      return undefined
    }
  }

  /** true/false/null: idle/busy/probe-unsupported. */
  const idleNow = async (handle: string, signal: AbortSignal): Promise<boolean | null> => {
    try {
      const wait = await deps.host.waitForTerminal(handle, {
        condition: 'tui-idle',
        timeoutMs: 250,
        signal
      })
      return wait.satisfied
    } catch (error) {
      return isWaitTimeout(error) || signal.aborted ? false : null
    }
  }

  const settleUntilIdle = async (handle: string, signal: AbortSignal): Promise<SubagentResult> => {
    // Require a busy edge before trusting idle: a fresh pane idles before the prompt lands.
    if ((await idleNow(handle, signal)) === true) {
      let started = false
      const startDeadline = now() + startDeadlineMs
      while (now() < startDeadline && !started) {
        if (signal.aborted) {
          return { status: 'failed', detail: 'stopped before the agent started' }
        }
        await new Promise((resolve) => setTimeout(resolve, startPollMs))
        started = (await idleNow(handle, signal)) === false
      }
      if (!started) {
        return { status: 'failed', detail: 'agent never started after the prompt was submitted' }
      }
    }
    const deadline = now() + settleDeadlineMs
    while (now() < deadline) {
      if (signal.aborted) {
        return { status: 'failed', detail: 'stopped by operator' }
      }
      try {
        const wait = await deps.host.waitForTerminal(handle, {
          condition: 'tui-idle',
          timeoutMs: settlePollMs,
          signal
        })
        if (wait.satisfied) {
          return { status: 'completed', ...(await detailOf(handle)) }
        }
        if (wait.blockedReason) {
          return { status: 'failed', detail: `agent blocked: ${wait.blockedReason}` }
        }
      } catch (error) {
        if (signal.aborted) {
          return { status: 'failed', detail: 'stopped by operator' }
        }
        if (!isWaitTimeout(error)) {
          return {
            status: 'failed',
            ...(await detailOf(handle)),
            ...(await closedDetail(handle, error))
          }
        }
        // Re-arm on the clock: an early-returning wait must not spin the event loop.
        await delay(REARM_DELAY_MS)
      }
    }
    return {
      status: 'failed',
      ...(await detailOf(handle)),
      detail: 'watch abandoned after 6h without a completion signal'
    }
  }

  const detailOf = async (handle: string): Promise<{ detail?: string } | {}> => {
    const detail = await readDetail(handle)
    return detail === undefined ? {} : { detail }
  }

  const closedDetail = async (
    handle: string,
    error: unknown
  ): Promise<{ detail?: string } | {}> => {
    try {
      await deps.host.readTerminal(handle, { limit: 1 })
      return error instanceof Error && error.message.length > 0 ? { detail: error.message } : {}
    } catch {
      return { detail: 'agent session closed before completing' }
    }
  }

  const execute: SubagentExecutor = async (_tentacle, task) => {
    const sessionId = ganglionSessionId(task.id)
    const abort = new AbortController()
    active.set(task.id, abort)
    let execution: SubagentExecution
    try {
      const { terminal } = await deps.host.createAgentSession({
        clientOperationId: mintOperationId(),
        worktree: deps.resolveWorktree(task.id),
        agent: deps.agent,
        prompt: task.prompt,
        promptDelivery: 'auto-submit',
        presentation: 'background'
      })
      deps.onSessionAttached?.({
        taskId: task.id,
        sessionId,
        terminalHandle: terminal.handle,
        tabId: terminal.tabId ?? null,
        worktreeId: terminal.worktreeId
      })
      execution = { sessionId, ...(await settleUntilIdle(terminal.handle, abort.signal)) }
    } finally {
      active.delete(task.id)
    }
    // GanglionRuntime registers the session in a microtask on this promise; settle the graph after.
    setTimeout(() => {
      try {
        deps.onComplete(execution.sessionId, {
          status: execution.status,
          ...(execution.detail === undefined ? {} : { detail: execution.detail })
        })
      } catch (error) {
        console.warn('[neuro] ganglion onComplete rejected', error)
      }
    }, 0)
    return execution
  }

  return Object.assign(execute, {
    stop: (taskId: string): boolean => {
      const controller = active.get(taskId)
      if (!controller) {
        return false
      }
      controller.abort(new Error('stopped by operator'))
      return true
    }
  })
}
