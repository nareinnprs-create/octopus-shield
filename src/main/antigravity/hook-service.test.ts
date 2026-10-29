import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, existsSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

const { homedirMock } = vi.hoisted(() => ({
  homedirMock: vi.fn<() => string>()
}))

vi.mock('os', async () => {
  const actual = (await vi.importActual('os')) as Record<string, unknown>
  return {
    ...actual,
    homedir: homedirMock
  }
})

import { AntigravityHookService } from './hook-service'
import { createManagedCommandMatcher } from '../agent-hooks/installer-utils'

const ANTIGRAVITY_PRE_INVOCATION_COMMAND =
  process.platform === 'win32' ? 'antigravity-pre-invocation.cmd' : 'antigravity-hook.sh'
const ANTIGRAVITY_POST_TOOL_USE_COMMAND =
  process.platform === 'win32' ? 'antigravity-post-tool-use.cmd' : 'antigravity-hook.sh'
const ANTIGRAVITY_PRE_TOOL_USE_COMMAND =
  process.platform === 'win32' ? 'antigravity-pre-tool-use.cmd' : 'antigravity-hook.sh'
const PRE_TOOL_USE_DECISION = '{"decision":"ask"}'
const POLICY_OVERRIDING_DECISIONS = ['allow', 'deny', 'force_ask', 'deny_unless_prior_grant']

function withPlatform<T>(platform: NodeJS.Platform, run: () => T): T {
  const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')
  Object.defineProperty(process, 'platform', { configurable: true, value: platform })
  try {
    return run()
  } finally {
    if (originalPlatform) {
      Object.defineProperty(process, 'platform', originalPlatform)
    }
  }
}

describe('AntigravityHookService', () => {
  let homeDir: string

  beforeEach(() => {
    homeDir = mkdtempSync(join(tmpdir(), 'shield-antigravity-home-'))
    homedirMock.mockReturnValue(homeDir)
  })

  afterEach(() => {
    vi.clearAllMocks()
    rmSync(homeDir, { recursive: true, force: true })
  })

  it.skipIf(process.platform === 'win32')(
    'answers the PreToolUse gate with ask so the hook never decides tool permissions',
    () => {
      new AntigravityHookService().install()

      const result = spawnSync(
        '/bin/sh',
        [join(homeDir, '.shield', 'agent-hooks', 'antigravity-hook.sh')],
        {
          env: {
            ...process.env,
            OSHIELD_ANTIGRAVITY_EVENT: 'PreToolUse',
            OSHIELD_AGENT_HOOK_ENDPOINT: '',
            OSHIELD_AGENT_HOOK_PORT: '',
            OSHIELD_AGENT_HOOK_TOKEN: '',
            OSHIELD_PANE_KEY: ''
          },
          input: '{"toolCall":{"name":"run_command","args":{"CommandLine":"ls"}}}',
          encoding: 'utf8'
        }
      )

      expect(result.status).toBe(0)
      expect(result.stdout).toBe(`${PRE_TOOL_USE_DECISION}\n`)
    }
  )

  it.skipIf(process.platform === 'win32')(
    'keeps answering the PreToolUse gate when the managed script is missing',
    () => {
      new AntigravityHookService().install()
      rmSync(join(homeDir, '.shield', 'agent-hooks'), { recursive: true, force: true })

      const config = JSON.parse(
        readFileSync(join(homeDir, '.gemini', 'config', 'hooks.json'), 'utf8')
      ) as { 'shield-status': Record<string, { hooks?: { command: string }[] }[]> }
      const command = config['shield-status'].PreToolUse[0].hooks?.[0]?.command

      const result = spawnSync('/bin/sh', ['-c', command!], {
        input: '{"toolCall":{"name":"run_command"}}',
        encoding: 'utf8'
      })

      // Config under .gemini can outlive managed scripts under .shield.
      expect(result.status).toBe(0)
      expect(result.stdout).toBe(`${PRE_TOOL_USE_DECISION}\n`)
    }
  )

  it.skipIf(process.platform === 'win32')(
    'leaves non-gate Antigravity events silent when the managed script is missing',
    () => {
      new AntigravityHookService().install()
      rmSync(join(homeDir, '.shield', 'agent-hooks'), { recursive: true, force: true })

      const config = JSON.parse(
        readFileSync(join(homeDir, '.gemini', 'config', 'hooks.json'), 'utf8')
      ) as {
        'shield-status': Record<string, { command?: string; hooks?: { command: string }[] }[]>
      }
      const postToolUse = config['shield-status'].PostToolUse[0].hooks?.[0]?.command
      const preInvocation = config['shield-status'].PreInvocation[0].command

      for (const command of [postToolUse, preInvocation]) {
        const result = spawnSync('/bin/sh', ['-c', command!], { input: '{}', encoding: 'utf8' })
        expect(result.status).toBe(0)
        expect(result.stdout).toBe('')
      }
    }
  )

  it('installs Windows event wrappers without nested cmd quoting and replaces stale PreToolUse hooks', () => {
    withPlatform('win32', () => {
      const configPath = join(homeDir, '.gemini', 'config', 'hooks.json')
      const staleScriptPath = join(
        homeDir,
        '.shield',
        'agent-hooks',
        'antigravity-hook.cmd'
      ).replaceAll('/', '\\')
      mkdirSync(dirname(configPath), { recursive: true })
      writeFileSync(
        configPath,
        `${JSON.stringify(
          {
            'shield-status': {
              PreToolUse: [
                {
                  matcher: '*',
                  hooks: [
                    {
                      type: 'command',
                      command: `cmd /d /s /c "set "OSHIELD_ANTIGRAVITY_EVENT=PreToolUse" && call "${staleScriptPath}""`
                    }
                  ]
                }
              ]
            }
          },
          null,
          2
        )}\n`
      )

      const service = new AntigravityHookService()
      const staleStatus = service.getStatus()
      expect(staleStatus.state).toBe('partial')
      expect(staleStatus.managedHooksPresent).toBe(true)

      const status = service.install()

      expect(status.state).toBe('installed')

      const config = JSON.parse(readFileSync(configPath, 'utf8')) as {
        'shield-status': Record<
          string,
          { matcher?: string; command?: string; hooks?: { command: string }[] }[]
        >
      }
      expect(config['shield-status'].PreToolUse).toHaveLength(1)

      const expectedWrappers = {
        PreInvocation: 'antigravity-pre-invocation.cmd',
        PostInvocation: 'antigravity-post-invocation.cmd',
        Stop: 'antigravity-stop.cmd',
        PreToolUse: 'antigravity-pre-tool-use.cmd',
        PostToolUse: 'antigravity-post-tool-use.cmd'
      }
      for (const [eventName, wrapperFileName] of Object.entries(expectedWrappers)) {
        const definition = config['shield-status'][eventName][0]
        const command = ['PreToolUse', 'PostToolUse'].includes(eventName)
          ? definition.hooks?.[0]?.command
          : definition.command
        expect(createManagedCommandMatcher(wrapperFileName)(command)).toBe(true)
        expect(command).not.toContain('cmd /d /s /c')
        expect(command).not.toContain('OSHIELD_ANTIGRAVITY_EVENT')

        const wrapper = readFileSync(join(homeDir, '.shield', 'agent-hooks', wrapperFileName), 'utf8')
        expect(wrapper).toContain(`set "OSHIELD_ANTIGRAVITY_EVENT=${eventName}"`)
        expect(wrapper).toContain('call "%OSHIELD_ANTIGRAVITY_CORE%"')
        if (eventName === 'PreToolUse') {
          expect(wrapper).toContain(`echo ${PRE_TOOL_USE_DECISION}`)
        }
        for (const decision of POLICY_OVERRIDING_DECISIONS) {
          expect(wrapper).not.toContain(`{"decision":"${decision}"}`)
        }
      }

      const script = readFileSync(
        join(homeDir, '.shield', 'agent-hooks', 'antigravity-hook.cmd'),
        'utf8'
      )
      expect(script).toContain('antigravity-hook-post.cjs')
      expect(script).not.toContain('powershell.exe')
      expect(script).toContain('ELECTRON_RUN_AS_NODE=1')
      expect(
        readFileSync(join(homeDir, '.shield', 'agent-hooks', 'antigravity-hook-post.cjs'), 'utf8')
      ).toContain('/hook/antigravity')
      expect(script).toContain('setlocal DisableDelayedExpansion')
    })
  })

  it('preserves the installed core and config when publishing the Windows reader fails', () => {
    withPlatform('win32', () => {
      const service = new AntigravityHookService()
      expect(service.install().state).toBe('installed')
      const hookDir = join(homeDir, '.shield', 'agent-hooks')
      const readerPath = join(hookDir, 'antigravity-hook-post.cjs')
      const corePath = join(hookDir, 'antigravity-hook.cmd')
      const configPath = join(homeDir, '.gemini', 'config', 'hooks.json')
      writeFileSync(corePath, 'previous installed core')
      const previousConfig = readFileSync(configPath, 'utf8')
      rmSync(readerPath)
      mkdirSync(readerPath)

      expect(() => service.install()).toThrow()
      expect(readFileSync(corePath, 'utf8')).toBe('previous installed core')
      expect(readFileSync(configPath, 'utf8')).toBe(previousConfig)
    })
  })

  it('restores the owned Windows reader and resolves the current runtime on refresh', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    try {
      const service = new AntigravityHookService()
      let runtimePath = 'C:\\Shield1\\Shield.exe'
      service.setWindowsRuntimePathProvider(() => runtimePath)
      const readerPath = join(homeDir, '.shield', 'agent-hooks', 'antigravity-hook-post.cjs')
      await service.refreshManagedScripts()
      expect(existsSync(readerPath)).toBe(false)
      expect(service.install().state).toBe('installed')
      rmSync(readerPath)
      runtimePath = 'C:\\Shield2\\Shield.exe'
      await service.refreshManagedScripts()
      expect(readFileSync(readerPath, 'utf8')).toContain("require('node:string_decoder')")
      expect(
        readFileSync(join(homeDir, '.shield', 'agent-hooks', 'antigravity-hook.cmd'), 'utf8')
      ).toContain('OSHIELD_AGENT_HOOK_NODE=C:\\Shield2\\Shield.exe')
    } finally {
      vi.restoreAllMocks()
    }
  })

  it('preserves user-authored hook bundles and entries in Shield bundle', () => {
    const configPath = join(homeDir, '.gemini', 'config', 'hooks.json')
    mkdirSync(dirname(configPath), { recursive: true })
    writeFileSync(
      configPath,
      `${JSON.stringify(
        {
          'user-hook': {
            PreInvocation: [{ type: 'command', command: '/usr/local/bin/user-hook' }]
          },
          'shield-status': {
            PreInvocation: [{ type: 'command', command: '/usr/local/bin/shield-extra' }]
          }
        },
        null,
        2
      )}\n`
    )

    new AntigravityHookService().install()

    const config = JSON.parse(readFileSync(configPath, 'utf8')) as {
      'user-hook': { PreInvocation: { command: string }[] }
      'shield-status': { PreInvocation: { command: string }[] }
    }
    expect(config['user-hook'].PreInvocation[0].command).toBe('/usr/local/bin/user-hook')
    const commands = config['shield-status'].PreInvocation.map((entry) => entry.command)
    expect(commands).toContain('/usr/local/bin/shield-extra')
    expect(commands.some((command) => command.includes(ANTIGRAVITY_PRE_INVOCATION_COMMAND))).toBe(
      true
    )
  })

  it('removes stale managed Antigravity hook entries from retired events', () => {
    const configPath = join(homeDir, '.gemini', 'config', 'hooks.json')
    mkdirSync(dirname(configPath), { recursive: true })
    writeFileSync(
      configPath,
      `${JSON.stringify(
        {
          'shield-status': {
            OldEvent: [
              {
                type: 'command',
                command: '/tmp/old/agent-hooks/antigravity-hook.sh'
              }
            ],
            PreToolUse: [
              {
                matcher: '*',
                hooks: [{ type: 'command', command: '/tmp/old/agent-hooks/antigravity-hook.sh' }]
              }
            ]
          }
        },
        null,
        2
      )}\n`
    )

    new AntigravityHookService().install()

    const config = JSON.parse(readFileSync(configPath, 'utf8')) as {
      'shield-status': Record<string, { command?: string; hooks?: { command: string }[] }[]>
    }
    expect(config['shield-status'].OldEvent).toBeUndefined()
    const preToolCommands = config['shield-status'].PreToolUse.flatMap((definition) =>
      (definition.hooks ?? []).map((hook) => hook.command)
    )
    expect(preToolCommands).toHaveLength(1)
    expect(preToolCommands[0]).toContain(
      join(homeDir, '.shield', 'agent-hooks', ANTIGRAVITY_PRE_TOOL_USE_COMMAND).replaceAll('\\', '/')
    )
    expect(preToolCommands[0]).not.toContain('/tmp/old/agent-hooks/antigravity-hook.sh')
    const commands = config['shield-status'].PostToolUse.flatMap((definition) =>
      (definition.hooks ?? []).map((hook) => hook.command)
    )
    expect(commands).toHaveLength(1)
    expect(commands[0]).toContain(
      join(homeDir, '.shield', 'agent-hooks', ANTIGRAVITY_POST_TOOL_USE_COMMAND).replaceAll('\\', '/')
    )
  })

  it('replaces legacy backslash Windows entries and keeps user hooks', () => {
    withPlatform('win32', () => {
      const configPath = join(homeDir, '.gemini', 'config', 'hooks.json')
      // Git Bash strips backslashes from legacy bare paths.
      const legacyStop = 'C:\\Users\\ada\\.shield\\agent-hooks\\antigravity-stop.cmd'
      const legacyPreToolUse = 'C:\\Users\\ada\\.shield\\agent-hooks\\antigravity-pre-tool-use.cmd'
      const userHook = { type: 'command', command: 'C:\\tools\\user-hook.cmd' }
      mkdirSync(dirname(configPath), { recursive: true })
      writeFileSync(
        configPath,
        `${JSON.stringify({
          'shield-status': {
            Stop: [{ type: 'command', command: legacyStop }, userHook],
            PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: legacyPreToolUse }] }]
          }
        })}\n`
      )

      const service = new AntigravityHookService()
      expect(service.getStatus().state).toBe('partial')
      expect(service.install().state).toBe('installed')

      const config = JSON.parse(readFileSync(configPath, 'utf8')) as {
        'shield-status': Record<string, { command?: string; hooks?: { command: string }[] }[]>
      }
      const [keptUserHook, stop] = config['shield-status'].Stop
      expect(config['shield-status'].Stop).toHaveLength(2)
      expect(keptUserHook).toEqual(userHook)
      expect(stop.command).not.toBe(legacyStop)
      expect(createManagedCommandMatcher('antigravity-stop.cmd')(stop.command)).toBe(true)
      const preToolUse = config['shield-status'].PreToolUse.flatMap((d) => d.hooks ?? [])
      expect(preToolUse).toHaveLength(1)
      expect(preToolUse[0].command).not.toBe(legacyPreToolUse)
    })
  })
})
