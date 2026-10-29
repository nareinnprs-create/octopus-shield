import { connect, type NatsConnection } from 'nats'
import type { OctopodEvent, OctopodEventBus, OctopodEventMap, OctopodUnsubscribe } from './octopod-events'

type AnyKey = keyof OctopodEventMap & string

/** NATS subjects are dot-token structured like the event names; the prefix namespaces the octopod fabric. */
const DEFAULT_SUBJECT_PREFIX = 'oshield.octopod'

export type NatsPayloadLike = string | Uint8Array

/** Structural view of a `nats` Msg (messages carry json<T>()); a fake connection satisfies tests. */
export type NatsMessageLike = {
  subject: string
  data: Uint8Array
  json<T = unknown>(): T
}

export type NatsSubscriptionLike = AsyncIterable<NatsMessageLike> & { unsubscribe(): void }

/** Structural view of `nats` NatsConnection; disconnect/reconnect is the nats client library's job. */
export type NatsConnectionLike = {
  publish(subject: string, payload?: NatsPayloadLike): void
  subscribe(subject: string): NatsSubscriptionLike
  drain(): Promise<void>
  isClosed(): boolean
}

export type NatsEventBusOptions = {
  subjectPrefix?: string
  nowEpochMs?: () => number
  onPumpError?: (error: unknown, type: AnyKey) => void
}

/** OctopodEventBus over NATS core pub/sub (at-most-once per message — by design for telemetry). */
export class NatsEventBus implements OctopodEventBus {
  private readonly connection: NatsConnectionLike
  private readonly subjectPrefix: string
  private readonly nowEpochMs: () => number
  private readonly onPumpError: (error: unknown, type: AnyKey) => void

  constructor(connection: NatsConnectionLike, options?: NatsEventBusOptions) {
    this.connection = connection
    this.subjectPrefix = options?.subjectPrefix ?? DEFAULT_SUBJECT_PREFIX
    this.nowEpochMs = options?.nowEpochMs ?? Date.now
    this.onPumpError = options?.onPumpError ?? defaultPumpErrorSink
  }

  publish<Type extends AnyKey>(type: Type, payload: OctopodEventMap[Type]): void {
    if (this.connection.isClosed()) {
      throw new Error(`nats connection is closed: cannot publish ${type}`)
    }
    const event: OctopodEvent<Type> = { type, payload, occurredAtEpochMs: this.nowEpochMs() }
    this.connection.publish(subjectFor(this.subjectPrefix, type), JSON.stringify(event))
  }

  subscribe<Type extends AnyKey>(type: Type, listener: (event: OctopodEvent<Type>) => void): OctopodUnsubscribe {
    const subscription = this.connection.subscribe(subjectFor(this.subjectPrefix, type))
    let open = true
    void this.pump(type, listener, subscription, () => open)
    return () => {
      if (!open) {
        return
      }
      open = false
      subscription.unsubscribe()
    }
  }

  private async pump<Type extends AnyKey>(
    type: Type,
    listener: (event: OctopodEvent<Type>) => void,
    subscription: NatsSubscriptionLike,
    isOpen: () => boolean
  ): Promise<void> {
    try {
      for await (const message of subscription) {
        if (!isOpen()) {
          return
        }
        // Per-message guard: a malformed frame must surface through the sink, never exit the loop.
        try {
          const event = parseOctopodEvent(message.json(), type, message.subject)
          if (event !== null) {
            listener(event)
          }
        } catch (error) {
          if (isOpen()) {
            this.onPumpError(error, type)
          }
        }
      }
    } catch (error) {
      // Subscription teardown after unsubscribe() is expected; anything else surfaces through the sink.
      if (isOpen()) {
        this.onPumpError(error, type)
      }
    }
  }

  /** Drains then closes the NATS connection (in-flight publishes/subscriptions deliver first). */
  async close(): Promise<void> {
    await this.connection.drain()
  }
}

// Control chars stripped so a hostile frame cannot inject ANSI/log escapes.
const sanitizeForLog = (value: string): string =>
  value.replace(/[\x00-\x1f\x7f]/g, ' ')

const defaultPumpErrorSink = (error: unknown, type: string): void => {
  const message = sanitizeForLog(error instanceof Error ? error.message : String(error))
  console.error(`octopod nats pump failure for ${sanitizeForLog(type)}: ${message}`)
}

const subjectFor = (prefix: string, type: string): string => `${prefix}.${type}`

/** Validates the wire envelope `{ type, payload, occurredAtEpochMs }`; cross-type and malformed frames are dropped. */
function parseOctopodEvent<Type extends AnyKey>(raw: unknown, type: Type, subject: string): OctopodEvent<Type> | null {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`nats message on ${subject} is not an octopod event frame object`)
  }
  // SAFETY: the object guard above excludes null; frame fields are checked before use.
  const frame = raw as Record<string, unknown>
  if (frame.type !== type || typeof frame.occurredAtEpochMs !== 'number' || !('payload' in frame)) {
    return null
  }
  return {
    type,
    payload: frame.payload as OctopodEventMap[Type],
    occurredAtEpochMs: frame.occurredAtEpochMs
  }
}

export type NatsServers = string | readonly string[]

/** Adapter over the real `nats` package connection. */
function adaptNatsConnection(connection: NatsConnection): NatsConnectionLike {
  return {
    publish: (subject, payload) => connection.publish(subject, payload),
    subscribe: (subject) => connection.subscribe(subject),
    drain: () => connection.drain(),
    isClosed: () => connection.isClosed()
  }
}

/** Connects to a NATS server (e.g. `nats://127.0.0.1:4222`); resolves only once connected. */
export async function connectNatsEventBus(options: {
  servers: NatsServers
  /** Single-token auth (nats-server `--auth`); omit for auth-less servers. */
  token?: string
  busOptions?: Omit<NatsEventBusOptions, 'nowEpochMs'>
}): Promise<NatsEventBus> {
  const servers = Array.isArray(options.servers) ? [...options.servers] : [options.servers]
  const connection = await connect({ servers, ...(options.token === undefined ? {} : { token: options.token }) })
  return new NatsEventBus(adaptNatsConnection(connection), options.busOptions)
}
