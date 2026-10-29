import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OCTOPOD_MOBILE_WEB_MANIFEST, octopodArtifactFilenames } from '../../shared/octopod-artifacts'
import { runOctopodProfilePreflight } from './octopod-profile-preflight'
import { readOctopodArtifactIdentity } from './octopod-artifact-identity'
import { resolveOctopodExitCode } from './octopod-exit-code'
import type * as BundledRuntime from './octopod-bundled-runtime'

const fixture = vi.hoisted(() => ({
  directory: '',
  sqlite: vi.fn(async () => ({ sqliteVersion: '3.53.2', revision: 1 }))
}))
vi.mock('./octopod-app-paths', () => ({ resolveOctopodInstallRoot: () => fixture.directory }))
vi.mock('../persistence/profile-state/profile-state-runtime-preflight', () => ({
  preflightProfileStateRuntime: fixture.sqlite
}))
vi.mock('./octopod-runtime-native-preflight', () => ({
  preflightOctopodNativeRuntime: vi.fn(async () => {})
}))
vi.mock('./octopod-bundled-runtime', async (importOriginal) => ({
  ...(await importOriginal<typeof BundledRuntime>()),
  isRunningAsBundledOctopodRuntime: () => false
}))

function fixtureContents(filename: string): string {
  if (filename === '.server-target') {
    return 'linux-x64-glibc\n'
  }
  return filename === OCTOPOD_MOBILE_WEB_MANIFEST
    ? JSON.stringify({ assets: [{ path: 'index.html' }] })
    : filename
}

beforeEach(async () => {
  fixture.directory = await mkdtemp(join(tmpdir(), 'octopod-artifact-preflight-'))
  for (const filename of octopodArtifactFilenames('linux-x64-glibc', ['out/mobile-web/index.html'])) {
    const path = join(fixture.directory, filename)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, fixtureContents(filename))
  }
  vi.spyOn(console, 'log').mockImplementation(() => {})
})
afterEach(async () => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
  await rm(fixture.directory, { recursive: true, force: true })
})

describe('installed artifact admission', () => {
  it('qualifies build output before its version marker is published', async () => {
    await runOctopodProfilePreflight(randomUUID())
    expect(fixture.sqlite).toHaveBeenCalledOnce()
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining(await readOctopodArtifactIdentity(fixture.directory))
    )
  })

  it.each([
    '.server-target',
    'node_modules/@parcel/watcher/watcher.node',
    '.runtime-node',
    'node_modules/node-pty/build/Release/pty.node',
    'out/mobile-web/index.html'
  ])('refuses a missing %s as configuration before any profile probe', async (filename) => {
    await rm(join(fixture.directory, filename))
    const error = await runOctopodProfilePreflight(randomUUID()).catch((failure: unknown) => failure)
    expect(resolveOctopodExitCode(error)).toBe(78)
    expect(fixture.sqlite).not.toHaveBeenCalled()
    expect(console.log).not.toHaveBeenCalled()
  })

  it('refuses a malformed target even though all named files exist', async () => {
    await writeFile(join(fixture.directory, '.server-target'), 'not-a-runtime-target')
    const error = await runOctopodProfilePreflight(randomUUID()).catch((failure: unknown) => failure)
    expect(resolveOctopodExitCode(error)).toBe(78)
    expect(fixture.sqlite).not.toHaveBeenCalled()
  })
})
