import { describe, expect, it } from 'vitest'

import { createLocalOctopodEventBus } from './local-event-bus'

describe('createLocalOctopodEventBus', () => {
  it('delivers typed payloads with an occurredAtEpochMs timestamp', () => {
    const bus = createLocalOctopodEventBus({ nowEpochMs: () => 1_234 })
    const received: unknown[] = []
    bus.subscribe('engine.health', (event) => received.push(event))

    bus.publish('engine.health', {
      engine: 'caldera',
      healthy: true,
      evidence: 'http-status-only',
      observedStatus: 200,
      detail: 'HTTP 200',
      probeUrl: 'http://localhost:8890/api/v2/health',
      probedAtEpochMs: 1_000
    })

    expect(received).toEqual([
      {
        type: 'engine.health',
        payload: {
          engine: 'caldera',
          healthy: true,
          evidence: 'http-status-only',
          observedStatus: 200,
          detail: 'HTTP 200',
          probeUrl: 'http://localhost:8890/api/v2/health',
          probedAtEpochMs: 1_000
        },
        occurredAtEpochMs: 1_234
      }
    ])
  })

  it('routes per type: other channels never see the event', () => {
    const bus = createLocalOctopodEventBus()
    const started: unknown[] = []
    const stopped: unknown[] = []
    bus.subscribe('octopod.started', (event) => started.push(event))
    bus.subscribe('octopod.stopped', (event) => stopped.push(event))

    bus.publish('octopod.started', { startedAtEpochMs: 1 })
    expect(started).toHaveLength(1)
    expect(stopped).toEqual([])

    bus.publish('octopod.stopped', { reason: 'test done' })
    expect(stopped).toHaveLength(1)
    expect(started).toHaveLength(1)
  })

  it('multiple subscribers on one channel all receive the event', () => {
    const bus = createLocalOctopodEventBus()
    const first: unknown[] = []
    const second: unknown[] = []
    bus.subscribe('octopod.started', (event) => first.push(event))
    bus.subscribe('octopod.started', (event) => second.push(event))

    bus.publish('octopod.started', { startedAtEpochMs: 7 })
    expect(first).toHaveLength(1)
    expect(second).toHaveLength(1)
  })

  it('unsubscribe stops delivery for that listener only', () => {
    const bus = createLocalOctopodEventBus()
    const received: unknown[] = []
    const keep: unknown[] = []
    const unsubscribe = bus.subscribe('octopod.started', (event) => received.push(event))
    bus.subscribe('octopod.started', (event) => keep.push(event))

    unsubscribe()
    bus.publish('octopod.started', { startedAtEpochMs: 2 })
    expect(received).toEqual([])
    expect(keep).toHaveLength(1)

    unsubscribe()
    bus.publish('octopod.started', { startedAtEpochMs: 3 })
    expect(received).toEqual([])
  })

  it('deliveredCount counts every publish, with or without listeners', () => {
    const bus = createLocalOctopodEventBus()
    expect(bus.deliveredCount).toBe(0)

    bus.publish('octopod.started', { startedAtEpochMs: 1 })
    expect(bus.deliveredCount).toBe(1)

    bus.publish('octopod.started', { startedAtEpochMs: 2 })
    expect(bus.deliveredCount).toBe(2)
  })
})
