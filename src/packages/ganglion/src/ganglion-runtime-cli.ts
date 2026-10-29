#!/usr/bin/env node
import { seedDefaultGanglionRegistry } from './ganglion-registry'
import { GanglionRuntime } from './runtime'
import type { GanglionRuntimeEventSink } from './ganglion-runtime-events'
import type { SubagentExecutor, SubagentTask } from './ganglion-subagent'

export type GanglionRuntimeCliOptions = {
  argv: readonly string[]
  out?: (line: string) => void
  err?: (line: string) => void
  /** Executor override (tests inject fakes); default is the NOOP executor proving the wiring. */
  executor?: SubagentExecutor
  /** Runtime override (tests inject their own graph + queue state). */
  runtime?: GanglionRuntime
}

const USAGE = 'usage: ganglion-runtime status | spawn <tentacle> <title> [--prompt=<text>]'

type ParsedCommand = {
  command: string
  positional: string[]
  flags: Map<string, string | true>
}

const parseCommand = (argv: readonly string[]): ParsedCommand => {
  const flags = new Map<string, string | true>()
  const positional: string[] = []
  let command = ''
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (token.startsWith('--')) {
      const body = token.slice(2)
      const equals = body.indexOf('=')
      if (equals !== -1) {
        flags.set(body.slice(0, equals), body.slice(equals + 1))
      } else {
        flags.set(body, true)
      }
      continue
    }
    if (command.length === 0) {
      command = token
    } else {
      positional.push(token)
    }
  }
  return { command, positional, flags }
}

/**
 * NOOP executor: proves the spawn -> delegate -> complete wiring without real agents.
 * Prints the task it received and resolves completed immediately.
 */
const createNoopExecutor =
  (out: (line: string) => void): SubagentExecutor =>
  async (tentacle, task) => {
    out(
      `noop executor: tentacle=${tentacle} task=${task.id} title="${task.title}" prompt="${task.prompt}"`
    )
    return {
      sessionId: `noop:${task.id}`,
      status: 'completed',
      detail: 'noop executor (no real agent session)'
    }
  }

const printingEventSink = (out: (line: string) => void): GanglionRuntimeEventSink => ({
  publish: (type, payload) => out(`event ${type} ${JSON.stringify(payload)}`)
})

export const createDefaultGanglionRuntime = (options?: {
  executor?: SubagentExecutor
  events?: GanglionRuntimeEventSink
  out?: (line: string) => void
}): GanglionRuntime => {
  const out = options?.out ?? defaultOut
  return new GanglionRuntime({
    registry: seedDefaultGanglionRegistry(),
    executor: options?.executor ?? createNoopExecutor(out),
    events: options?.events ?? printingEventSink(out)
  })
}

export async function runGanglionRuntimeCli(options: GanglionRuntimeCliOptions): Promise<number> {
  const out = options.out ?? defaultOut
  const err = options.err ?? defaultErr
  const runtime =
    options.runtime ?? createDefaultGanglionRuntime({ executor: options.executor, out })
  const parsed = parseCommand(options.argv)

  if (parsed.command === 'status') {
    return runStatus(runtime, out)
  }

  if (parsed.command === 'spawn') {
    const [tentacle, title] = parsed.positional
    if (tentacle === undefined || title === undefined) {
      err(USAGE)
      return 2
    }
    const promptFlag = parsed.flags.get('prompt')
    const prompt = typeof promptFlag === 'string' ? promptFlag : `task: ${title}`
    return runSpawn(
      runtime,
      out,
      err,
      { id: `cli-${process.pid}-${Date.now()}`, title, prompt },
      tentacle
    )
  }

  err(USAGE)
  return 2
}

const runStatus = (runtime: GanglionRuntime, out: (line: string) => void): number => {
  const snapshot = runtime.snapshot()
  out(
    `graph tentacles=${snapshot.registry.tentacles.size} nodes=${snapshot.registry.graph.nodes.size} edges=${snapshot.registry.graph.edges.length}`
  )
  for (const tentacle of snapshot.registry.tentacles.values()) {
    out(`tentacle ${tentacle.name} id=${tentacle.id} nodes=${tentacle.nodes.length}`)
  }
  for (const edge of snapshot.registry.graph.edges) {
    out(`edge ${edge.source} -${edge.kind}-> ${edge.target}`)
  }
  for (const task of snapshot.tasks) {
    out(
      `task ${task.taskId} state=${task.state} tentacle=${task.tentacle} node=${task.nodeId} session=${task.sessionId ?? '-'}`
    )
  }
  for (const [tentacle, count] of Object.entries(snapshot.runningCountByTentacle)) {
    out(`running ${tentacle} count=${count} cap-in-use`)
  }
  for (const [tentacle, depth] of Object.entries(snapshot.queueDepthByTentacle)) {
    out(`queue ${tentacle} depth=${depth}`)
  }
  if (snapshot.tasks.length === 0) {
    out('queue (empty)')
  }
  return 0
}

const runSpawn = async (
  runtime: GanglionRuntime,
  out: (line: string) => void,
  err: (line: string) => void,
  task: SubagentTask,
  tentacle: string
): Promise<number> => {
  try {
    const spawned = runtime.spawn(tentacle, task)
    const placement = spawned.queued
      ? `queueDepth=${String(spawned.queueDepth)}`
      : `node=${spawned.record.nodeId}`
    out(
      `ganglion-runtime: spawn ${tentacle} "${task.title}" taskId=${task.id} queued=${String(spawned.queued)} ${placement}`
    )
    out(`audit ${JSON.stringify(spawned.audit)}`)
    if (spawned.queued) {
      out('ganglion-runtime: task is queued (concurrency cap full); it completes when a slot frees')
      return 0
    }
    await Promise.resolve()
    const record = spawned.record.sessionId
    if (record === undefined) {
      err('ganglion-runtime: executor did not report a sessionId; nothing to complete')
      return 1
    }
    const completion = runtime.onComplete(record, { status: 'completed' })
    out(
      `ganglion-runtime: completed ${completion.record.taskId} session=${completion.record.sessionId ?? '-'} status=${String(completion.record.status)}`
    )
    if (completion.audit !== null) {
      out(`audit ${JSON.stringify(completion.audit)}`)
    }
    return 0
  } catch (error) {
    err(`ganglion-runtime: ${error instanceof Error ? error.message : String(error)}`)
    return 2
  }
}

const defaultOut = (line: string): void => {
  process.stdout.write(`${line}\n`)
}
const defaultErr = (line: string): void => {
  process.stderr.write(`${line}\n`)
}

if (
  process.argv[1]?.endsWith('ganglion-runtime-cli.js') ||
  process.argv[1]?.endsWith('ganglion-runtime-cli.ts')
) {
  void runGanglionRuntimeCli({ argv: process.argv.slice(2) }).then((code) => {
    process.exitCode = code
  })
}
