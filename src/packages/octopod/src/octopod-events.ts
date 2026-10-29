import type {
  GanglionEdgeKind,
  GanglionTaskCompletedEvent,
  GanglionTaskQueuedEvent,
  GanglionTentacleSpawnedEvent,
  TentacleId,
  TentacleName
} from '@shield/ganglion'
import type { EngineId } from '@shield/engine-contracts'

export type EngineProbeRef = EngineId | 'nucleus'

export type OctopodEventMap = {
  'octopod.started': { startedAtEpochMs: number }
  'octopod.stopped': { reason: string }
  'ganglion.tentacle.registered': { tentacleId: TentacleId; name: TentacleName }
  'ganglion.edge.added': { source: string; target: string; kind: GanglionEdgeKind }
  /** Ganglion runtime lifecycle (payloads owned by @shield/ganglion/runtime). */
  'ganglion.tentacle.spawned': GanglionTentacleSpawnedEvent
  'ganglion.task.queued': GanglionTaskQueuedEvent
  'ganglion.task.completed': GanglionTaskCompletedEvent
  'engine.endpoint.resolved': { engine: EngineId | 'nucleus'; host: string; port: number }
  /**
   * Gardens VM lifecycle (emitted alongside the @shield/gardens-vm audit records;
   * op = created|started|stopped|deleted, force flag only on stop).
   */
  'garden.vm.lifecycle': {
    op: 'created' | 'started' | 'stopped' | 'deleted'
    name: string
    backend: 'qemu' | 'hyperv' | 'vz'
    force: boolean
  }
  /**
   * Liveness ONLY: 'healthy' means an HTTP-layer answer matched the probe rule
   * (any-response or exact-status). It never attests engine authenticity or
   * identity — on a shared host any local process answering the probe port
   * counts. evidence names that trust model so consumers cannot miss it.
   */
  'engine.health': {
    engine: EngineProbeRef
    healthy: boolean
    evidence: 'http-status-only'
    observedStatus: number | null
    detail: string
    probeUrl: string
    probedAtEpochMs: number
  }
}

/** Compile-checked enrollment of every event key; drives bus-wide fan-out (CLI --once echo, NATS subject map). */
export const OCTOPOD_EVENT_TYPES = [
  'octopod.started',
  'octopod.stopped',
  'ganglion.tentacle.registered',
  'ganglion.edge.added',
  'ganglion.tentacle.spawned',
  'ganglion.task.queued',
  'ganglion.task.completed',
  'engine.endpoint.resolved',
  'engine.health',
  'garden.vm.lifecycle'
] as const satisfies readonly (keyof OctopodEventMap & string)[]

export type OctopodEvent<
  Type extends keyof OctopodEventMap & string = keyof OctopodEventMap & string
> = {
  type: Type
  payload: OctopodEventMap[Type]
  occurredAtEpochMs: number
}

export type OctopodUnsubscribe = () => void

/** Structural transport seam; octopod stays transport-free (NATS client lives with the host). */
export type OctopodEventBus = {
  publish<Type extends keyof OctopodEventMap & string>(
    type: Type,
    payload: OctopodEventMap[Type]
  ): void
  subscribe<Type extends keyof OctopodEventMap & string>(
    type: Type,
    listener: (event: OctopodEvent<Type>) => void
  ): OctopodUnsubscribe
}
