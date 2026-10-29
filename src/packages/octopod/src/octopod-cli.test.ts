import { afterEach, describe, expect, it, vi, type MockInstance } from 'vitest'

import type { OctopodProbeFetchLike } from './engine-probes'
import type { NatsEventBus } from './nats-event-bus'
import type { OctopodEvent, OctopodEventMap } from './octopod-events'
import { runOctopodCli } from './octopod-cli'

type RecordedNatsBus = NatsEventBus & { events: OctopodEvent[]; closeCount: number }

// SAFETY: test fake — runOctopodCli's daemon path only calls publish/subscribe/close on the bus,
// so a structural stand-in satisfies everything the CLI can do with an NatsEventBus.
const recordedNatsBus = (options: { engineHealthPublish: 'ok' | 'throw' } = { engineHealthPublish: 'ok' }): RecordedNatsBus => {
  const events: OctopodEvent[] = []
  const bus = {
    events,
    closeCount: 0,
    publish: (type: keyof OctopodEventMap & string, payload: OctopodEventMap[keyof OctopodEventMap]): void => {
      if (type === 'engine.health' && options.engineHealthPublish === 'throw') {
        throw new Error('nats down')
      }
      events.push({ type, payload, occurredAtEpochMs: 0 } as OctopodEvent)
    },
    subscribe: () => () => {},
    close: async (): Promise<void> => {
      bus.closeCount += 1
    }
  }
  return bus as unknown as RecordedNatsBus
}

const healthyFetch: OctopodProbeFetchLike = async (probeUrl) => ({
  status: probeUrl.includes('/graphql/') || probeUrl.includes('/healthz') ? 200 : 401
})

const collector = (): { lines: string[]; out: (line: string) => void } => {
  const lines: string[] = []
  return { lines, out: (line: string) => lines.push(line) }
}

describe('runOctopodCli — --once', () => {
  it('exits 0 when every engine passes its probe rule, echoing events and statuses', async () => {
    const { lines, out } = collector()
    const code = await runOctopodCli({ argv: ['--once'], env: {}, out, probeFetchLike: healthyFetch })
    expect(code).toBe(0)
    expect(lines.filter((line) => line.startsWith('HEALTHY'))).toHaveLength(4)
    expect(lines.filter((line) => line.startsWith('DOWN'))).toHaveLength(0)
    expect(lines.some((line) => line.startsWith('HEALTHY') && line.includes('caldera'))).toBe(true)
    expect(lines.some((line) => line.startsWith('HEALTHY') && line.includes('wazuh'))).toBe(true)
    expect(lines.some((line) => line.startsWith('HEALTHY') && line.includes('mythic'))).toBe(true)
    expect(lines.some((line) => line.startsWith('HEALTHY') && line.includes('nucleus'))).toBe(true)
    expect(lines.some((line) => line.includes('event octopod.stopped') && line.includes('--once completed'))).toBe(true)
    expect(lines.some((line) => line.startsWith('event ganglion.tentacle.registered'))).toBe(true)
  })

  it('exits 1 when any probe fails its rule (mythic 500)', async () => {
    const { lines, out } = collector()
    const degradedFetch: OctopodProbeFetchLike = async (probeUrl) => ({
      status: probeUrl.includes('/graphql/') ? 500 : 200
    })
    const code = await runOctopodCli({ argv: ['--once'], env: {}, out, probeFetchLike: degradedFetch })
    expect(code).toBe(1)
    expect(lines.filter((line) => line.startsWith('DOWN'))).toHaveLength(1)
    expect(lines.find((line) => line.startsWith('DOWN'))).toContain('mythic')
    expect(lines.filter((line) => line.startsWith('HEALTHY'))).toHaveLength(3)
  })
})

describe('runOctopodCli — argv validation', () => {
  it('exits 2 on an unknown flag and prints usage', async () => {
    const { lines: err, out: errWrite } = collector()
    const code = await runOctopodCli({ argv: ['--once', '--wat'], env: {}, err: errWrite })
    expect(code).toBe(2)
    expect(err[0]).toContain('--wat')
    expect(err.some((line) => line.includes('usage: octopod'))).toBe(true)
  })

  it('exits 2 on a bare unknown flag without --once', async () => {
    const { lines: err, out: errWrite } = collector()
    const code = await runOctopodCli({ argv: ['--bogus'], env: {}, err: errWrite })
    expect(code).toBe(2)
    expect(err[0]).toContain('--bogus')
  })

  it('exits 2 on a malformed --lifetime-ms value', async () => {
    for (const bad of ['--lifetime-ms=abc', '--lifetime-ms=', '--lifetime-ms=-5', '--lifetime-ms']) {
      const { lines: err, out: errWrite } = collector()
      const code = await runOctopodCli({ argv: [bad], env: {}, err: errWrite })
      expect(code).toBe(2)
      expect(err.some((line) => line.includes('usage: octopod'))).toBe(true)
    }
  })
})

describe('runOctopodCli — daemon mode', () => {
  let exitSpy: MockInstance

  const daemonEnv = {
    OSHIELD_NATS_CLIENT_HOST: '127.0.0.1',
    OSHIELD_NATS_CLIENT_PORT: '4222'
  }

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    process.removeAllListeners('SIGINT')
    process.removeAllListeners('SIGTERM')
  })

  it('connects NATS from the OSHIELD_* env, starts the health loop, and shuts down at lifetime end with exit 0', async () => {
    vi.useFakeTimers()
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    const { lines, out } = collector()
    const bus = recordedNatsBus()
    const connectNats = vi.fn(async () => bus)

    const code = await runOctopodCli({
      argv: ['--lifetime-ms=100'],
      env: daemonEnv,
      out,
      probeFetchLike: healthyFetch,
      connectNats
    })
    expect(code).toBe(0)
    expect(connectNats).toHaveBeenCalledWith(['nats://127.0.0.1:4222'])
    expect(lines.some((line) => line.includes('octopod daemon up') && line.includes('nats://127.0.0.1:4222'))).toBe(true)

    await vi.advanceTimersByTimeAsync(1)
    const healthEvents = bus.events.filter((event) => event.type === 'engine.health')
    expect(healthEvents).toHaveLength(4)

    await vi.advanceTimersByTimeAsync(150)
    expect(exitSpy).toHaveBeenCalledWith(0)
    expect(bus.closeCount).toBe(1)
    expect(lines.some((line) => line.startsWith('octopod stopping (lifetime elapsed)'))).toBe(true)
  })

  it('keeps auth out of the server URL: OSHIELD_NATS_TOKEN rides the connect options, not userinfo', async () => {
    vi.useFakeTimers()
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    const connectNats = vi.fn(async () => recordedNatsBus())

    await runOctopodCli({
      argv: ['--lifetime-ms=50'],
      env: { ...daemonEnv, OSHIELD_NATS_TOKEN: 's3cr3t-token' },
      probeFetchLike: healthyFetch,
      connectNats
    })
    expect(connectNats).toHaveBeenCalledWith(['nats://127.0.0.1:4222'])
    await vi.advanceTimersByTimeAsync(100)
  })

  it('surfaces a failing health pass on stderr and exits 1 at shutdown (fail-visible)', async () => {
    vi.useFakeTimers()
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    const { lines, out } = collector()
    const { lines: errLines, out: errWrite } = collector()
    const bus = recordedNatsBus({ engineHealthPublish: 'throw' })

    const code = await runOctopodCli({
      argv: ['--lifetime-ms=100'],
      env: daemonEnv,
      out,
      err: errWrite,
      probeFetchLike: healthyFetch,
      connectNats: async () => bus
    })
    expect(code).toBe(0)

    await vi.advanceTimersByTimeAsync(1)
    expect(errLines.some((line) => line.includes('octopod health loop error:') && line.includes('nats down'))).toBe(true)

    await vi.advanceTimersByTimeAsync(150)
    expect(exitSpy).toHaveBeenCalledWith(1)
  })
})
