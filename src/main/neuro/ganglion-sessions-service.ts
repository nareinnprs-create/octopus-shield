// Neuro sessions: composes the Ganglion runtime over the real agent-session executor,
// persists the task ledger for restart-resume, and serves the renderer sessions panel.

import { randomBytes } from 'node:crypto'
import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import {
  GanglionRuntime,
  isKnownTentacleName,
  seedDefaultGanglionRegistry,
  TENTACLE_NAMES,
  type GanglionRuntimeEventSink,
  type TentacleName
} from '@shield/ganglion'
import { NeuroSessionSpawnRequestSchema } from '../../shared/neuro-sessions-contract'
import type {
  NeuroSessionSpawnOutcome,
  NeuroSessionsSnapshot
} from '../../shared/neuro-sessions-contract'
import type { TuiAgent } from '../../shared/tui-agent'
import { isTrustedUIRenderer } from '../ipc/ui'
import type { GanglionSessionHost } from './ganglion-executor-adapter'
import { createGanglionSubagentExecutor } from './ganglion-executor-adapter'
import { GanglionTaskStore } from './ganglion-task-store'

// The runtime queues per Tentacle; 16 is the practical "unlimited" ceiling per team.
const CONCURRENCY_CEILING_PER_TENTACLE = 16

const ledgerFileIn = (dataDirectory: string): string => `${dataDirectory}/neuro/ganglion-tasks.json`

export type GanglionSessionsServiceDeps = {
  /** ShieldRuntimeService structural subset: real spawn + idle detection + stop. */
  host: GanglionSessionHost
  dataDirectory: string
  /** Agent preset every Tentacle session launches as. */
  agent?: TuiAgent
  /** Settlement-watch tuning (tests shrink these; production uses executor defaults). */
  startDeadlineMs?: number
  startPollMs?: number
  settlePollMs?: number
  settleDeadlineMs?: number
  now?: () => number
  mintTaskId?: () => string
}

export class GanglionSessionsService {
  readonly runtime: GanglionRuntime
  private readonly store: GanglionTaskStore
  private readonly executor: ReturnType<typeof createGanglionSubagentExecutor>
  private readonly worktreeByTask = new Map<string, string>()

  constructor(private readonly deps: GanglionSessionsServiceDeps) {
    const now = deps.now ?? Date.now
    this.store = new GanglionTaskStore(ledgerFileIn(deps.dataDirectory), now)
    this.executor = createGanglionSubagentExecutor({
      host: deps.host,
      resolveWorktree: (taskId) => this.worktreeByTask.get(taskId) ?? '',
      agent: deps.agent ?? 'claude',
      onComplete: (sessionId, result) => {
        this.runtime.onComplete(sessionId, result)
      },
      onSessionAttached: ({ taskId, sessionId, terminalHandle, tabId, worktreeId }) => {
        this.worktreeByTask.set(taskId, worktreeId)
        void this.store.patch(taskId, {
          sessionId,
          terminalHandle,
          ...(tabId === null ? {} : { tabId }),
          worktreeId,
          state: 'running'
        })
      },
      ...(deps.startDeadlineMs === undefined ? {} : { startDeadlineMs: deps.startDeadlineMs }),
      ...(deps.startPollMs === undefined ? {} : { startPollMs: deps.startPollMs }),
      ...(deps.settlePollMs === undefined ? {} : { settlePollMs: deps.settlePollMs }),
      ...(deps.settleDeadlineMs === undefined ? {} : { settleDeadlineMs: deps.settleDeadlineMs }),
      now
    })
    this.runtime = new GanglionRuntime({
      registry: seedDefaultGanglionRegistry(),
      executor: this.executor,
      events: {
        publish: (_type, event) => {
          if ('status' in event) {
            void this.store.patch(event.taskId, {
              state: event.status,
              ...(event.detail === undefined ? {} : { detail: event.detail })
            })
          }
        }
      } satisfies GanglionRuntimeEventSink,
      concurrency: Object.fromEntries(
        TENTACLE_NAMES.map((name) => [name, CONCURRENCY_CEILING_PER_TENTACLE])
      ),
      nowEpochMs: now
    })
  }

  /** Boot-time restart-resume: mid-flight tasks become interrupted and the UI offers retry. */
  async resumeInterrupted(): Promise<void> {
    await this.store.load()
  }

  spawn(rawRequest: unknown): NeuroSessionSpawnOutcome {
    const request = NeuroSessionSpawnRequestSchema.safeParse(rawRequest)
    if (!request.success) {
      return { ok: false, reason: request.error.issues[0]?.message ?? 'Invalid spawn request' }
    }
    const { tentacle, title, prompt, worktree } = request.data
    if (!isKnownTentacleName(tentacle)) {
      return { ok: false, reason: `Unknown Tentacle: ${tentacle}` }
    }
    const taskId = this.deps.mintTaskId?.() ?? `task-${randomBytes(8).toString('hex')}`
    this.worktreeByTask.set(taskId, worktree)
    const at = (this.deps.now ?? Date.now)()
    void this.store.append({
      taskId,
      tentacle,
      title,
      prompt,
      state: 'queued',
      worktreeId: worktree,
      createdAtEpochMs: at,
      updatedAtEpochMs: at
    })
    this.runtime.spawn(tentacle as TentacleName, { id: taskId, title, prompt })
    return { ok: true, taskId }
  }

  /** Aborts the settlement watch and closes the session terminal; the run settles failed. */
  async stop(taskId: string): Promise<boolean> {
    const record = this.store.find(taskId)
    if (!record || record.state !== 'running') {
      return false
    }
    if (record.terminalHandle !== undefined) {
      await this.deps.host.closeTerminal(record.terminalHandle).catch(() => undefined)
    }
    return this.executor.stop(taskId)
  }

  retry(taskId: string): NeuroSessionSpawnOutcome {
    const record = this.store.find(taskId)
    if (!record) {
      return { ok: false, reason: `Unknown task: ${taskId}` }
    }
    if (record.state === 'queued' || record.state === 'running') {
      return { ok: false, reason: 'Task is still live; stop it before retrying.' }
    }
    if (record.worktreeId === undefined) {
      return { ok: false, reason: 'The task workspace is no longer known.' }
    }
    return this.spawn({
      tentacle: record.tentacle,
      title: record.title,
      prompt: record.prompt,
      worktree: record.worktreeId
    })
  }

  snapshot(): NeuroSessionsSnapshot {
    return {
      tasks: this.store.all().map(({ prompt: _prompt, ...view }) => view),
      tentacles: [...TENTACLE_NAMES]
    }
  }
}

export type NeuroSessionHandlerDeps = Omit<GanglionSessionsServiceDeps, 'host'> & {
  /** ShieldRuntimeService; structural subset GanglionSessionHost drives it. */
  runtime: GanglionSessionHost
  service?: GanglionSessionsService
}

export function registerNeuroSessionHandlers(deps: NeuroSessionHandlerDeps): void {
  const { runtime, ...rest } = deps
  const service = deps.service ?? new GanglionSessionsService({ ...rest, host: runtime })
  void service.resumeInterrupted()
  const handleTrusted = <A extends unknown[]>(
    channel: string,
    listener: (event: IpcMainInvokeEvent, ...args: A) => unknown
  ): void => {
    ipcMain.handle(channel, (event, ...args: A) => {
      if (!isTrustedUIRenderer(event.sender)) {
        throw new Error('Unauthorized neuro IPC sender')
      }
      return listener(event, ...args)
    })
  }
  handleTrusted('neuro:sessions:list', () => service.snapshot())
  handleTrusted('neuro:sessions:spawn', (_event, request: unknown) => service.spawn(request))
  handleTrusted('neuro:sessions:stop', (_event, taskId: string) => service.stop(taskId))
  handleTrusted('neuro:sessions:retry', (_event, taskId: string) => service.retry(taskId))
}
