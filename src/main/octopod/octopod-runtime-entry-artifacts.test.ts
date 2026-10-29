// Child entries referenced by filename must ship beside octopod.js; bundling alone cannot include them.
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, expect, it } from 'vitest'
import { runProcessSync } from '@shield/process-host'
import { octopodArtifactFilenames } from '../../shared/octopod-artifacts'

const REPO_ROOT = join(__dirname, '..', '..', '..')
const RUNTIME_ENTRY_FILENAME = /[A-Za-z0-9_.-]+-(?:entry|worker)\.c?js/g
// Known gaps must disappear as entries ship or references are removed; additions are not exemptions.
const KNOWN_UNSHIPPED_ENTRIES = new Set(['wsl-transcript-fs-process-entry.js'])
const directory = mkdtempSync(join(tmpdir(), 'octopod-runtime-entries-'))

afterAll(() => {
  rmSync(directory, { recursive: true, force: true })
})

function buildOctopodBundles(): string[] {
  const builder = pathToFileURL(join(REPO_ROOT, 'config/scripts/octopod-entry-build.mjs')).href
  const script = `
    import { build } from 'esbuild'
    import { join } from 'node:path'
    import * as entries from ${JSON.stringify(builder)}
    const out = ${JSON.stringify(directory)}
    await entries.buildOctopodEntry(join(out, 'octopod.js'))
    await Promise.all(Object.values(entries.OCTOPOD_CHILD_ENTRY_POINTS).map((entry) => build({
      entryPoints: [entry], bundle: true, platform: 'node', target: 'node18', format: 'cjs',
      outfile: join(out, entries.octopodChildOutputFilename(entry)),
      external: entries.OCTOPOD_EXTERNAL_MODULES, plugins: [entries.externalNativeAddons],
      logLevel: 'error'
    })))`
  const built = runProcessSync({
    program: process.execPath,
    args: ['--input-type=module', '-e', script],
    cwd: REPO_ROOT,
    env: { ...process.env, OSHIELD_BACKGROUND_LAUNCH: '1' },
    timeoutMs: 120_000
  })
  expect(built.code, built.stderr.slice(0, 2_000)).toBe(0)
  return readdirSync(directory).map((file) => readFileSync(join(directory, file), 'utf8'))
}

it('ships every worker and child entry octopod loads at runtime', () => {
  const named = new Set(
    buildOctopodBundles().flatMap((text) => text.match(RUNTIME_ENTRY_FILENAME) ?? [])
  )
  const shipped = new Set(octopodArtifactFilenames('linux-x64-glibc', []))
  const missing = [...named].filter(
    (filename) => !shipped.has(filename) && !KNOWN_UNSHIPPED_ENTRIES.has(filename)
  )
  expect(missing, 'add these to OCTOPOD_ARTIFACTS and build them in build-octopod.mjs').toEqual([])
  for (const filename of KNOWN_UNSHIPPED_ENTRIES) {
    expect(named.has(filename) && !shipped.has(filename), filename).toBe(true)
  }
})

it('ships every child entry build-octopod.mjs builds', async () => {
  const builder = pathToFileURL(join(REPO_ROOT, 'config/scripts/octopod-entry-build.mjs')).href
  const entries = await import(builder)
  const shipped = new Set(octopodArtifactFilenames('linux-x64-glibc', []))
  const built = Object.values<string>(entries.OCTOPOD_CHILD_ENTRY_POINTS).map((entry) =>
    entries.octopodChildOutputFilename(entry)
  )
  expect(built).toContain('session-scanner-service-entry.js')
  expect(built.filter((filename) => !shipped.has(filename))).toEqual([])
})
