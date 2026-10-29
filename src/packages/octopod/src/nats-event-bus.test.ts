import { describe, expect, it, vi } from 'vitest'

import {
  NatsEventBus,
  type NatsConnectionLike,
  type NatsMessageLike,
  type NatsPayloadLike,
  type NatsSubscriptionLike
} from './nats-event-bus'
import type { OctopodEvent } from './octopod-events'

const encoder = new TextEncoder()

const decode = (payload: NatsPayloadLike | undefined): string =>
  typeof payload === 'string' ? payload : new TextDecoder().decode(payload ?? new Uint8Array())

/** Minimal in-memory core-NATS loopback: publish fans out to local subscribers of the subject. */
class FakeNatsSubscription implements NatsSubscriptionLike {
  readonly subject: string
  unsubscribeCount = 0

  readonly #queued: NatsMessageLike[] = []
  #waiters: Array<(result: IteratorResult<NatsMessageLike>) => void> = []
  #closed = false

  constructor(subject: string) {
    this.subject = subject
  }

  deliver(message: NatsMessageLike): void {
    if (this.#closed) {
      return
    }
    const waiter = this.#waiters.shift()
    if (waiter !== undefined) {
      waiter({ value: message, done: false })
      return
    }
    this.#queued.push(message)
  }

  unsubscribe(): void {
    this.unsubscribeCount += 1
    this.#closed = true
    for (const waiter of this.#waiters.splice(0)) {
      waiter({ value: undefined, done: true })
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<NatsMessageLike> {
    return {
      next: (): Promise<IteratorResult<NatsMessageLike>> => {
        const queued = this.#queued.shift()
        if (queued !== undefined) {
          return Promise.resolve({ value: queued, done: false })
        }
        if (this.#closed) {
          return Promise.resolve({ value: undefined, done: true })
        }
        return new Promise((resolve) => this.#waiters.push(resolve))
      }
    }
  }
}

class FakeNatsConnection implements NatsConnectionLike {
  readonly published: Array<{ subject: string; payload?: NatsPayloadLike }> = []
  readonly subscriptions = new Map<string, FakeNatsSubscription[]>()
  #closed = false

  publish(subject: string, payload?: NatsPayloadLike): void {
    if (this.#closed) {
      throw new Error('fake nats connection is closed')
    }
    this.published.push({ subject, payload })
    for (const subscription of this.subscriptions.get(subject) ?? []) {
      const text = decode(payload)
      subscription.deliver({
        subject,
        data: encoder.encode(text),
        json: <T,>() => JSON.parse(text) as T
      })
    }
  }

  subscribe(subject: string): FakeNatsSubscription {
    const subscription = new FakeNatsSubscription(subject)
    const existing = this.subscriptions.get(subject) ?? []
    existing.push(subscription)
    this.subscriptions.set(subject, existing)
    return subscription
  }

  deliverRaw(subject: string, body: unknown): void {
    for (const subscription of this.subscriptions.get(subject) ?? []) {
      subscription.deliver({
        subject,
        data: encoder.encode(typeof body === 'string' ? body : JSON.stringify(body)),
        json: <T,>() => body as T
      })
    }
  }

  drain(): Promise<void> {
    this.#closed = true
    for (const list of this.subscriptions.values()) {
      for (const subscription of list) {
        subscription.unsubscribe()
      }
    }
    return Promise.resolve()
  }

  isClosed(): boolean {
    return this.#closed
  }
}

const subjectFor = (type: string, prefix = 'oshield.octopod'): string => `${prefix}.${type}`

describe('NatsEventBus', () => {
  it('publish serializes the envelope onto the prefixed subject and subscribers receive it', async () => {
    const connection = new FakeNatsConnection()
    const bus = new NatsEventBus(connection, { nowEpochMs: () => 5_000 })
    const received: OctopodEvent<'engine.health'>[] = []
    bus.subscribe('engine.health', (event) => received.push(event))

    const payload = {
      engine: 'caldera' as const,
      healthy: true,
      evidence: 'http-status-only' as const,
      observedStatus: 200,
      detail: 'HTTP 200',
      probeUrl: 'http://localhost:8890/api/v2/health',
      probedAtEpochMs: 4_000
    }
    bus.publish('engine.health', payload)

    expect(connection.published).toEqual([
      { subject: subjectFor('engine.health'), payload: expect.any(String) }
    ])
    await vi.waitFor(() => expect(received).toHaveLength(1))
    expect(received[0]).toEqual({ type: 'engine.health', payload, occurredAtEpochMs: 5_000 })
  })

  it('a custom subject prefix namespaces the subjects', async () => {
    const connection = new FakeNatsConnection()
    const bus = new NatsEventBus(connection, { subjectPrefix: 'fabric.test', nowEpochMs: () => 0 })
    bus.subscribe('octopod.stopped', () => {})
    bus.publish('octopod.stopped', { reason: 'done' })
    expect(connection.published[0]?.subject).toBe('fabric.test.octopod.stopped')
  })

  it('different event types ride different subjects', () => {
    const connection = new FakeNatsConnection()
    const bus = new NatsEventBus(connection, { nowEpochMs: () => 0 })
    bus.publish('octopod.started', { startedAtEpochMs: 1 })
    bus.publish('ganglion.tentacle.registered', { tentacleId: 'tentacle:forge', name: 'Forge' })
    expect(connection.published.map((entry) => entry.subject)).toEqual([
      subjectFor('octopod.started'),
      subjectFor('ganglion.tentacle.registered')
    ])
  })

  it('a malformed frame surfaces through onPumpError and the pump keeps delivering', async () => {
    const connection = new FakeNatsConnection()
    const pumpErrors: unknown[] = []
    const bus = new NatsEventBus(connection, { nowEpochMs: () => 0, onPumpError: (error) => pumpErrors.push(error) })
    const received: OctopodEvent<'octopod.started'>[] = []
    bus.subscribe('octopod.started', (event) => received.push(event))

    connection.deliverRaw(subjectFor('octopod.started'), 'not-an-object-at-all')
    await vi.waitFor(() => expect(pumpErrors).toHaveLength(1))

    bus.publish('octopod.started', { startedAtEpochMs: 9 })
    await vi.waitFor(() => expect(received).toHaveLength(1))
    expect(received[0]?.payload).toEqual({ startedAtEpochMs: 9 })
  })

  it('cross-type and shape-broken frames are dropped silently (no listener call, no pump error)', async () => {
    const connection = new FakeNatsConnection()
    const pumpErrors: unknown[] = []
    const bus = new NatsEventBus(connection, { nowEpochMs: () => 0, onPumpError: (error) => pumpErrors.push(error) })
    const received: OctopodEvent<'octopod.started'>[] = []
    bus.subscribe('octopod.started', (event) => received.push(event))

    connection.deliverRaw(subjectFor('octopod.started'), {
      type: 'octopod.stopped',
      payload: { reason: 'x' },
      occurredAtEpochMs: 1
    })
    connection.deliverRaw(subjectFor('octopod.started'), {
      type: 'octopod.started',
      payload: { startedAtEpochMs: 2 },
      occurredAtEpochMs: 'not-a-number'
    })
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(received).toEqual([])
    expect(pumpErrors).toEqual([])

    bus.publish('octopod.started', { startedAtEpochMs: 3 })
    await vi.waitFor(() => expect(received).toHaveLength(1))
  })

  it('unsubscribe detaches the NATS subscription and ends delivery; it is idempotent', async () => {
    const connection = new FakeNatsConnection()
    const bus = new NatsEventBus(connection, { nowEpochMs: () => 0 })
    const received: OctopodEvent<'octopod.started'>[] = []
    const unsubscribe = bus.subscribe('octopod.started', (event) => received.push(event))

    bus.publish('octopod.started', { startedAtEpochMs: 1 })
    await vi.waitFor(() => expect(received).toHaveLength(1))

    unsubscribe()
    unsubscribe()
    const subscription = connection.subscriptions.get(subjectFor('octopod.started'))?.[0]
    expect(subscription?.unsubscribeCount).toBe(1)

    bus.publish('octopod.started', { startedAtEpochMs: 2 })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(received).toHaveLength(1)
  })

  it('close() drains the connection; publishing afterwards throws', async () => {
    const connection = new FakeNatsConnection()
    const bus = new NatsEventBus(connection, { nowEpochMs: () => 0 })
    await bus.close()
    expect(connection.isClosed()).toBe(true)
    expect(() => bus.publish('octopod.started', { startedAtEpochMs: 1 })).toThrow(/nats connection is closed/)
  })
})
