import type { EngineId } from '@shield/engine-contracts'
import type { EngineProbeRef, OctopodEventBus } from './octopod-events'
import type { OctopodEndpoints } from './octopod-main'

/**
 * Probe descriptors encode ONLY live-verified fabric behavior (operator probes, 2026-10):
 * - caldera  GET {api}/api/v2/health -> 401 without a KEY (route verified: engines/caldera/app/api/v2/handlers/health_api.py:18).
 *            Any HTTP response proves the engine process is reachable -> any-response rule, 401 expected without key.
 * - wazuh    GET {managerApi}/ (root) -> 401 without auth. Root-answer rule: any HTTP response -> reachable, 401 expected unauthenticated.
 * - mythic   GET {ui}/graphql/ -> 200 (nginx front: engines/mythic/nginx-docker/config/conf.d/services.conf).
 * - nucleus  GET {natsMonitor}/healthz -> {"status":"ok"} 200 (infra/docker-compose.nucleus.yml `-js -m 8222`).
 *
 * Caldera has no TLS contact in its 5.0 source (engines/caldera/app/contacts/*, no tls class; no tls refs in server.py);
 * the API probe target is plain http 8890. https://18443 handshake is dead live (TLS fronting is a later reverse-proxy job).
 */
export type EngineProbeBehavior = {
  /** Auth challenges (401) count as reachable; engines answer with an auth error before any health payload. */
  anyResponseCounts?: boolean
  exactStatuses?: readonly number[]
}

export type EngineProbeDescriptor = {
  engine: EngineProbeRef
  probeUrl: (endpoints: OctopodEndpoints) => string
  behavior: EngineProbeBehavior
}

const engineHttpTarget = (endpoint: { protocol: 'http' | 'https'; host: string; port: number }, path: string): string =>
  `${endpoint.protocol}://${endpoint.host}:${endpoint.port}${path}`

export const ENGINE_PROBE_DESCRIPTORS: readonly EngineProbeDescriptor[] = [
  {
    engine: 'caldera',
    probeUrl: (endpoints) => engineHttpTarget(endpoints.engines.caldera.api, '/api/v2/health'),
    behavior: { anyResponseCounts: true }
  },
  {
    engine: 'wazuh',
    probeUrl: (endpoints) => engineHttpTarget(endpoints.engines.wazuh.managerApi, '/'),
    behavior: { anyResponseCounts: true }
  },
  {
    engine: 'mythic',
    probeUrl: (endpoints) => engineHttpTarget(endpoints.engines.mythic.ui, '/graphql/'),
    behavior: { exactStatuses: [200] }
  },
  {
    engine: 'nucleus',
    probeUrl: (endpoints) => engineHttpTarget(endpoints.nucleus.natsMonitor, '/healthz'),
    behavior: { exactStatuses: [200] }
  }
]

export type OctopodProbeResponse = { readonly status: number }

export type OctopodProbeFetchLike = (
  probeUrl: string,
  init?: { signal?: AbortSignal }
) => Promise<OctopodProbeResponse>

export type EngineProbeResult = {
  engine: EngineProbeRef
  probeUrl: string
  healthy: boolean
  observedStatus: number | null
  detail: string
}

const behaviorKey = (behavior: EngineProbeBehavior): 'any-response' | 'exact-status' =>
  behavior.anyResponseCounts === true ? 'any-response' : 'exact-status'

const isProbeHealthy = (behavior: EngineProbeBehavior, status: number): boolean =>
  behavior.anyResponseCounts === true || (behavior.exactStatuses?.includes(status) ?? false)

export async function probeEngine(
  descriptor: EngineProbeDescriptor,
  endpoints: OctopodEndpoints,
  fetchLike: OctopodProbeFetchLike,
  options?: { timeoutMs?: number }
): Promise<EngineProbeResult> {
  const probeUrl = descriptor.probeUrl(endpoints)
  try {
    const init = options?.timeoutMs === undefined ? undefined : { signal: AbortSignal.timeout(options.timeoutMs) }
    const response = await fetchLike(probeUrl, init)
    const healthy = isProbeHealthy(descriptor.behavior, response.status)
    return {
      engine: descriptor.engine,
      probeUrl,
      healthy,
      observedStatus: response.status,
      detail: healthy ? `HTTP ${response.status}` : `HTTP ${response.status} failed the ${behaviorKey(descriptor.behavior)} rule`
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    return { engine: descriptor.engine, probeUrl, healthy: false, observedStatus: null, detail: `no HTTP response: ${reason}` }
  }
}

export async function probeEnginesOnce(input: {
  endpoints: OctopodEndpoints
  fetchLike: OctopodProbeFetchLike
  timeoutMs?: number
}): Promise<readonly EngineProbeResult[]> {
  return Promise.all(
    ENGINE_PROBE_DESCRIPTORS.map((descriptor) =>
      probeEngine(descriptor, input.endpoints, input.fetchLike, { timeoutMs: input.timeoutMs })
    )
  )
}

export type EngineHealthLoopHandle = { stop(): void }

/** Serial passes; a failed pass never kills the loop (fail-visible: the next pass re-reports). */
export function startEngineHealthLoop(input: {
  bus: OctopodEventBus
  endpoints: OctopodEndpoints
  fetchLike: OctopodProbeFetchLike
  intervalMs: number
  timeoutMs?: number
  onLoopError?: (error: unknown) => void
}): EngineHealthLoopHandle {
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined

  const reportPass = async (): Promise<void> => {
    const results = await probeEnginesOnce({
      endpoints: input.endpoints,
      fetchLike: input.fetchLike,
      timeoutMs: input.timeoutMs
    })
    if (stopped) {
      return
    }
    const probedAtEpochMs = Date.now()
    for (const result of results) {
      input.bus.publish('engine.health', {
        engine: result.engine,
        healthy: result.healthy,
        evidence: 'http-status-only',
        observedStatus: result.observedStatus,
        detail: result.detail,
        probeUrl: result.probeUrl,
        probedAtEpochMs
      })
    }
  }

  const schedule = (): void => {
    if (stopped) {
      return
    }
    timer = setTimeout(() => {
      void reportPass()
        .catch((error) => input.onLoopError?.(error))
        .finally(schedule)
    }, input.intervalMs)
  }

  void reportPass()
    .catch((error) => input.onLoopError?.(error))
    .finally(schedule)

  return {
    stop(): void {
      stopped = true
      if (timer !== undefined) {
        clearTimeout(timer)
      }
    }
  }
}
