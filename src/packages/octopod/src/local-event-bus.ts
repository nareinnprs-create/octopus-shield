import type { OctopodEvent, OctopodEventBus, OctopodEventMap, OctopodUnsubscribe } from './octopod-events'

type AnyKey = keyof OctopodEventMap & string
type StoredListener = (event: OctopodEvent) => void

export type LocalOctopodEventBus = OctopodEventBus & {
  /** Total events delivered since creation (diagnostics for --once runs). */
  readonly deliveredCount: number
}

/** In-process bus for `--once` runs and tests; events never leave the process. */
export function createLocalOctopodEventBus(options?: { nowEpochMs?: () => number }): LocalOctopodEventBus {
  const nowEpochMs = options?.nowEpochMs ?? Date.now
  const listeners = new Map<AnyKey, Set<StoredListener>>()
  let delivered = 0
  return {
    get deliveredCount(): number {
      return delivered
    },
    publish<Type extends AnyKey>(type: Type, payload: OctopodEventMap[Type]): void {
      const event: OctopodEvent<Type> = { type, payload, occurredAtEpochMs: nowEpochMs() }
      const set = listeners.get(type)
      if (set === undefined || set.size === 0) {
        delivered += 1
        return
      }
      for (const listener of set) {
        listener(event)
      }
      delivered += 1
    },
    subscribe<Type extends AnyKey>(type: Type, listener: (event: OctopodEvent<Type>) => void): OctopodUnsubscribe {
      let set = listeners.get(type)
      if (set === undefined) {
        set = new Set()
        listeners.set(type, set)
      }
      // SAFETY: the set is keyed by the exact event type; publish() only routes same-key events,
      // so payload alignment between OctopodEvent<Type> and the union-shaped OctopodEvent is guaranteed.
      const stored = listener as unknown as StoredListener
      set.add(stored)
      return () => {
        set?.delete(stored)
      }
    }
  }
}
