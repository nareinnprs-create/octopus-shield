#!/usr/bin/env node
import { engineConfigFromEnv, type EngineEnvLike } from '@shield/engine-contracts'
import { createLocalOctopodEventBus } from './local-event-bus'
import { connectNatsEventBus, type NatsEventBus } from './nats-event-bus'
import { probeEnginesOnce, type EngineProbeResult, type OctopodProbeFetchLike } from './engine-probes'
import { createNodeProbeFetchLike } from './node-probe-fetch'
import { octopodMain } from './octopod-main'
import { OCTOPOD_EVENT_TYPES, type OctopodEvent } from './octopod-events'

export type OctopodCliOptions = {
  argv: readonly string[]
  env: EngineEnvLike
  out?: (line: string) => void
  err?: (line: string) => void
  /** Probe transport override (tests inject fakes); default is the runtime `fetch` global. */
  probeFetchLike?: OctopodProbeFetchLike
  /** NATS connect override (tests inject a fake); default adapters the `nats` package connection. */
  connectNats?: (servers: readonly string[]) => Promise<NatsEventBus>
}

const DEFAULT_PROBE_TIMEOUT_MS = 5_000
const DEFAULT_HEALTH_INTERVAL_MS = 30_000

const defaultProbeFetchLike: OctopodProbeFetchLike = createNodeProbeFetchLike()

const formatResult = (result: EngineProbeResult): string =>
  `${result.healthy ? 'HEALTHY' : 'DOWN   '} ${result.engine.padEnd(7)} HTTP ${String(result.observedStatus).padEnd(3)} ${result.detail} — ${result.probeUrl}`

const KNOWN_FLAGS = new Set(['--once'])

/** Exit codes: 0 all probes healthy (or daemon launch succeeded), 1 any probe down, 2 usage/launch failure. */
export async function runOctopodCli(options: OctopodCliOptions): Promise<number> {
  const out = options.out ?? defaultOut
  const err = options.err ?? defaultErr
  // Strict argv: a typo'd or malformed flag must fail loudly, never degrade into daemon mode.
  const unknown: string[] = []
  for (const raw of options.argv) {
    if (KNOWN_FLAGS.has(raw) || /^--lifetime-ms=\d+$/.test(raw)) {
      continue
    }
    unknown.push(raw)
  }
  const malformedLifetime = options.argv.some(
    (raw) => raw.startsWith('--lifetime-ms') && !/^--lifetime-ms=\d+$/.test(raw)
  )
  if (unknown.length > 0 || malformedLifetime || numericArg(options.argv, 'lifetime-ms') === undefined && options.argv.some((raw) => raw.startsWith('--lifetime-ms='))) {
    err(`octopod: unknown or malformed arguments: ${(unknown.length > 0 ? unknown.join(' ') : '--lifetime-ms')}`)
    err('usage: octopod [--once] [--lifetime-ms=<positive integer>]')
    return 2
  }
  if (options.argv.includes('--once')) {
    return runOnce(options, out)
  }
  return runDaemon(options, out, err)
}

async function runOnce(options: OctopodCliOptions, out: (line: string) => void): Promise<number> {
  const bus = createLocalOctopodEventBus()
  for (const type of OCTOPOD_EVENT_TYPES) {
    bus.subscribe(type, (event: OctopodEvent<typeof type>) => out(`event ${event.type} ${JSON.stringify(event.payload)}`))
  }
  const daemon = octopodMain({ eventBus: bus, env: options.env })
  const results = await probeEnginesOnce({
    endpoints: daemon.endpoints,
    fetchLike: options.probeFetchLike ?? defaultProbeFetchLike,
    timeoutMs: DEFAULT_PROBE_TIMEOUT_MS
  })
  for (const result of results) {
    out(formatResult(result))
  }
  daemon.stop('--once completed')
  return results.every((result) => result.healthy) ? 0 : 1
}

async function runDaemon(options: OctopodCliOptions, out: (line: string) => void, err: (line: string) => void): Promise<number> {
  const endpoints = engineConfigFromEnv(options.env)
  const natsClient = endpoints.nucleus.natsClient
  // Single-token auth (nats-server --auth); empty/absent only for auth-less servers.
  const natsToken = options.env.OSHIELD_NATS_TOKEN
  const servers = [`nats://${natsClient.host}:${natsClient.port}`]
  const connect =
    options.connectNats ??
    ((targets: readonly string[]) => connectNatsEventBus({ servers: targets, token: natsToken }))
  const bus = await connect(servers)
  const daemon = octopodMain({ eventBus: bus, env: options.env })
  // A silent daemon violates the loop's fail-visible contract: surface pass errors on stderr.
  let loopFailed = false
  const healthLoop = daemon.startHealthLoop({
    fetchLike: options.probeFetchLike ?? defaultProbeFetchLike,
    intervalMs: DEFAULT_HEALTH_INTERVAL_MS,
    timeoutMs: DEFAULT_PROBE_TIMEOUT_MS,
    onLoopError: (error) => {
      loopFailed = true
      err(`octopod health loop error: ${error instanceof Error ? error.message : String(error)}`)
    }
  })
  // Disconnect/reconnect and redelivery semantics are the nats client library's job; only shutdown is managed here.
  let lifetimeTimer: ReturnType<typeof setTimeout> | undefined
  let shuttingDown = false
  let exitCode = 0
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) {
      return
    }
    shuttingDown = true
    if (lifetimeTimer !== undefined) {
      clearTimeout(lifetimeTimer)
    }
    out(`octopod stopping (${signal})`)
    healthLoop.stop()
    daemon.stop(`received ${signal}`)
    if (loopFailed) {
      exitCode = 1
    }
    // A hung drain must not hang shutdown forever.
    await Promise.race([bus.close(), new Promise((resolveClose) => setTimeout(resolveClose, 5_000))])
    process.exit(exitCode)
  }
  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  // Windows delivers neither SIGINT nor SIGTERM to spawned children reliably; lifetime mode is the cross-platform graceful stop.
  const lifetimeMs = numericArg(options.argv, 'lifetime-ms')
  if (lifetimeMs !== undefined) {
    lifetimeTimer = setTimeout(() => void shutdown('lifetime elapsed'), lifetimeMs)
  }
  out(`octopod daemon up: events -> ${servers[0]} :: engine health every ${DEFAULT_HEALTH_INTERVAL_MS}ms`)
  return 0
}

const numericArg = (argv: readonly string[], name: string): number | undefined => {
  for (const raw of argv) {
    if (raw.startsWith(`--${name}=`)) {
      const value = Number.parseInt(raw.slice(name.length + 3), 10)
      if (Number.isSafeInteger(value) && value > 0) {
        return value
      }
    }
  }
  return undefined
}

const defaultOut = (line: string): void => {
  process.stdout.write(`${line}\n`)
}
const defaultErr = (line: string): void => {
  process.stderr.write(`${line}\n`)
}

// bin entry (dist/octopod-cli.js) or tsx source run (octopod-cli.ts).
if (process.argv[1]?.endsWith('octopod-cli.js') || process.argv[1]?.endsWith('octopod-cli.ts')) {
  void runOctopodCli({ argv: process.argv.slice(2), env: process.env }).then((code) => {
    process.exitCode = code
  })
}
