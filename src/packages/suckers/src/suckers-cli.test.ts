import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { noopSuckerProcess } from './sucker-broker'
import { runSuckersCli } from './suckers-cli'

const manifest = {
  id: 'enrichment-feed-demo',
  version: '1.2.3',
  kind: 'enrichment-feed',
  permissions: [{ resourceKind: 'ioc-record', action: 'query' }],
  isolation: { tier: 'shed-scratch' },
  egress: [{ capability: 'external.host-noise', purpose: 'noise context' }],
  publisher: { id: 'example-publisher', signingKeyId: 'key-123' }
}

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function writeManifestFile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'suckers-cli-'))
  tempDirs.push(dir)
  const file = join(dir, 'manifest.json')
  writeFileSync(file, JSON.stringify(manifest))
  return file
}

/** Per-test state file so CLI invocations share state without leaking across tests. */
function statePathFor(): string {
  const dir = mkdtempSync(join(tmpdir(), 'suckers-cli-state-'))
  tempDirs.push(dir)
  return join(dir, 'state.json')
}

function capturingIo() {
  const outLines: string[] = []
  const errLines: string[] = []
  return {
    out: (line: string) => outLines.push(line),
    err: (line: string) => errLines.push(line),
    outLines,
    errLines
  }
}

describe('runSuckersCli', () => {
  it('defaults to the NOOP process adapter and proves the run wiring', async () => {
    const file = writeManifestFile()
    const statePath = statePathFor()
    const io = capturingIo()
    expect(await runSuckersCli({ argv: ['install', file], statePath, ...io })).toBe(0)
    expect(io.outLines.at(-1)).toContain('installed enrichment-feed-demo@1.2.3')
    expect(
      await runSuckersCli({
        argv: ['run', 'enrichment-feed-demo', 'external.host-noise'],
        statePath,
        ...io
      })
    ).toBe(0)
    expect(io.outLines.at(-1)).toContain('empty external.host-noise')
    expect(await runSuckersCli({ argv: ['list'], statePath, ...io })).toBe(0)
    expect(
      io.outLines.some(
        (line) => line.includes('granted') && line.includes('enrichment-feed-demo@1.2.3')
      )
    ).toBe(true)
  })

  it('passes --json-args through to the process adapter after the grant check', async () => {
    const file = writeManifestFile()
    const statePath = statePathFor()
    const calls: { args: readonly string[] }[] = []
    const io = capturingIo()
    await runSuckersCli({ argv: ['install', file], statePath, ...io })
    const code = await runSuckersCli({
      argv: [
        'run',
        'enrichment-feed-demo',
        'external.host-noise',
        '--json-args',
        '["-q","1.2.3.4"]'
      ],
      statePath,
      spawn: async (request) => {
        calls.push({ args: request.args })
        return noopSuckerProcess(request)
      },
      ...io
    })
    expect(code).toBe(0)
    expect(calls).toEqual([{ args: ['-q', '1.2.3.4'] }])
  })

  it('denies run before install or after revoke (exit 3, no spawn)', async () => {
    const file = writeManifestFile()
    const statePath = statePathFor()
    const io = capturingIo()
    let spawned = false
    const spawn = async () => {
      spawned = true
      return { exitCode: 0, timedOut: false, durationMs: 0, stdout: '', stderr: '' }
    }
    expect(
      await runSuckersCli({
        argv: ['run', 'enrichment-feed-demo', 'external.host-noise'],
        statePath,
        spawn,
        ...io
      })
    ).toBe(3)
    expect(spawned).toBe(false)
    await runSuckersCli({ argv: ['install', file], statePath, ...io })
    expect(
      await runSuckersCli({ argv: ['revoke', 'enrichment-feed-demo'], statePath, ...io })
    ).toBe(0)
    expect(
      await runSuckersCli({
        argv: ['run', 'enrichment-feed-demo', 'external.host-noise'],
        statePath,
        spawn,
        ...io
      })
    ).toBe(3)
    expect(io.errLines.some((line) => line.includes('DENIED'))).toBe(true)
    expect(spawned).toBe(false)
  })

  it('rejects invalid manifests and malformed --json-args with usage errors', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'suckers-cli-'))
    tempDirs.push(dir)
    const badFile = join(dir, 'bad.json')
    writeFileSync(badFile, JSON.stringify({ ...manifest, kind: 'custom' }))
    const statePath = statePathFor()
    const io = capturingIo()
    expect(await runSuckersCli({ argv: ['install', badFile], statePath, ...io })).toBe(2)
    expect(io.errLines.at(-1)).toContain('manifest rejected')
    expect(await runSuckersCli({ argv: ['install'], statePath, ...io })).toBe(2)
    expect(
      await runSuckersCli({ argv: ['install', join(dir, 'missing.json')], statePath, ...io })
    ).toBe(2)

    const file = writeManifestFile()
    await runSuckersCli({ argv: ['install', file], statePath, ...io })
    expect(
      await runSuckersCli({
        argv: ['run', 'enrichment-feed-demo', 'external.host-noise', '--json-args', '{not-json}'],
        statePath,
        ...io
      })
    ).toBe(2)
    expect(
      await runSuckersCli({
        argv: [
          'run',
          'enrichment-feed-demo',
          'external.host-noise',
          '--json-args',
          '{"not":"array"}'
        ],
        statePath,
        ...io
      })
    ).toBe(2)
  })

  it('persists revoke across invocations and denies revoked suckers from a cold start', async () => {
    const file = writeManifestFile()
    const statePath = statePathFor()
    const io = capturingIo()
    await runSuckersCli({ argv: ['install', file], statePath, ...io })
    await runSuckersCli({ argv: ['revoke', 'enrichment-feed-demo'], statePath, ...io })
    const fresh = capturingIo()
    expect(await runSuckersCli({ argv: ['list'], statePath, ...fresh })).toBe(0)
    expect(
      fresh.outLines.some(
        (line) => line.includes('revoked') && line.includes('enrichment-feed-demo@1.2.3')
      )
    ).toBe(true)
    let spawned = false
    expect(
      await runSuckersCli({
        argv: ['run', 'enrichment-feed-demo', 'external.host-noise'],
        statePath,
        spawn: async () => {
          spawned = true
          return { exitCode: 0, timedOut: false, durationMs: 0, stdout: '', stderr: '' }
        },
        ...fresh
      })
    ).toBe(3)
    expect(spawned).toBe(false)
  })

  it('prints usage for unknown commands', async () => {
    const io = capturingIo()
    expect(await runSuckersCli({ argv: ['transmogrify'], ...io })).toBe(2)
    expect(io.errLines.at(-1)).toContain('usage: suckers')
  })
})
