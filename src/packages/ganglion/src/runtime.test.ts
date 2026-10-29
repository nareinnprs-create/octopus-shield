import { describe, expect, it } from 'vitest'

import { ganglionNodeById, seedDefaultGanglionRegistry } from './ganglion-registry'
import type { GanglionRuntimeEventMap } from './ganglion-runtime-events'
import type { SubagentExecution, SubagentExecutor, SubagentTask } from './ganglion-subagent'
import { GanglionRuntime } from './runtime'

type DeferredExecution = {
  promise: Promise<SubagentExecution>
  resolve: (execution: SubagentExecution) => void
  reject: (error: unknown) => void
}

const deferredExecution = (): DeferredExecution => {
  let resolve!: DeferredExecution['resolve']
  let reject!: DeferredExecution['reject']
  const promise = new Promise<SubagentExecution>((res, rej) => {
    resolve = res
    reject = rej
  })
  void promise.catch(() => {})
  return { promise, resolve, reject }
}

const recordedEvents = () => {
  const events: {
    type: keyof GanglionRuntimeEventMap
    payload: GanglionRuntimeEventMap[keyof GanglionRuntimeEventMap]
  }[] = []
  const sink = {
    publish: <K extends keyof GanglionRuntimeEventMap>(
      type: K,
      payload: GanglionRuntimeEventMap[K]
    ): void => {
      events.push({ type, payload })
    }
  }
  return { events, sink }
}

/** Executor whose sessions settle only when the test resolves their deferred. */
const manualExecutor = (): {
  executor: SubagentExecutor
  deferred: Map<string, DeferredExecution>
} => {
  const deferred = new Map<string, DeferredExecution>()
  const executor: SubagentExecutor = async (_tentacle, task) => {
    const pending = deferredExecution()
    deferred.set(task.id, pending)
    return pending.promise
  }
  return { executor, deferred }
}

const buildRuntime = (overrides?: {
  executor?: SubagentExecutor
  concurrency?: Partial<Record<string, number>>
  nowEpochMs?: () => number
  withEvents?: boolean
}): { runtime: GanglionRuntime; events: ReturnType<typeof recordedEvents>['events'] } => {
  const recorded = recordedEvents()
  const runtime = new GanglionRuntime({
    registry: seedDefaultGanglionRegistry(),
    executor: overrides?.executor ?? manualExecutor().executor,
    ...(overrides?.withEvents === false ? {} : { events: recorded.sink }),
    ...(overrides?.concurrency === undefined ? {} : { concurrency: overrides.concurrency }),
    ...(overrides?.nowEpochMs === undefined ? {} : { nowEpochMs: overrides.nowEpochMs })
  })
  return { runtime, events: recorded.events }
}

const task = (id: string, prompt = `prompt for ${id}`): SubagentTask => ({
  id,
  title: `Task ${id}`,
  prompt
})

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

describe('GanglionRuntime.spawn', () => {
  it('reserves a task node plus delegation edge, emits ganglion.tentacle.spawned, and delegates', async () => {
    const { runtime, events } = buildRuntime()
    const result = runtime.spawn('Forge', task('t1'))

    expect(result.queued).toBe(false)
    expect(result.record.state).toBe('running')
    expect(ganglionNodeById(runtime.registry, 'ganglion:task:t1')).toEqual({
      id: 'ganglion:task:t1',
      tentacle: 'Forge',
      label: 'Task t1'
    })
    expect(runtime.registry.graph.edges).toContainEqual({
      source: 'tentacle:forge:node',
      target: 'ganglion:task:t1',
      kind: 'delegates'
    })
    expect(events).toEqual([
      {
        type: 'ganglion.tentacle.spawned',
        payload: { tentacle: 'Forge', taskId: 't1', title: 'Task t1', nodeId: 'ganglion:task:t1' }
      }
    ])
    expect(runtime.auditLogEntries()).toHaveLength(1)
    expect(runtime.auditLogEntries()[0]).toMatchObject({
      actorKind: 'tentacle',
      actorId: 'ganglion-runtime',
      action: 'ganglion.task.spawned',
      resourceKind: 'ganglion-task',
      resourceId: 't1',
      traceId: null
    })
  })

  it('rejects unregistered Tentacles, duplicate task ids, and invalid concurrency caps', () => {
    const { runtime } = buildRuntime()
    expect(() => runtime.spawn('Kraken', task('t1'))).toThrow(
      /requires a registered Tentacle: Kraken/
    )
    runtime.spawn('Forge', task('t1'))
    expect(() => runtime.spawn('Forge', task('t1'))).toThrow(/task id already reserved: t1/)
    expect(
      () =>
        new GanglionRuntime({
          registry: seedDefaultGanglionRegistry(),
          executor: async () => ({ sessionId: 's', status: 'completed' }),
          concurrency: { Forge: 0 }
        })
    ).toThrow(/positive integer/)
  })
})

describe('GanglionRuntime concurrency cap and queue', () => {
  it('queues overflow beyond the per-Tentacle cap and drains it when a slot frees', async () => {
    const { executor, deferred } = manualExecutor()
    const { runtime, events } = buildRuntime({ executor })

    const first = runtime.spawn('Forge', task('t1'))
    const second = runtime.spawn('Forge', task('t2'))

    expect(first.queued).toBe(false)
    expect(second.queued).toBe(true)
    expect(second.queueDepth).toBe(1)
    expect(second.record.state).toBe('queued')
    expect(deferred.get('t2')).toBeUndefined()
    expect(events.map((event) => event.type)).toEqual([
      'ganglion.tentacle.spawned',
      'ganglion.task.queued'
    ])
    expect(events[1].payload).toMatchObject({ tentacle: 'Forge', taskId: 't2', queueDepth: 1 })

    deferred.get('t1')?.resolve({ sessionId: 'session-t1', status: 'completed' })
    await flush()

    // Settlement is host-driven: the executor resolution only registered the session.
    const settlement = runtime.onComplete('session-t1', { status: 'completed' })
    expect(settlement.audit?.action).toBe('ganglion.task.completed')

    expect(deferred.get('t2')).toBeDefined()
    const snapshot = runtime.snapshot()
    expect(snapshot.runningCountByTentacle['Forge']).toBe(1)
    expect(snapshot.queueDepthByTentacle['Forge']).toBeUndefined()
    expect(events[2]).toEqual({
      type: 'ganglion.task.completed',
      payload: expect.objectContaining({ tentacle: 'Forge', taskId: 't1', status: 'completed' })
    })
    expect(events[3]).toEqual({
      type: 'ganglion.tentacle.spawned',
      payload: { tentacle: 'Forge', taskId: 't2', title: 'Task t2', nodeId: 'ganglion:task:t2' }
    })
  })

  it('runs independent Tentacles in parallel under their own caps', async () => {
    const { executor, deferred } = manualExecutor()
    const { runtime } = buildRuntime({ executor, concurrency: { Forge: 2, Prism: 1 } })

    runtime.spawn('Forge', task('f1'))
    runtime.spawn('Forge', task('f2'))
    const third = runtime.spawn('Forge', task('f3'))
    runtime.spawn('Prism', task('p1'))

    expect(third.queued).toBe(true)
    expect(runtime.snapshot().runningCountByTentacle).toEqual({ Forge: 2, Prism: 1 })
    expect(deferred.size).toBe(3)
  })

  it('keeps a resolved-but-unsettled session occupying its slot until onComplete', async () => {
    const { executor, deferred } = manualExecutor()
    const { runtime } = buildRuntime({ executor })

    runtime.spawn('Forge', task('t1'))
    deferred.get('t1')?.resolve({ sessionId: 'session-t1', status: 'completed' })
    await flush()

    const overflow = runtime.spawn('Forge', task('t2'))
    expect(overflow.queued).toBe(true)
  })
})

describe('GanglionRuntime.onComplete', () => {
  it('records the delegation edge completion, emits ganglion.task.completed, and audits', async () => {
    const { executor, deferred } = manualExecutor()
    const at = 1_000
    let now = at
    const { runtime, events } = buildRuntime({ executor, nowEpochMs: () => now })

    runtime.spawn('Verifier', task('v1'))
    deferred
      .get('v1')
      ?.resolve({ sessionId: 'session-v1', status: 'completed', detail: 'verified' })
    await flush()
    now = 2_000
    const completion = runtime.onComplete('session-v1', { status: 'completed', detail: 'verified' })

    expect(completion.audit).not.toBeNull()
    expect(completion.record.title).toBe('Task v1')
    expect(completion.record.nodeId).toBe('ganglion:task:v1')
    expect(completion.record.edge).toEqual({
      source: 'tentacle:verifier:node',
      target: 'ganglion:task:v1',
      kind: 'delegates'
    })
    expect(completion.record).toMatchObject({
      taskId: 'v1',
      tentacle: 'Verifier',
      state: 'completed',
      status: 'completed',
      sessionId: 'session-v1',
      detail: 'verified',
      createdAtEpochMs: at,
      completedAtEpochMs: 2_000,
      audited: true
    })
    expect(events.at(-1)).toEqual({
      type: 'ganglion.task.completed',
      payload: {
        tentacle: 'Verifier',
        taskId: 'v1',
        sessionId: 'session-v1',
        nodeId: 'ganglion:task:v1',
        status: 'completed',
        detail: 'verified',
        edge: { source: 'tentacle:verifier:node', target: 'ganglion:task:v1', kind: 'delegates' }
      }
    })
    const actions = runtime.auditLogEntries().map((audit) => audit.action)
    expect(actions).toEqual(['ganglion.task.spawned', 'ganglion.task.completed'])
  })

  it('records failed status and frees the slot for the queued task', async () => {
    const { executor, deferred } = manualExecutor()
    const { runtime, events } = buildRuntime({ executor })

    runtime.spawn('Forge', task('t1'))
    runtime.spawn('Forge', task('t2'))
    deferred.get('t1')?.resolve({ sessionId: 'session-t1', status: 'failed', detail: 'boom' })
    await flush()
    const completion = runtime.onComplete('session-t1', { status: 'failed', detail: 'boom' })

    expect(completion.record.state).toBe('failed')
    expect(completion.record.status).toBe('failed')
    expect(deferred.get('t2')).toBeDefined()
    expect(events.filter((event) => event.type === 'ganglion.task.completed')).toHaveLength(1)
    expect(events.at(-1)?.type).toBe('ganglion.tentacle.spawned')
  })

  it('is idempotent for an already-settled session', async () => {
    const { executor, deferred } = manualExecutor()
    const { runtime, events } = buildRuntime({ executor })

    runtime.spawn('Forge', task('t1'))
    deferred.get('t1')?.resolve({ sessionId: 'session-t1', status: 'completed' })
    await flush()
    const first = runtime.onComplete('session-t1', { status: 'completed' })
    const second = runtime.onComplete('session-t1', { status: 'failed' })

    expect(second.record).toBe(first.record)
    expect(second.audit).toBeNull()
    expect(events.filter((event) => event.type === 'ganglion.task.completed')).toHaveLength(1)
  })

  it('rejects unknown sessions', () => {
    const { runtime } = buildRuntime()
    expect(() => runtime.onComplete('nope', { status: 'completed' })).toThrow(
      /requires a registered session: nope/
    )
  })
})

describe('GanglionRuntime executor failures', () => {
  it('settles the task failed and frees the slot when the executor rejects', async () => {
    const rejectingExecutor: SubagentExecutor = async (_tentacle, task) => {
      if (task.id === 't1') {
        throw new Error('agent session launch failed')
      }
      return { sessionId: `session-${task.id}`, status: 'completed' }
    }
    const { runtime, events } = buildRuntime({ executor: rejectingExecutor })

    runtime.spawn('Forge', task('t1'))
    runtime.spawn('Forge', task('t2'))
    await flush()

    const record = runtime.snapshot().tasks.find((entry) => entry.taskId === 't1')
    expect(record).toMatchObject({ state: 'failed', status: 'failed' })
    expect(record?.sessionId).toBeUndefined()
    expect(events.filter((event) => event.type === 'ganglion.task.completed')).toHaveLength(1)
    expect(deferredFor(runtime, 'session-t2')).toBe('t2')
  })

  it('settles failed instead of double-booking a duplicate sessionId', async () => {
    const { executor, deferred } = manualExecutor()
    const { runtime, events } = buildRuntime({ executor })

    runtime.spawn('Forge', task('t1'))
    runtime.spawn('Inkwell', task('t2'))
    deferred.get('t1')?.resolve({ sessionId: 'shared', status: 'completed' })
    deferred.get('t2')?.resolve({ sessionId: 'shared', status: 'completed' })
    await flush()

    const tasks = runtime.snapshot().tasks
    expect(tasks.find((entry) => entry.taskId === 't1')).toMatchObject({ state: 'running' })
    expect(tasks.find((entry) => entry.taskId === 't2')).toMatchObject({
      state: 'failed',
      status: 'failed',
      detail: 'duplicate sessionId from executor: shared'
    })
    expect(events.filter((event) => event.type === 'ganglion.task.completed')).toHaveLength(1)
  })
})

const deferredFor = (runtime: GanglionRuntime, sessionId: string): string | undefined => {
  for (const record of runtime.snapshot().tasks) {
    if (record.sessionId === sessionId) {
      return record.taskId
    }
  }
  return undefined
}

describe('GanglionRuntime wiring', () => {
  it('works without an event sink (sink is optional)', async () => {
    const { executor, deferred } = manualExecutor()
    const runtime = new GanglionRuntime({
      registry: seedDefaultGanglionRegistry(),
      executor
    })
    runtime.spawn('Forge', task('t1'))
    deferred.get('t1')?.resolve({ sessionId: 'session-t1', status: 'completed' })
    await flush()
    expect(runtime.onComplete('session-t1', { status: 'completed' }).record.state).toBe('completed')
  })

  it('queue drain delegates the original prompt to the executor', async () => {
    const prompts: string[] = []
    const { executor, deferred } = manualExecutor()
    const wrapped: SubagentExecutor = async (tentacle, task) => {
      prompts.push(`${tentacle}:${task.prompt}`)
      return executor(tentacle, task)
    }
    const { runtime } = buildRuntime({ executor: wrapped })

    runtime.spawn('Forge', task('t1', 'first prompt'))
    runtime.spawn('Forge', task('t2', 'second prompt'))
    deferred.get('t1')?.resolve({ sessionId: 'session-t1', status: 'completed' })
    await flush()
    runtime.onComplete('session-t1', { status: 'completed' })
    deferred.get('t2')?.resolve({ sessionId: 'session-t2', status: 'completed' })
    await flush()

    expect(prompts).toEqual(['Forge:first prompt', 'Forge:second prompt'])
  })
})
