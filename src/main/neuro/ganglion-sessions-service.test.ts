import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

const handlers = vi.hoisted(
  () => new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
)

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (event: unknown, ...args: unknown[]) => unknown) => {
      handlers.set(channel, handler)
    })
  }
}))
vi.mock('../ipc/ui', () => ({ isTrustedUIRenderer: () => true }))

import type { GanglionSessionHost } from './ganglion-executor-adapter'
import { GanglionSessionsService } from './ganglion-sessions-service'
import { registerNeuroSessionHandlers } from './ganglion-sessions-service'
import type { NeuroSessionsSnapshot } from '../../shared/neuro-sessions-contract'

let directory: string

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'ganglion-service-'))
})

afterEach(async () => {
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

const spawnRequest = {
  tentacle: 'Forge',
  title: 'Summarize auth',
  prompt: 'Summarize the auth module',
  worktree: 'wt-1'
}

const host = (overrides: Partial<GanglionSessionHost> = {}): GanglionSessionHost => ({
  createAgentSession: async () => ({
    terminal: { handle: 'term_1', tabId: 'tab_1', worktreeId: 'wt-1', title: null },
    disposition: 'created' as const
  }),
  waitForTerminal: async (_handle, options) =>
    // Idle probe sees a busy agent; the settle wait sees idle.
    options?.timeoutMs === 250 ? { satisfied: false } : { satisfied: true },
  readTerminal: async () => ({ tail: ['summary: ok'] }),
  closeTerminal: async () => ({ ptyKilled: true }),
  ...overrides
})

const serviceWith = (hostOverrides: Partial<GanglionSessionHost> = {}): GanglionSessionsService =>
  new GanglionSessionsService({
    host: host(hostOverrides),
    dataDirectory: directory,
    startDeadlineMs: 15,
    startPollMs: 1,
    settlePollMs: 20
  })

const invoke = async <T>(channel: string, ...args: unknown[]): Promise<T> =>
  handlers.get(channel)?.({}, ...args) as T

const settle = (ms = 60): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

describe('GanglionSessionsService', () => {
  it('spawns a real agent session and settles the ledger completed end-to-end', async () => {
    const service = serviceWith()
    const outcome = service.spawn(spawnRequest)
    expect(outcome).toEqual({ ok: true, taskId: expect.any(String) })
    const taskId = outcome.ok ? outcome.taskId : ''
    await settle()
    const snapshot = service.snapshot()
    const task = snapshot.tasks.find((candidate) => candidate.taskId === taskId)
    expect(task).toMatchObject({
      state: 'completed',
      tentacle: 'Forge',
      terminalHandle: 'term_1',
      tabId: 'tab_1',
      worktreeId: 'wt-1'
    })
    // The Ganglion graph carries the live task node for its Tentacle.
    const record = service.runtime.snapshot().tasks.find((entry) => entry.taskId === taskId)
    expect(record?.state).toBe('completed')
    expect(record?.sessionId).toBe(`ganglion:${taskId}`)
  })

  it('refuses unknown tentacles and invalid requests without spawning', () => {
    const service = serviceWith()
    expect(service.spawn({ ...spawnRequest, tentacle: 'NotATentacle' }).ok).toBe(false)
    expect(service.spawn({ ...spawnRequest, title: ' ' }).ok).toBe(false)
    expect(service.spawn({ ...spawnRequest, prompt: '   ' }).ok).toBe(false)
    expect(service.snapshot().tasks).toHaveLength(0)
  })

  it('marks tasks interrupted on boot and retry re-spawns the same brief', async () => {
    const ledger = join(directory, 'neuro', 'ganglion-tasks.json')
    await mkdir(join(directory, 'neuro'), { recursive: true })
    await writeFile(
      ledger,
      JSON.stringify({
        tasks: [
          {
            taskId: 'crashed-1',
            tentacle: 'Forge',
            title: 'Interrupted brief',
            prompt: 'finish me',
            state: 'running',
            worktreeId: 'wt-1',
            createdAtEpochMs: 1,
            updatedAtEpochMs: 1
          }
        ]
      })
    )
    const next = serviceWith()
    await next.resumeInterrupted()
    const interrupted = next.snapshot().tasks.find((task) => task.taskId === 'crashed-1')
    expect(interrupted?.state).toBe('interrupted')
    const retried = next.retry('crashed-1')
    expect(retried.ok).toBe(true)
    const tasks = next.snapshot().tasks
    expect(tasks.filter((task) => task.title === 'Interrupted brief')).toHaveLength(2)
  })

  it('stop closes the terminal and settles the run failed', async () => {
    const closeTerminal = vi.fn(async () => ({ ptyKilled: true }))
    const service = serviceWith({
      waitForTerminal: async (_handle, options) => {
        if (options?.timeoutMs === 250) {
          return { satisfied: false }
        }
        if (options?.signal?.aborted) {
          throw new Error('Request was aborted')
        }
        throw new Error('timeout')
      },
      closeTerminal
    })
    const outcome = service.spawn(spawnRequest)
    if (!outcome.ok) {
      throw new Error('spawn failed')
    }
    // Wait until the session attached (record running), then stop.
    const deadline = Date.now() + 2_000
    while (
      service.snapshot().tasks.find((task) => task.taskId === outcome.taskId)?.state !==
        'running' &&
      Date.now() < deadline
    ) {
      await settle(10)
    }
    expect(await service.stop(outcome.taskId)).toBe(true)
    expect(closeTerminal).toHaveBeenCalledWith('term_1')
    const failedDeadline = Date.now() + 3_000
    while (
      service.snapshot().tasks.find((task) => task.taskId === outcome.taskId)?.state !== 'failed' &&
      Date.now() < failedDeadline
    ) {
      await settle(25)
    }
    expect(service.snapshot().tasks.find((task) => task.taskId === outcome.taskId)?.state).toBe(
      'failed'
    )
  })

  it('serves the renderer IPC surface from one trusted service', async () => {
    const service = serviceWith()
    registerNeuroSessionHandlers({
      runtime: host(),
      dataDirectory: directory,
      service,
      startDeadlineMs: 15,
      startPollMs: 1,
      settlePollMs: 20
    })
    const registered = [
      'neuro:sessions:list',
      'neuro:sessions:spawn',
      'neuro:sessions:stop',
      'neuro:sessions:retry'
    ]
    for (const channel of registered) {
      expect(handlers.has(channel)).toBe(true)
    }
    const listed = await invoke<NeuroSessionsSnapshot>('neuro:sessions:list')
    expect(listed.tentacles).toContain('Forge')
    const spawned = await invoke<{ ok: true; taskId: string }>('neuro:sessions:spawn', spawnRequest)
    expect(spawned.ok).toBe(true)
    expect(service.snapshot().tasks.at(0)?.taskId ?? '').toBe(spawned.taskId)
  })
})
