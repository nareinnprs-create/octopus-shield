import { describe, expect, it } from 'vitest'

import { seedDefaultGanglionRegistry } from './ganglion-registry'
import { GanglionRuntime } from './runtime'
import type { SubagentExecution } from './ganglion-subagent'
import { createDefaultGanglionRuntime, runGanglionRuntimeCli } from './ganglion-runtime-cli'

const collector = (): { lines: string[]; write: (line: string) => void } => {
  const lines: string[] = []
  return { lines, write: (line: string) => lines.push(line) }
}

describe('runGanglionRuntimeCli — status', () => {
  it('prints graph and queue state over the default seeded runtime', async () => {
    const { lines, write } = collector()
    const code = await runGanglionRuntimeCli({ argv: ['status'], out: write })

    expect(code).toBe(0)
    expect(lines[0]).toBe('graph tentacles=7 nodes=7 edges=0')
    expect(lines.some((line) => line.startsWith('tentacle Forge id=tentacle:forge'))).toBe(true)
    expect(lines.some((line) => line.includes('queue (empty)'))).toBe(true)
  })

  it('reflects a runtime injected by tests, including its queue state', async () => {
    const { lines, write } = collector()
    const hangingExecutor = async (): Promise<SubagentExecution> =>
      new Promise<SubagentExecution>(() => {})
    const runtime = new GanglionRuntime({
      registry: seedDefaultGanglionRegistry(),
      executor: hangingExecutor
    })
    runtime.spawn('Forge', { id: 'run-1', title: 'Running task', prompt: 'p' })
    runtime.spawn('Forge', { id: 'run-2', title: 'Queued task', prompt: 'p' })

    const code = await runGanglionRuntimeCli({ argv: ['status'], out: write, runtime })

    expect(code).toBe(0)
    expect(lines.some((line) => line.includes('task run-1 state=running tentacle=Forge'))).toBe(
      true
    )
    expect(lines.some((line) => line.includes('task run-2 state=queued tentacle=Forge'))).toBe(true)
    expect(lines.some((line) => line.includes('running Forge count=1'))).toBe(true)
    expect(lines.some((line) => line.includes('queue Forge depth=1'))).toBe(true)
  })
})

describe('runGanglionRuntimeCli — spawn (NOOP executor)', () => {
  it('drives spawn -> delegate -> complete and prints events plus audits', async () => {
    const { lines, write } = collector()
    const code = await runGanglionRuntimeCli({
      argv: ['spawn', 'Forge', 'Wire the ganglion', '--prompt=prove the wiring'],
      out: write
    })

    expect(code).toBe(0)
    expect(
      lines.some(
        (line) =>
          line.includes('noop executor: tentacle=Forge') && line.includes('prove the wiring')
      )
    ).toBe(true)
    expect(lines.some((line) => line.startsWith('event ganglion.tentacle.spawned'))).toBe(true)
    expect(lines.some((line) => line.startsWith('event ganglion.task.completed'))).toBe(true)
    expect(
      lines.some((line) => line.includes('queued=false') && line.includes('node=ganglion:task:'))
    ).toBe(true)
    expect(lines.filter((line) => line.startsWith('audit '))).toHaveLength(2)
    expect(
      lines.some((line) => line.includes('status=completed') && line.includes('session=noop:'))
    ).toBe(true)
  })

  it('reports the queued path without a completion when the cap is full', async () => {
    const { lines, write } = collector()
    const hangingExecutor = async (): Promise<SubagentExecution> =>
      new Promise<SubagentExecution>(() => {})
    const runtime = createDefaultGanglionRuntime({ executor: hangingExecutor, out: write })
    runtime.spawn('Forge', { id: 'occupied', title: 'Occupying', prompt: 'p' })

    const code = await runGanglionRuntimeCli({
      argv: ['spawn', 'Forge', 'Second task'],
      out: write,
      runtime
    })

    expect(code).toBe(0)
    expect(lines.some((line) => line.startsWith('event ganglion.task.queued'))).toBe(true)
    expect(lines.some((line) => line.includes('queued=true queueDepth=1'))).toBe(true)
    expect(lines.some((line) => line.includes('it completes when a slot frees'))).toBe(true)
    expect(lines.some((line) => line.startsWith('event ganglion.task.completed'))).toBe(false)
  })

  it('exits 2 for an unregistered Tentacle name', async () => {
    const { lines: out, write } = collector()
    const { lines: err, write: errWrite } = collector()
    const code = await runGanglionRuntimeCli({
      argv: ['spawn', 'Kraken', 'Nope'],
      out: write,
      err: errWrite
    })

    expect(code).toBe(2)
    expect(err[0]).toContain('requires a registered Tentacle: Kraken')
    expect(out.some((line) => line.startsWith('event ganglion.tentacle.spawned'))).toBe(false)
  })

  it('exits 2 with usage when arguments are missing or unknown', async () => {
    const { lines: err, write: errWrite } = collector()
    expect(await runGanglionRuntimeCli({ argv: ['spawn', 'Forge'], err: errWrite })).toBe(2)
    expect(await runGanglionRuntimeCli({ argv: [], err: errWrite })).toBe(2)
    expect(await runGanglionRuntimeCli({ argv: ['teleport', 'Forge'], err: errWrite })).toBe(2)
    expect(err.filter((line) => line.startsWith('usage: ganglion-runtime'))).toHaveLength(3)
  })
})
