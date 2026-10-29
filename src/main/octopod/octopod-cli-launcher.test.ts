import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runProcess } from '@shield/process-host'
import {
  OCTOPOD_CLI_ENTRY_FILENAME,
  OCTOPOD_WINDOWS_CLI_LAUNCHER_FILENAME
} from '../../shared/octopod-artifacts'
import {
  OCTOPOD_WINDOWS_CLI_LAUNCHER_CONFIG_FILENAME,
  getOctopodCliLauncherPath,
  prepareOctopodCliLauncher
} from './octopod-cli-launcher'

const roots = vi.hoisted(() => ({ install: '', profile: '' }))
vi.mock('./octopod-app-paths', () => ({
  resolveOctopodInstallRoot: () => roots.install,
  resolveUserDataPath: () => roots.profile
}))

let directory = ''
const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')!

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'shield-node-cli-'))
  roots.install = join(directory, "server ' slot")
  roots.profile = join(directory, "profile ' data")
})

afterEach(async () => {
  Object.defineProperty(process, 'platform', platformDescriptor)
  await rm(directory, { recursive: true, force: true })
})

async function writeCli(): Promise<void> {
  const path = join(roots.install, ...OCTOPOD_CLI_ENTRY_FILENAME.split('/'))
  await mkdir(dirname(path), { recursive: true })
  await writeFile(
    path,
    'console.log(JSON.stringify({profile:process.env.OSHIELD_USER_DATA_PATH, args:process.argv.slice(2), electron:process.env.ELECTRON_RUN_AS_NODE}))'
  )
}

describe('octopod profile CLI launcher', () => {
  it.skipIf(process.platform === 'win32')(
    'launches pinned Node with intact arguments and the execution host profile',
    async () => {
      await writeCli()
      await prepareOctopodCliLauncher()
      const launcher = getOctopodCliLauncherPath()
      expect(launcher).toBe(join(roots.profile, 'cli', 'bin', 'shield'))
      if (!launcher) {
        throw new Error('CLI launcher is missing')
      }
      const args = ['orchestration', 'send', 'a body\nwith "quotes" and $HOME']
      const launchers =
        process.platform === 'linux' ? [launcher, join(dirname(launcher), 'shield-ide')] : [launcher]
      for (const program of launchers) {
        const result = await runProcess({
          program,
          args,
          env: {
            ...process.env,
            OSHIELD_USER_DATA_PATH: '/another/owner',
            ELECTRON_RUN_AS_NODE: '1',
            NODE_OPTIONS: '--require /missing/inherited/preload'
          },
          timeoutMs: 5000
        })
        expect(result.code).toBe(0)
        expect(JSON.parse(result.stdout)).toEqual({ profile: roots.profile, args })
      }
    }
  )

  it.skipIf(process.platform === 'win32')(
    "passes a person's own Shield settings through, adding only the profile",
    async () => {
      const path = join(roots.install, ...OCTOPOD_CLI_ENTRY_FILENAME.split('/'))
      await mkdir(dirname(path), { recursive: true })
      await writeFile(
        path,
        "console.log(JSON.stringify(Object.fromEntries(Object.entries(process.env).filter(([key]) => key.startsWith('OSHIELD_')))))"
      )
      await prepareOctopodCliLauncher()
      const result = await runProcess({
        program: getOctopodCliLauncherPath()!,
        args: ['status'],
        env: {
          PATH: process.env.PATH,
          OSHIELD_ENVIRONMENT: 'other-server',
          OSHIELD_PAIRING_CODE: 'other-pairing'
        },
        timeoutMs: 5000
      })
      expect(result.code).toBe(0)
      expect(JSON.parse(result.stdout)).toEqual({
        OSHIELD_USER_DATA_PATH: roots.profile,
        OSHIELD_ENVIRONMENT: 'other-server',
        OSHIELD_PAIRING_CODE: 'other-pairing'
      })
    }
  )

  it.skipIf(process.platform === 'win32')(
    'refreshes the launcher when the host switches server slots',
    async () => {
      await writeCli()
      await prepareOctopodCliLauncher()
      roots.install = join(directory, 'updated server')
      await writeCli()
      await prepareOctopodCliLauncher()
      const launcher = getOctopodCliLauncherPath()
      if (!launcher) {
        throw new Error('CLI launcher is missing')
      }
      expect(await readFile(launcher, 'utf8')).toContain(roots.install)
    }
  )

  it('leaves old slots without a CLI usable and clears a previous launcher', async () => {
    await writeCli()
    await prepareOctopodCliLauncher()
    roots.install = join(directory, 'old server')
    await prepareOctopodCliLauncher()
    expect(getOctopodCliLauncherPath()).toBeNull()
  })

  describe('on a Linux host', () => {
    beforeEach(() => {
      Object.defineProperty(process, 'platform', { configurable: true, value: 'linux' })
    })

    it('refreshes both CLI names when the runtime switches server slots', async () => {
      await writeCli()
      await prepareOctopodCliLauncher()
      roots.install = join(directory, 'updated server')
      await writeCli()
      await prepareOctopodCliLauncher()
      const binDir = join(roots.profile, 'cli', 'bin')
      const script = await readFile(join(binDir, 'shield-ide'), 'utf8')
      expect(script).toContain(roots.install)
      expect(script).toBe(await readFile(join(binDir, 'shield'), 'utf8'))
    })
  })

  describe('on a Windows host', () => {
    beforeEach(() => {
      Object.defineProperty(process, 'platform', { configurable: true, value: 'win32' })
    })

    async function writeLauncher(contents: string): Promise<void> {
      const path = join(roots.install, ...OCTOPOD_WINDOWS_CLI_LAUNCHER_FILENAME.split('/'))
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, contents)
    }

    const binDir = (): string => join(roots.profile, 'cli', 'bin')
    const readConfig = (): Promise<string> =>
      readFile(join(binDir(), OCTOPOD_WINDOWS_CLI_LAUNCHER_CONFIG_FILENAME), 'utf8')

    it('installs the native launcher and points it at this slot, runtime and profile', async () => {
      await writeCli()
      await writeLauncher('native launcher v1')
      await prepareOctopodCliLauncher()
      const launcher = getOctopodCliLauncherPath()
      expect(launcher).toBe(join(binDir(), 'shield.exe'))
      expect(await readFile(launcher!, 'utf8')).toBe('native launcher v1')
      expect(await readConfig()).toBe(
        [
          `node=${process.execPath}`,
          `cli=${join(roots.install, ...OCTOPOD_CLI_ENTRY_FILENAME.split('/'))}`,
          `user-data=${roots.profile}`,
          ''
        ].join('\n')
      )
      // Batch/PowerShell proxies can reparse cmd.exe arguments instead of preserving them.
      expect((await readdir(binDir())).sort()).toEqual(
        [OCTOPOD_WINDOWS_CLI_LAUNCHER_CONFIG_FILENAME, 'shield.exe'].sort()
      )
    })

    it('refreshes the launcher and its target when the host switches server slots', async () => {
      await writeCli()
      await writeLauncher('native launcher v1')
      await prepareOctopodCliLauncher()
      roots.install = join(directory, 'updated server')
      await writeCli()
      await writeLauncher('native launcher v2')
      await prepareOctopodCliLauncher()
      expect(await readFile(join(binDir(), 'shield.exe'), 'utf8')).toBe('native launcher v2')
      expect(await readConfig()).toContain(`cli=${join(roots.install, 'out', 'cli', 'index.js')}`)
    })

    it('leaves a slot without the native launcher with no shield command', async () => {
      await writeCli()
      await prepareOctopodCliLauncher()
      expect(getOctopodCliLauncherPath()).toBeNull()
    })
  })
})
