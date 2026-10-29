import { describe, expect, it } from 'vitest'

import {
  GanglionRuntime,
  seedDefaultGanglionRegistry,
  type SubagentExecution
} from '@shield/ganglion'
import { createLocalOctopodEventBus, type LocalOctopodEventBus } from './local-event-bus'
import { octopodMain } from './octopod-main'

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

const collectEvents = (): { bus: LocalOctopodEventBus; types: string[] } => {
  const bus = createLocalOctopodEventBus()
  const types: string[] = []
  for (const type of [
    'octopod.started',
    'ganglion.tentacle.registered',
    'ganglion.tentacle.spawned',
    'ganglion.task.queued',
    'ganglion.task.completed'
  ] as const) {
    bus.subscribe(type, () => types.push(type))
  }
  return { bus, types }
}

describe('octopodMain without ganglionRuntime (existing behavior unchanged)', () => {
  it('seeds the 7 Tentacles and exposes no runtime', () => {
    const { bus } = collectEvents()
    const daemon = octopodMain({ eventBus: bus, env: {} })

    expect(daemon.ganglionRuntime).toBeUndefined()
    expect(daemon.ganglion.tentacles.size).toBe(7)
    daemon.stop('test done')
  })
})

describe('octopodMain with an injected ganglionRuntime (additive)', () => {
  it('exposes the runtime, seeds from its live registry, and rides its lifecycle events on the bus', async () => {
    const { bus, types } = collectEvents()
    const runtime = new GanglionRuntime({
      registry: seedDefaultGanglionRegistry(),
      // Structural stand-in for the shell's real agent-session executor (see runtime.ts header).
      executor: async (tentacle, task): Promise<SubagentExecution> => ({
        sessionId: `acp:${tentacle}:${task.id}`,
        status: 'completed'
      }),
      events: bus
    })

    const daemon = octopodMain({ eventBus: bus, env: {}, ganglionRuntime: runtime })

    expect(daemon.ganglionRuntime).toBe(runtime)
    expect(daemon.ganglion).toBe(runtime.registry)
    expect(types).toEqual(['octopod.started'])

    daemon.ganglionRuntime?.spawn('Forge', {
      id: 'w-1',
      title: 'Wire it',
      prompt: 'prove the seam'
    })
    await flush()
    expect(types).toEqual(['octopod.started', 'ganglion.tentacle.spawned'])

    const completion = daemon.ganglionRuntime?.onComplete('acp:Forge:w-1', { status: 'completed' })
    expect(completion?.record.state).toBe('completed')
    expect(types).toEqual([
      'octopod.started',
      'ganglion.tentacle.spawned',
      'ganglion.task.completed'
    ])

    const graph = runtime.snapshot()
    expect(graph.registry.graph.nodes.get('ganglion:task:w-1')).toMatchObject({ tentacle: 'Forge' })
    expect(graph.registry.graph.edges).toContainEqual({
      source: 'tentacle:forge:node',
      target: 'ganglion:task:w-1',
      kind: 'delegates'
    })
    daemon.stop('test done')
  })
})
