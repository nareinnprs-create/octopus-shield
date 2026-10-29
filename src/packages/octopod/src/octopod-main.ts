import {
  attachNodeToTentacle,
  createGanglionRegistry,
  linkRegistryNodes,
  registerTentacle,
  TENTACLE_NAMES,
  type GanglionEdge,
  type GanglionRegistry,
  type GanglionRuntime
} from '@shield/ganglion'
import {
  engineConfigFromEnv,
  type EngineEndpointMap,
  type EngineEnvLike,
  type NucleusInfraEndpointMap
} from '@shield/engine-contracts'
import type { OctopodEventBus } from './octopod-events'
import {
  startEngineHealthLoop,
  type EngineHealthLoopHandle,
  type OctopodProbeFetchLike
} from './engine-probes'

export type OctopodEndpoints = {
  engines: EngineEndpointMap
  nucleus: NucleusInfraEndpointMap
}

export type OctopodMainDependencies = {
  /** Transport-seam implementation provided by the host; no NATS client is added here. */
  eventBus: OctopodEventBus
  env: EngineEnvLike
  /** Optional initial registry (e.g. hydrated by the host); an empty one is composed otherwise. */
  ganglion?: GanglionRegistry
  /**
   * Optional Ganglion runtime (head orchestrator). Additive: when provided, the daemon
   * seeds from its live registry and exposes it so hosts can spawn Tentacle tasks through
   * the existing agent-session infrastructure; its lifecycle events ride the same bus.
   */
  ganglionRuntime?: GanglionRuntime
}

export type OctopodDaemon = {
  readonly ganglion: GanglionRegistry
  readonly endpoints: OctopodEndpoints
  /** Present only when the host composed one; undefined keeps prior behavior unchanged. */
  readonly ganglionRuntime?: GanglionRuntime
  /** Serial health passes until stop(); each pass publishes engine.health for all probe descriptors. */
  startHealthLoop(input: {
    fetchLike: OctopodProbeFetchLike
    intervalMs: number
    timeoutMs?: number
    onLoopError?: (error: unknown) => void
  }): EngineHealthLoopHandle
  stop(reason?: string): void
}

/** Registers the locked Tentacle sub-teams as one node each; agent fan-out stays with the host. */
const seedDefaultTentacles = (
  eventBus: OctopodEventBus,
  ganglion: GanglionRegistry
): GanglionRegistry => {
  let seeded = ganglion
  for (const name of TENTACLE_NAMES) {
    const tentacleId = `tentacle:${name.toLowerCase()}`
    const nodeId = `${tentacleId}:node`
    // registerTentacle enforces the locked 7-name vocabulary (RangeError otherwise).
    seeded = registerTentacle(seeded, { id: tentacleId, name, nodes: [] })
    seeded = attachNodeToTentacle(seeded, tentacleId, { id: nodeId, tentacle: name })
    eventBus.publish('ganglion.tentacle.registered', { tentacleId, name })
  }
  // Archivist schedules the stack, Verifier receives its outcome; wiring is refined by the Ganglion protocol work.
  const edges: readonly GanglionEdge[] = [
    { source: 'tentacle:scaffold:node', target: 'tentacle:verifier:node', kind: 'delegates' },
    { source: 'tentacle:prism:node', target: 'tentacle:forge:node', kind: 'observes' }
  ]
  for (const edge of edges) {
    seeded = linkRegistryNodes(seeded, edge)
    eventBus.publish('ganglion.edge.added', {
      source: edge.source,
      target: edge.target,
      kind: edge.kind
    })
  }
  return seeded
}

/** Daemon entrypoint: resolve engine endpoints from OSHIELD_* env, compose the Ganglion, publish through the injected bus. */
export const octopodMain = (dependencies: OctopodMainDependencies): OctopodDaemon => {
  const eventBus = dependencies.eventBus
  const endpoints: OctopodEndpoints = engineConfigFromEnv(dependencies.env)
  const ganglionRuntime = dependencies.ganglionRuntime
  let ganglion = ganglionRuntime?.registry ?? dependencies.ganglion ?? createGanglionRegistry()
  if (ganglion.tentacles.size === 0) {
    ganglion = seedDefaultTentacles(eventBus, ganglion)
  }
  const primaries = [
    { engine: 'wazuh' as const, endpoint: endpoints.engines.wazuh.dashboard },
    { engine: 'mythic' as const, endpoint: endpoints.engines.mythic.ui },
    { engine: 'caldera' as const, endpoint: endpoints.engines.caldera.ui }
  ]
  for (const primary of primaries) {
    eventBus.publish('engine.endpoint.resolved', {
      engine: primary.engine,
      host: primary.endpoint.host,
      port: primary.endpoint.port
    })
  }
  eventBus.publish('octopod.started', { startedAtEpochMs: Date.now() })
  let stopPublished = false
  let healthLoop: EngineHealthLoopHandle | undefined
  return {
    ganglion,
    endpoints,
    ganglionRuntime,
    startHealthLoop(input: {
      fetchLike: OctopodProbeFetchLike
      intervalMs: number
      timeoutMs?: number
      onLoopError?: (error: unknown) => void
    }) {
      // One loop per daemon: a second call would double the event rate.
      if (healthLoop !== undefined) {
        return healthLoop
      }
      healthLoop = startEngineHealthLoop({
        bus: eventBus,
        endpoints,
        fetchLike: input.fetchLike,
        intervalMs: input.intervalMs,
        timeoutMs: input.timeoutMs,
        onLoopError: input.onLoopError
      })
      return healthLoop
    },
    stop(reason = 'octopodMain.stop invoked') {
      if (stopPublished) {
        return
      }
      stopPublished = true
      eventBus.publish('octopod.stopped', { reason })
    }
  }
}
