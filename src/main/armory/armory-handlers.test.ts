import { beforeEach, describe, expect, it, vi } from 'vitest'

const handlers = vi.hoisted(
  () => new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
)
const runProcessMock = vi.hoisted(() => vi.fn())

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (event: unknown, ...args: unknown[]) => unknown) => {
      handlers.set(channel, handler)
    })
  }
}))
vi.mock('@shield/process-host', () => ({ runProcess: runProcessMock }))
vi.mock('../ipc/ui', () => ({ isTrustedUIRenderer: () => true }))

import { registerArmoryHandlers, type ArmoryHandlerDeps } from './armory-handlers'
import type { ArmoryToolDescriptor } from '@shield/armory/tool-registry'
import type {
  ArmoryHealthReport,
  ArmoryRunOutcome,
  ArmoryScopeState,
  ArmoryToolView
} from '../../shared/armory-contract'

const tool = (overrides: Partial<ArmoryToolDescriptor> = {}): ArmoryToolDescriptor => ({
  id: 'nmap',
  title: 'nmap',
  category: 'recon',
  runtime: 'docker',
  target: 'nmap:latest',
  versionArgv: ['--version'],
  scopeClass: 'recon',
  status: 'ok',
  ...overrides
})

const depsWith = (overrides: Partial<ArmoryHandlerDeps> = {}): ArmoryHandlerDeps => ({
  env: { OSHIELD_ARMORY_SCOPE: '10.0.0.5,192.168.1.0/24' },
  listTools: () => [tool()],
  runVersionProbe: async () => ({ code: 0, stdout: '7.94\n', stderr: '' }),
  ...overrides
})

const invoke = async <T>(channel: string, ...args: unknown[]): Promise<T> =>
  handlers.get(channel)?.({}, ...args) as T

describe('registerArmoryHandlers', () => {
  beforeEach(() => {
    handlers.clear()
    runProcessMock.mockReset()
    registerArmoryHandlers(
      depsWith({
        runVersionProbe: async (program, args, timeoutMs) => {
          const run = await runProcessMock(program, args, timeoutMs)
          return { code: run.code, stdout: run.stdout, stderr: run.stderr }
        }
      })
    )
  })

  it('armory:list projects descriptors for the renderer without exposing version argv', async () => {
    const tools = await invoke<readonly ArmoryToolView[]>('armory:list')
    expect(tools).toEqual([
      {
        id: 'nmap',
        title: 'nmap',
        category: 'recon',
        runtime: 'docker',
        target: 'nmap:latest',
        scopeClass: 'recon',
        status: 'ok'
      }
    ])
  })

  it('armory:scope reads OSHIELD_ARMORY_SCOPE verbatim with normalized entries', async () => {
    const scope = await invoke<ArmoryScopeState>('armory:scope')
    expect(scope).toEqual({
      raw: '10.0.0.5,192.168.1.0/24',
      targets: ['10.0.0.5'],
      cidrs: ['192.168.1.0/24'],
      exploitAuthorized: false,
      authorized: true
    })
  })

  it('armory:run executes only with explicit in-scope targets and returns the record + audit event', async () => {
    runProcessMock.mockResolvedValue({
      code: 0,
      signal: null,
      stdout: 'up\n',
      stderr: '',
      timedOut: false
    })
    const outcome = await invoke<ArmoryRunOutcome>('armory:run', {
      toolId: 'nmap',
      targets: ['10.0.0.5'],
      args: ['-sV']
    })
    if (!outcome.ok) {
      throw new Error('expected the run to be allowed')
    }
    expect(runProcessMock).toHaveBeenCalledTimes(1)
    const spec = runProcessMock.mock.calls[0]?.[0] as {
      program: string
      args: string[]
      timeoutMs?: number
    }
    expect(spec.program).toBe('docker')
    expect(spec.args).toEqual(['run', '--rm', 'nmap:latest', '-sV', '10.0.0.5'])
    expect(outcome.record).toMatchObject({
      toolId: 'nmap',
      targets: ['10.0.0.5'],
      exitCode: 0,
      stdout: 'up\n',
      audited: true
    })
    expect(outcome.auditEvent).toMatchObject({
      actorKind: 'tentacle',
      actorId: 'armory',
      action: 'armory.run',
      resourceKind: 'armory-tool',
      resourceId: 'nmap'
    })
  })

  it('armory:run denies out-of-scope targets verbatim without spawning', async () => {
    const outcome = await invoke<ArmoryRunOutcome>('armory:run', {
      toolId: 'nmap',
      targets: ['10.9.9.9'],
      args: []
    })
    expect(outcome).toEqual({
      ok: false,
      reason: 'target outside authorized scope: 10.9.9.9'
    })
    expect(runProcessMock).not.toHaveBeenCalled()
  })

  it('armory:run denies unknown tool ids without spawning', async () => {
    const outcome = await invoke<ArmoryRunOutcome>('armory:run', {
      toolId: 'totally-unknown',
      targets: ['10.0.0.5'],
      args: []
    })
    expect(outcome).toEqual({ ok: false, reason: 'unknown or not-installed tool: totally-unknown' })
    expect(runProcessMock).not.toHaveBeenCalled()
  })

  it('armory:health skips non-ok tools, caps the probe at 8s, and summarizes', async () => {
    registerArmoryHandlers(
      depsWith({
        listTools: () => [
          tool(),
          tool({ id: 'hydra', scopeClass: 'cracking', category: 'cracking', status: 'failed' }),
          tool({ id: 'sqlmap', category: 'web', scopeClass: 'web', target: 'sqlmap:latest' })
        ],
        runVersionProbe: async (_program, args, timeoutMs) => {
          expect(timeoutMs).toBe(8_000)
          if (args.includes('nmap:latest')) {
            return { code: 0, stdout: 'nmap 7.94\n', stderr: '' }
          }
          return { code: 1, stdout: '', stderr: 'broken' }
        }
      })
    )
    const report = await invoke<ArmoryHealthReport>('armory:health')
    expect(report.checkable).toBe(2)
    expect(report.healthy).toBe(1)
    expect(report.entries).toEqual([
      { toolId: 'nmap', state: 'ok', detail: 'nmap 7.94' },
      { toolId: 'hydra', state: 'skipped', detail: 'status: failed' },
      { toolId: 'sqlmap', state: 'unhealthy', detail: 'broken' }
    ])
  })
})
