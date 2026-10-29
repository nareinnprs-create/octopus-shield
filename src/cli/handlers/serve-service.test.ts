import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  installServeService,
  readServeServiceStatus,
  uninstallServeService,
  type ServeServiceDeps
} from './serve-service'
import { resolveServiceCommand } from '../runtime/serve-app-launcher'
import { serveSupervisorBrakePath } from '../runtime/serve-supervisor-brake'

describe('shield serve service', () => {
  let home: string
  let bin: string
  let calls: string[]
  let answers: Map<string, { code: number | null; out: string }>

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'shield-serve-service-'))
    bin = join(home, 'bin')
    await mkdir(bin)
    await writeFile(join(bin, 'shield'), '#!/bin/sh\n')
    await chmod(join(bin, 'shield'), 0o755)
    await writeFile(join(bin, 'shield-ide'), '#!/bin/sh\n')
    await chmod(join(bin, 'shield-ide'), 0o755)
    calls = []
    answers = new Map()
  })

  afterEach(async () => {
    await rm(home, { recursive: true, force: true })
  })

  const deps = (platform: NodeJS.Platform): ServeServiceDeps => ({
    platform,
    env: {
      PATH: `/nonexistent:${bin}`,
      OSHIELD_USER_DATA_PATH: join(home, 'profile'),
      ELECTRON_RUN_AS_NODE: '1'
    },
    homeDir: home,
    uid: 501,
    run: async (program, args) => {
      const line = [program, ...args].join(' ')
      calls.push(line)
      return answers.get(line) ?? { code: 0, out: '' }
    }
  })

  it('installs and loads a LaunchAgent, clearing an old give-up', async () => {
    await mkdir(join(home, 'profile'))
    await writeFile(serveSupervisorBrakePath(join(home, 'profile')), '{}')
    const result = await installServeService({ command: null, dryRun: false }, deps('darwin'))
    const unitPath = String(result.unitPath)
    expect(await readFile(unitPath, 'utf8')).toContain(`<string>${join(bin, 'shield')}</string>`)
    expect(calls).toEqual([
      expect.stringMatching(/^launchctl bootout gui\/501\/com\.octopusshield\.shield\.serve\./),
      `launchctl bootstrap gui/501 ${unitPath}`
    ])
    expect(existsSync(serveSupervisorBrakePath(join(home, 'profile')))).toBe(false)
  })

  it('enables a systemd unit and reports lingering', async () => {
    const d = deps('linux')
    answers.set('loginctl show-user 501 --property=Linger --value', { code: 0, out: 'no\n' })
    const result = await installServeService({ command: null, dryRun: false }, d)
    expect(result.linger).toBe('no')
    expect(calls.slice(0, 3)).toEqual([
      'systemctl --user daemon-reload',
      expect.stringMatching(/^systemctl --user enable shield-serve-[0-9a-f]{8}\.service$/),
      expect.stringMatching(/^systemctl --user restart shield-serve-/)
    ])
  })

  it('fails loudly when the manager refuses, and writes nothing on a dry run', async () => {
    const d = deps('darwin')
    const dry = await installServeService({ command: null, dryRun: true }, d)
    expect(existsSync(String(dry.unitPath))).toBe(false)
    expect(calls).toEqual([])
    answers.set(`launchctl bootstrap gui/501 ${String(dry.unitPath)}`, { code: 5, out: 'denied' })
    await expect(installServeService({ command: null, dryRun: false }, d)).rejects.toThrow(/denied/)
  })

  it('reports live, exited and unverifiable from the manager', async () => {
    const d = deps('darwin')
    const dry = await installServeService({ command: null, dryRun: true }, d)
    const print = `launchctl print gui/501/${String(dry.name)}`
    answers.set(print, { code: 0, out: '\tstate = running\n\tpid = 4242\n' })
    await expect(readServeServiceStatus(d)).resolves.toMatchObject({
      verdict: 'live',
      pid: 4242,
      installed: false
    })
    answers.set(print, { code: 113, out: 'Could not find service' })
    await expect(readServeServiceStatus(d)).resolves.toMatchObject({ verdict: 'exited' })
    answers.set(print, { code: null, out: '' })
    await expect(readServeServiceStatus(d)).resolves.toMatchObject({ verdict: 'unverifiable' })
    answers.set(print, { code: 5, out: 'Bootstrap failed: no GUI session' })
    await expect(readServeServiceStatus(d)).resolves.toMatchObject({ verdict: 'unverifiable' })

    const linux = deps('linux')
    answers.set(
      `systemctl --user show ${String((await installServeService({ command: null, dryRun: true }, linux)).name)} --property=ActiveState,SubState,MainPID`,
      { code: 0, out: 'ActiveState=active\nSubState=running\nMainPID=99\n' }
    )
    await expect(readServeServiceStatus(linux)).resolves.toMatchObject({ verdict: 'live', pid: 99 })
  })

  it('uninstalls by stopping the service and removing the unit', async () => {
    const d = deps('linux')
    const result = await installServeService({ command: null, dryRun: false }, d)
    calls = []
    await expect(uninstallServeService(d)).resolves.toMatchObject({ removed: true })
    expect(existsSync(String(result.unitPath))).toBe(false)
    expect(calls).toEqual([
      `systemctl --user disable --now ${String(result.name)}`,
      'systemctl --user daemon-reload'
    ])
  })

  it('skips a profile launcher and refuses a bare Linux shield', async () => {
    const scoped = join(home, 'profile', 'cli', 'bin')
    await mkdir(scoped, { recursive: true })
    await writeFile(join(scoped, 'shield'), '#!/bin/sh\n')
    await chmod(join(scoped, 'shield'), 0o755)
    expect(
      resolveServiceCommand(null, {
        platform: 'darwin',
        env: { PATH: `${scoped}:${bin}`, OSHIELD_USER_DATA_PATH: join(home, 'profile') }
      })
    ).toBe(join(bin, 'shield'))
    // Linux takes only shield-ide, never a bare `shield` (often the screen reader).
    const onlyShield = join(home, 'only-shield')
    await mkdir(onlyShield)
    await writeFile(join(onlyShield, 'shield'), '#!/bin/sh\n')
    await chmod(join(onlyShield, 'shield'), 0o755)
    expect(() =>
      resolveServiceCommand(null, {
        platform: 'linux',
        env: { PATH: onlyShield, OSHIELD_USER_DATA_PATH: join(home, 'profile') }
      })
    ).toThrow(/PATH/)
  })

  it('refuses Windows and a relative --command', async () => {
    await expect(
      installServeService({ command: null, dryRun: true }, deps('win32'))
    ).rejects.toThrow(/Windows/)
    expect(() => resolveServiceCommand('shield', { platform: 'darwin', env: {} })).toThrow()
    expect(() =>
      resolveServiceCommand(null, { platform: 'darwin', env: { PATH: '/nonexistent' } })
    ).toThrow(/PATH/)
  })
  it('names the command to run when only a server-only shield exists here', async () => {
    // SSH server launchers run on plain Node, without an installed Electron desktop.
    const serverCli = (platform: NodeJS.Platform, path: string): ServeServiceDeps => {
      const base = deps(platform)
      const { ELECTRON_RUN_AS_NODE: _electron, ...env } = base.env
      return { ...base, env: { ...env, PATH: path } }
    }
    const scoped = join(home, 'profile', 'cli', 'bin')
    await mkdir(scoped, { recursive: true })
    await writeFile(join(scoped, 'shield'), '#!/bin/sh\n')
    await chmod(join(scoped, 'shield'), 0o755)
    await expect(
      installServeService({ command: null, dryRun: false }, serverCli('linux', scoped))
    ).rejects.toThrow(/install the Shield app.*`shield-ide serve service install`/i)
    await expect(
      installServeService({ command: null, dryRun: true }, serverCli('darwin', scoped))
    ).rejects.toThrow(/`shield serve service install`/)
    expect(calls).toEqual([])
    await expect(
      installServeService({ command: null, dryRun: true }, serverCli('linux', `${scoped}:${bin}`))
    ).resolves.toMatchObject({ dryRun: true })
    await expect(
      installServeService(
        { command: join(bin, 'shield-ide'), dryRun: true },
        serverCli('linux', scoped)
      )
    ).resolves.toMatchObject({ dryRun: true })
  })

  it('refuses a --command tied to one Shield version', async () => {
    const scoped = join(home, 'profile', 'cli', 'bin')
    await mkdir(scoped, { recursive: true })
    await writeFile(join(scoped, 'shield'), '#!/bin/sh\n')
    await chmod(join(scoped, 'shield'), 0o755)
    expect(() =>
      resolveServiceCommand(join(scoped, 'shield'), {
        platform: 'darwin',
        env: { OSHIELD_USER_DATA_PATH: join(home, 'profile') }
      })
    ).toThrow(/one Shield version/)
  })
})
