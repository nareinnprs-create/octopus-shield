import {
  attachNodeToTentacle,
  ganglionNodeIdsForTentacle,
  ganglionTentaclesByName,
  linkRegistryNodes,
  type GanglionRegistry
} from './ganglion-registry'
import type { GanglionEdge, GanglionNodeId, TentacleName } from './tentacle'
import type {
  SubagentExecution,
  SubagentExecutor,
  SubagentResult,
  SubagentTask
} from './ganglion-subagent'
import type { GanglionRuntimeEventSink } from './ganglion-runtime-events'
import { ganglionRuntimeAuditEvent, type GanglionRuntimeAuditEvent } from './ganglion-runtime-audit'
import type { GanglionRuntimeSnapshot, GanglionTaskRecord } from './ganglion-task-record'
import { ganglionTaskCountersByTentacle } from './ganglion-task-record'

/**
 * Head orchestrator ("The Octopus") supervising Tentacle sub-agents. Graph
 * bookkeeping stays pure (GanglionRegistry); execution delegates through the
 * injected SubagentExecutor seam (see ./ganglion-subagent) — no process is ever
 * spawned here.
 */

export type GanglionRuntimeOptions = {
  registry: GanglionRegistry
  executor: SubagentExecutor
  events?: GanglionRuntimeEventSink
  /** Concurrently running tasks allowed per Tentacle name; default 1. */
  concurrency?: Partial<Record<TentacleName, number>>
  nowEpochMs?: () => number
}

export type GanglionSpawnResult = {
  record: GanglionTaskRecord
  audit: GanglionRuntimeAuditEvent
  queued: boolean
  queueDepth: number
}

export type GanglionCompletionResult = {
  record: GanglionTaskRecord
  /** null when the session was already settled (idempotent replay). */
  audit: GanglionRuntimeAuditEvent | null
}

const DEFAULT_CONCURRENCY = 1

export class GanglionRuntime {
  private currentRegistry: GanglionRegistry
  private readonly tasks = new Map<string, GanglionTaskRecord>()
  private readonly sessions = new Map<string, string>()
  private readonly queues = new Map<string, string[]>()
  /** Spawn-time task intents, retained so a queued task can be delegated when its slot frees. */
  private readonly reserved = new Map<string, SubagentTask>()
  private readonly auditLog: GanglionRuntimeAuditEvent[] = []
  private readonly executor: SubagentExecutor
  private readonly events: GanglionRuntimeEventSink | undefined
  private readonly concurrency: Partial<Record<TentacleName, number>>
  private readonly nowEpochMs: () => number

  constructor(options: GanglionRuntimeOptions) {
    this.currentRegistry = options.registry
    this.executor = options.executor
    this.events = options.events
    this.concurrency = options.concurrency ?? {}
    for (const cap of Object.values(this.concurrency)) {
      if (cap !== undefined && (!Number.isSafeInteger(cap) || cap < 1)) {
        throw new RangeError(`Ganglion concurrency cap must be a positive integer: ${String(cap)}`)
      }
    }
    this.nowEpochMs = options.nowEpochMs ?? Date.now
  }

  /** Live registry view; every spawn attaches its reserved task node. */
  get registry(): GanglionRegistry {
    return this.currentRegistry
  }

  auditLogEntries(): readonly GanglionRuntimeAuditEvent[] {
    return this.auditLog
  }

  snapshot(): GanglionRuntimeSnapshot {
    const counters = ganglionTaskCountersByTentacle([...this.tasks.values()])
    return {
      registry: this.currentRegistry,
      tasks: [...this.tasks.values()],
      ...counters,
      audit: this.auditLog
    }
  }

  /**
   * Reserves a task node + delegation edge in the graph, then delegates unless the
   * Tentacle's concurrency cap is full (overflow queues and emits ganglion.task.queued).
   */
  spawn(tentacle: TentacleName, task: SubagentTask): GanglionSpawnResult {
    const instance = ganglionTentaclesByName(this.currentRegistry, tentacle)[0]
    if (!instance) {
      throw new RangeError(`Ganglion spawn requires a registered Tentacle: ${tentacle}`)
    }
    if (this.tasks.has(task.id)) {
      throw new RangeError(`Ganglion task id already reserved: ${task.id}`)
    }
    const primaryNode = ganglionNodeIdsForTentacle(this.currentRegistry, instance.id)[0]
    if (!primaryNode) {
      throw new RangeError(`Ganglion spawn requires a Tentacle node: ${instance.id}`)
    }
    const nodeId: GanglionNodeId = `ganglion:task:${task.id}`
    const edge: GanglionEdge = { source: primaryNode, target: nodeId, kind: 'delegates' }
    let registry = attachNodeToTentacle(this.currentRegistry, instance.id, {
      id: nodeId,
      tentacle,
      label: task.title
    })
    registry = linkRegistryNodes(registry, edge)
    this.currentRegistry = registry
    this.reserved.set(task.id, task)

    const at = this.nowEpochMs()
    const queued = this.runningCount(tentacle) >= this.capFor(tentacle)
    const record: GanglionTaskRecord = {
      taskId: task.id,
      tentacle,
      title: task.title,
      nodeId,
      edge,
      state: queued ? 'queued' : 'running',
      createdAtEpochMs: at,
      ...(queued ? {} : { startedAtEpochMs: at }),
      audited: true
    }
    this.tasks.set(task.id, record)

    if (queued) {
      const queue = this.queues.get(tentacle) ?? []
      queue.push(task.id)
      this.queues.set(tentacle, queue)
      const audit = this.recordTransition('ganglion.task.queued', record, at, {
        tentacle,
        taskId: task.id,
        title: task.title,
        queueDepth: queue.length
      })
      this.events?.publish('ganglion.task.queued', {
        tentacle,
        taskId: task.id,
        title: task.title,
        queueDepth: queue.length
      })
      return { record, audit, queued: true, queueDepth: queue.length }
    }

    const audit = this.recordTransition('ganglion.task.spawned', record, at, {
      tentacle,
      taskId: task.id,
      title: task.title,
      nodeId
    })
    this.events?.publish('ganglion.tentacle.spawned', {
      tentacle,
      taskId: task.id,
      title: task.title,
      nodeId
    })
    this.delegate(task)
    return { record, audit, queued: false, queueDepth: 0 }
  }

  /**
   * Settles the session: records the delegation edge's completion state, emits
   * ganglion.task.completed, frees the Tentacle slot, and drains its queue.
   * Idempotent: replaying a settled session returns its record without new events.
   */
  onComplete(sessionId: string, result: SubagentResult): GanglionCompletionResult {
    const taskId = this.sessions.get(sessionId)
    if (taskId === undefined) {
      throw new RangeError(`Ganglion onComplete requires a registered session: ${sessionId}`)
    }
    const record = this.tasks.get(taskId)
    if (record === undefined) {
      throw new RangeError(`Ganglion session has no task record: ${sessionId}`)
    }
    if (record.state === 'completed' || record.state === 'failed') {
      return { record, audit: null }
    }
    return this.settle(record, sessionId, result, this.nowEpochMs())
  }

  private delegate(task: SubagentTask): void {
    this.executor(this.taskTentacle(task.id), task).then(
      (execution) => this.registerSession(task.id, execution),
      (error: unknown) => {
        // Delegation itself failed (executor threw): the slot must free, fail-visible.
        const record = this.tasks.get(task.id)
        if (!record || record.state === 'completed' || record.state === 'failed') {
          return
        }
        const detail = error instanceof Error ? error.message : String(error)
        this.settle(
          record,
          null,
          { status: 'failed', detail: `executor rejected: ${detail}` },
          this.nowEpochMs()
        )
      }
    )
  }

  private registerSession(taskId: string, execution: SubagentExecution): void {
    const record = this.tasks.get(taskId)
    if (!record || record.state === 'completed' || record.state === 'failed') {
      return
    }
    if (this.sessions.has(execution.sessionId)) {
      // Executor contract violation: settle failed instead of double-booking the session.
      this.settle(
        record,
        execution.sessionId,
        { status: 'failed', detail: `duplicate sessionId from executor: ${execution.sessionId}` },
        this.nowEpochMs()
      )
      return
    }
    this.sessions.set(execution.sessionId, taskId)
    record.sessionId = execution.sessionId
    record.detail = execution.detail
    // Terminal state stays open until onComplete: the host owns the completion decision.
  }

  private settle(
    record: GanglionTaskRecord,
    sessionId: string | null,
    result: SubagentResult,
    at: number
  ): GanglionCompletionResult {
    record.state = result.status === 'completed' ? 'completed' : 'failed'
    record.status = result.status
    record.detail = result.detail ?? record.detail
    record.sessionId = sessionId ?? record.sessionId
    record.completedAtEpochMs = at
    this.reserved.delete(record.taskId)
    const audit = this.recordTransition('ganglion.task.completed', record, at, {
      tentacle: record.tentacle,
      taskId: record.taskId,
      sessionId,
      status: result.status,
      detail: record.detail,
      edge: record.edge
    })
    this.events?.publish('ganglion.task.completed', {
      tentacle: record.tentacle,
      taskId: record.taskId,
      sessionId,
      nodeId: record.nodeId,
      status: result.status,
      ...(record.detail === undefined ? {} : { detail: record.detail }),
      edge: record.edge
    })
    if (sessionId !== null && !this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, record.taskId)
    }
    this.drain(record.tentacle)
    return { record, audit }
  }

  private drain(tentacle: TentacleName): void {
    let queue = this.queues.get(tentacle)
    while (queue && queue.length > 0 && this.runningCount(tentacle) < this.capFor(tentacle)) {
      const taskId = queue.shift() as string
      const record = this.tasks.get(taskId)
      const task = this.reserved.get(taskId)
      if (!record || record.state !== 'queued' || !task) {
        continue
      }
      record.state = 'running'
      record.startedAtEpochMs = this.nowEpochMs()
      this.recordTransition('ganglion.task.spawned', record, record.startedAtEpochMs, {
        tentacle,
        taskId,
        title: record.title,
        nodeId: record.nodeId
      })
      this.events?.publish('ganglion.tentacle.spawned', {
        tentacle,
        taskId,
        title: record.title,
        nodeId: record.nodeId
      })
      this.delegate(task)
      queue = this.queues.get(tentacle)
    }
    if (queue && queue.length === 0) {
      this.queues.delete(tentacle)
    }
  }

  private runningCount(tentacle: TentacleName): number {
    let count = 0
    for (const record of this.tasks.values()) {
      if (record.tentacle === tentacle && record.state === 'running') {
        count += 1
      }
    }
    return count
  }

  private capFor(tentacle: TentacleName): number {
    return this.concurrency[tentacle] ?? DEFAULT_CONCURRENCY
  }

  private recordTransition(
    action: GanglionRuntimeAuditEvent['action'],
    record: GanglionTaskRecord,
    at: number,
    payload: Record<string, unknown>
  ): GanglionRuntimeAuditEvent {
    const audit = ganglionRuntimeAuditEvent(action, record.taskId, at, payload)
    this.auditLog.push(audit)
    return audit
  }

  private taskTentacle(taskId: string): TentacleName {
    const record = this.tasks.get(taskId)
    if (!record) {
      throw new RangeError(`Ganglion delegate requires a reserved task: ${taskId}`)
    }
    return record.tentacle
  }
}
