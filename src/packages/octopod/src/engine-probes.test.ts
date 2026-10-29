import { describe, expect, it, vi } from 'vitest'

import { engineConfigFromEnv } from '@shield/engine-contracts'

import {
  ENGINE_PROBE_DESCRIPTORS,
  probeEngine,
  probeEnginesOnce,
  startEngineHealthLoop,
  type EngineProbeDescriptor,
  type OctopodProbeFetchLike
} from './engine-probes'
import { createLocalOctopodEventBus } from './local-event-bus'
import type { OctopodEndpoints } from './octopod-main'

const endpoints: OctopodEndpoints = engineConfigFromEnv({})

const descriptorFor = (engine: string): EngineProbeDescriptor => {
  const descriptor = ENGINE_PROBE_DESCRIPTORS.find((item) => item.engine === engine)
  if (descriptor === undefined) {
    throw new Error(`no probe descriptor for ${engine}`)
  }
  return descriptor
}

describe('probeEngine', () => {
  it('any-response rule: a 401 auth challenge still proves reachability (caldera, wazuh)', async () => {
    const fetchLike: OctopodProbeFetchLike = async () => ({ status: 401 })
    for (const engine of ['caldera', 'wazuh']) {
      const result = await probeEngine(descriptorFor(engine), endpoints, fetchLike)
      expect(result.healthy).toBe(true)
      expect(result.observedStatus).toBe(401)
      expect(result.detail).toBe('HTTP 401')
      expect(result.engine).toBe(engine)
    }
  })

  it('any-response rule: probe URLs hit the live-verified routes', async () => {
    const seen: string[] = []
    const fetchLike: OctopodProbeFetchLike = async (probeUrl) => {
      seen.push(probeUrl)
      return { status: 200 }
    }
    await probeEngine(descriptorFor('caldera'), endpoints, fetchLike)
    await probeEngine(descriptorFor('wazuh'), endpoints, fetchLike)
    expect(seen).toEqual(['http://localhost:8890/api/v2/health', 'https://localhost:55000/'])
  })

  it('exact-status rule: 200 is healthy (mythic /graphql/, nucleus /healthz)', async () => {
    const seen: string[] = []
    const fetchLike: OctopodProbeFetchLike = async (probeUrl) => {
      seen.push(probeUrl)
      return { status: 200 }
    }
    for (const engine of ['mythic', 'nucleus']) {
      const result = await probeEngine(descriptorFor(engine), endpoints, fetchLike)
      expect(result.healthy).toBe(true)
      expect(result.detail).toBe('HTTP 200')
    }
    expect(seen).toEqual(['https://localhost:7443/graphql/', 'http://localhost:8222/healthz'])
  })

  it('exact-status rule: a wrong status is unhealthy and names the rule', async () => {
    const fetchLike: OctopodProbeFetchLike = async () => ({ status: 500 })
    const result = await probeEngine(descriptorFor('mythic'), endpoints, fetchLike)
    expect(result.healthy).toBe(false)
    expect(result.observedStatus).toBe(500)
    expect(result.detail).toContain('exact-status')
  })

  it('timeout abort path: no HTTP answer in time -> unhealthy with a null status', async () => {
    const fetchLike: OctopodProbeFetchLike = (_probeUrl, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason ?? new Error('aborted')))
      })
    const result = await probeEngine(descriptorFor('caldera'), endpoints, fetchLike, { timeoutMs: 25 })
    expect(result.healthy).toBe(false)
    expect(result.observedStatus).toBeNull()
    expect(result.detail).toContain('no HTTP response')
  })

  it('a rejected transport surfaces as unhealthy, never as a thrown error', async () => {
    const fetchLike: OctopodProbeFetchLike = async () => {
      throw new Error('ECONNREFUSED')
    }
    const result = await probeEngine(descriptorFor('nucleus'), endpoints, fetchLike)
    expect(result.healthy).toBe(false)
    expect(result.observedStatus).toBeNull()
    expect(result.detail).toContain('ECONNREFUSED')
  })
})

describe('probeEnginesOnce', () => {
  it('probes all four descriptors in one pass', async () => {
    const fetchLike: OctopodProbeFetchLike = async (probeUrl) => ({
      status: probeUrl.includes('/graphql/') || probeUrl.includes('/healthz') ? 200 : 401
    })
    const results = await probeEnginesOnce({ endpoints, fetchLike })
    expect(results.map((result) => result.engine)).toEqual(['caldera', 'wazuh', 'mythic', 'nucleus'])
    expect(results.every((result) => result.healthy)).toBe(true)
  })
})

describe('startEngineHealthLoop', () => {
  it('publishes engine.health for every descriptor each pass, and stop() ends publishing', async () => {
    vi.useFakeTimers()
    try {
      const bus = createLocalOctopodEventBus()
      const healthEvents: { engine: string; healthy: boolean }[] = []
      bus.subscribe('engine.health', (event) => healthEvents.push({ engine: event.payload.engine, healthy: event.payload.healthy }))

      const handle = startEngineHealthLoop({
        bus,
        endpoints,
        fetchLike: async () => ({ status: 200 }),
        intervalMs: 1_000
      })

      await vi.advanceTimersByTimeAsync(1)
      expect(healthEvents).toHaveLength(4)

      await vi.advanceTimersByTimeAsync(1_000)
      expect(healthEvents).toHaveLength(8)
      expect(healthEvents.every((event) => event.healthy)).toBe(true)

      handle.stop()
      await vi.advanceTimersByTimeAsync(60_000)
      expect(healthEvents).toHaveLength(8)
    } finally {
      vi.useRealTimers()
    }
  })

  it('a failing pass is fail-visible: unhealthy events still publish and the loop survives', async () => {
    vi.useFakeTimers()
    try {
      const bus = createLocalOctopodEventBus()
      const healthEvents: Array<{ healthy: boolean; observedStatus: number | null }> = []
      bus.subscribe('engine.health', (event) =>
        healthEvents.push({ healthy: event.payload.healthy, observedStatus: event.payload.observedStatus })
      )

      const handle = startEngineHealthLoop({
        bus,
        endpoints,
        fetchLike: async () => {
          throw new Error('engine socket gone')
        },
        intervalMs: 500
      })

      await vi.advanceTimersByTimeAsync(1)
      await vi.advanceTimersByTimeAsync(500)
      expect(healthEvents).toHaveLength(8)
      expect(healthEvents.every((health) => health.healthy === false && health.observedStatus === null)).toBe(true)

      handle.stop()
    } finally {
      vi.useRealTimers()
    }
  })
})
