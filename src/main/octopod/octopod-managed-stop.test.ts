import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, sep } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type * as WindowsAcl from '../../shared/secure-path-windows-acl'
import {
  OctopodManagedStopCompletionSchema,
  type OctopodManagedStopRequest
} from '../../shared/octopod-stop-request'
import { acquireOctopodInstanceLock, type OctopodInstanceLock } from './octopod-instance-lock'
import {
  octopodManagedStopRequestPath,
  validateOctopodManagedStopRequest
} from './octopod-managed-stop-request'
import {
  completeOctopodManagedStop,
  type OctopodManagedStopCompletionOptions
} from './octopod-managed-stop-completion'
import {
  octopodStopReceiptPath,
  readOctopodCompletedStopReceipt,
  readOctopodDaemonRetirementRecord
} from './octopod-completed-stop-receipt'
import { prepareOctopodManagedStop } from './octopod-managed-stop-admission'
import { runOctopodManagedStopCommand } from './octopod-managed-stop-command'
import {
  OCTOPOD_DAEMON_RETIREMENT_TIMEOUT_MS,
  OCTOPOD_SHUTDOWN_DEADLINE_MS,
  OCTOPOD_STOP_COMPLETION_POLL_MS
} from './octopod-stop-deadlines'

const hardening = vi.hoisted(() => ({ pending: new Set<Promise<void>>() }))

vi.mock('../../shared/secure-path-windows-acl', async (importOriginal) => {
  const acl = await importOriginal<typeof WindowsAcl>()
  return {
    ...acl,
    restrictWindowsDirectory: (dirPath: string): Promise<boolean> => {
      const restricted = acl.restrictWindowsDirectory(dirPath)
      const pending = restricted.then(() => undefined)
      hardening.pending.add(pending)
      void pending.then(() => hardening.pending.delete(pending))
      return restricted
    }
  }
})

const roots: string[] = []
afterEach(async () => {
  // ACL updates must finish before their temporary directories disappear.
  await Promise.all(hardening.pending)
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

function running(): { lock: OctopodInstanceLock; request: OctopodManagedStopRequest } {
  const root = mkdtempSync(join(tmpdir(), 'octopod-managed-stop-'))
  roots.push(root)
  const lock = acquireOctopodInstanceLock(root, {
    identity: () => 'uid-1000',
    version: () => '1.0.0',
    startedAtMs: () => 5_000,
    incarnation: () => null
  })
  const { pid, startedAtMs, nonce } = lock.record
  return {
    lock,
    request: {
      schemaVersion: 1,
      transactionId: '0b9f6a3e-9e2c-4c8e-8f58-4c0f6b1d2e3a',
      version: '1.0.0',
      runtimeId: 'runtime-1',
      instance: { pid, startedAtMs, nonce, lockPath: lock.path }
    }
  }
}

const context = ({ version, runtimeId, instance }: OctopodManagedStopRequest) => ({
  version,
  runtimeId,
  instance
})

function options(
  overrides: Partial<OctopodManagedStopCompletionOptions> = {}
): OctopodManagedStopCompletionOptions {
  return {
    probeProcess: () => 'alive',
    startedAtMs: () => 5_000,
    sleep: async () => {},
    attempts: 3,
    now: () => new Date('2026-10-01T00:00:00.000Z'),
    ...overrides
  }
}

describe('managed stop requests', () => {
  it('keys the request file to the instance, so a previous instance never matches', () => {
    const { request } = running()
    const other = { ...request.instance, nonce: 'other' }
    expect(octopodManagedStopRequestPath(request.instance)).not.toBe(
      octopodManagedStopRequestPath(other)
    )
  })

  it('accepts a request a newer client wrote with a field this build does not know', () => {
    const { request } = running()
    const path = octopodManagedStopRequestPath(request.instance)
    writeFileSync(
      path,
      JSON.stringify({ ...request, futureOption: true, instance: { ...request.instance, x: 1 } })
    )
    expect(validateOctopodManagedStopRequest(context(request), path)).toEqual(request)
  })

  it('accepts only a request naming this runtime, version and instance', () => {
    const { request } = running()
    const path = octopodManagedStopRequestPath(request.instance)
    writeFileSync(path, JSON.stringify(request))
    expect(validateOctopodManagedStopRequest(context(request), path)).toEqual(request)
    for (const mismatch of [
      { ...request, version: '0.9.0' },
      { ...request, runtimeId: 'runtime-2' },
      { ...request, instance: { ...request.instance, pid: request.instance.pid + 1 } },
      {
        ...request,
        instance: { ...request.instance, lockPath: `${request.instance.lockPath}.old` }
      }
    ]) {
      writeFileSync(path, JSON.stringify(mismatch))
      expect(() => validateOctopodManagedStopRequest(context(request), path)).toThrow(
        'identity_mismatch'
      )
    }
  })

  it('accepts the same lock path spelled differently, as a Windows client sends it', () => {
    const { request } = running()
    const path = octopodManagedStopRequestPath(request.instance)
    const { lockPath } = request.instance
    const respelled = `${dirname(lockPath)}/./${basename(lockPath)}`.replaceAll(sep, '/')
    expect(respelled).not.toBe(lockPath)
    const sent = { ...request, instance: { ...request.instance, lockPath: respelled } }
    writeFileSync(path, JSON.stringify(sent))
    expect(validateOctopodManagedStopRequest(context(request), path)).toEqual(sent)
  })

  it('refuses a request once the instance lock names another holder', () => {
    const { lock, request } = running()
    const path = octopodManagedStopRequestPath(request.instance)
    writeFileSync(path, JSON.stringify(request))
    writeFileSync(lock.path, JSON.stringify({ ...lock.record, nonce: 'successor' }))
    expect(() => validateOctopodManagedStopRequest(context(request), path)).toThrow(
      'instance_lock_changed'
    )
  })
})

describe('completing a managed stop', () => {
  it('writes the request, waits for proven exit, then persists a receipt', async () => {
    const { request } = running()
    const probes = ['alive', 'alive', 'missing'] as const
    let index = 0
    const verdict = await completeOctopodManagedStop(
      request,
      options({ probeProcess: () => probes[Math.min(index++, probes.length - 1)] })
    )
    expect(verdict).toBe('exited')
    expect(JSON.parse(readFileSync(octopodManagedStopRequestPath(request.instance), 'utf8'))).toEqual(
      request
    )
    expect(readOctopodCompletedStopReceipt(request)).toMatchObject({
      kind: 'octopod_managed_stop_completed',
      exitedAt: '2026-10-01T00:00:00.000Z'
    })
  })

  it('treats a reused PID with a different stored creation time as proof of exit', async () => {
    const { request } = running()
    expect(
      await completeOctopodManagedStop(
        request,
        options({ startedAtMs: () => 99_000, platform: 'win32' })
      )
    ).toBe('exited')
  })

  it.each([
    ['an unanswerable probe', { probeProcess: () => 'unverifiable' as const }],
    ['a reused PID with no readable start time', { startedAtMs: () => null, attempts: 1 }]
  ])('never reports exit for %s', async (_name, overrides) => {
    const { request } = running()
    const verdict = await completeOctopodManagedStop(request, options(overrides))
    expect(verdict).not.toBe('exited')
    expect(existsSync(octopodStopReceiptPath(request, 'completed'))).toBe(false)
  })

  it('reports a still-running instance as live after its attempts', async () => {
    const { request } = running()
    expect(await completeOctopodManagedStop(request, options())).toBe('live')
  })

  it('waits out daemon retirement plus the shutdown deadline before answering live', async () => {
    const { request } = running()
    let polls = 0
    const exitAfterMs = 2 * OCTOPOD_DAEMON_RETIREMENT_TIMEOUT_MS + OCTOPOD_SHUTDOWN_DEADLINE_MS
    const verdict = await completeOctopodManagedStop(request, {
      ...options({ attempts: undefined }),
      sleep: async () => void polls++,
      probeProcess: () =>
        polls * OCTOPOD_STOP_COMPLETION_POLL_MS >= exitAfterMs ? 'missing' : 'alive'
    })
    expect(verdict).toBe('exited')
  })

  it('does not address a live process that no longer holds the lock it published', async () => {
    const { lock, request } = running()
    writeFileSync(lock.path, JSON.stringify({ ...lock.record, nonce: 'successor' }))
    expect(await completeOctopodManagedStop(request, options())).toBe('unverifiable')
    expect(existsSync(octopodManagedStopRequestPath(request.instance))).toBe(false)
  })

  it('does not overwrite another transaction pending for the same instance', async () => {
    const { request } = running()
    const pending = { ...request, transactionId: '5a7e1f0c-3b2d-4e6f-9a8b-7c6d5e4f3a2b' }
    writeFileSync(octopodManagedStopRequestPath(request.instance), JSON.stringify(pending))
    expect(await completeOctopodManagedStop(request, options())).toBe('unverifiable')
  })

  it('prints one completion line through the command', async () => {
    const { request } = running()
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const completion = await runOctopodManagedStopCommand(
      ['--complete-managed-stop', JSON.stringify(request)],
      options({ probeProcess: () => 'missing' })
    )
    expect(completion).toMatchObject({ verdict: 'exited', receiptPersisted: true })
    expect(
      OctopodManagedStopCompletionSchema.parse(JSON.parse(String(write.mock.calls[0]?.[0])))
    ).toEqual(completion)
    await expect(runOctopodManagedStopCommand(['--complete-managed-stop'])).rejects.toThrow(
      'invalid_arguments'
    )
  })

  it('reads the request from a staged file instead of argv', async () => {
    const { lock, request } = running()
    const staged = join(lock.path, '..', 'staged-request.json')
    writeFileSync(staged, JSON.stringify(request))
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const completion = await runOctopodManagedStopCommand(
      ['--complete-managed-stop', '--request-file', staged],
      options({ probeProcess: () => 'missing' })
    )
    expect(completion).toMatchObject({
      transactionId: request.transactionId,
      verdict: 'exited'
    })
    await expect(
      runOctopodManagedStopCommand(['--complete-managed-stop', '--request-file'])
    ).rejects.toThrow('invalid_arguments')
  })
})

describe('managed stops that retire the daemon', () => {
  const outcome = (retirement: 'retired' | 'live' | 'unverifiable', liveSessions: number | null) =>
    vi.fn(async () => ({ retirement, liveSessions, reason: null }))

  it('does not touch the daemon when retirement was not asked for', async () => {
    const { request } = running()
    const retire = outcome('retired', 0)
    await prepareOctopodManagedStop(request, retire)
    expect(retire).not.toHaveBeenCalled()
    expect(readOctopodDaemonRetirementRecord(request)).toBeNull()
  })

  it.each([
    ['retired', 0],
    ['live', 2],
    ['unverifiable', null]
  ] as const)(
    'still completes the stop and records retirement %s on the receipt',
    async (retirement, liveSessions) => {
      const { request } = running()
      const retireRequest = { ...request, retireIdleDaemon: true as const }
      await prepareOctopodManagedStop(retireRequest, outcome(retirement, liveSessions))
      expect(readOctopodDaemonRetirementRecord(retireRequest)).toMatchObject({
        retirement,
        liveSessions
      })
      expect(
        await completeOctopodManagedStop(retireRequest, options({ probeProcess: () => 'missing' }))
      ).toBe('exited')
      expect(readOctopodCompletedStopReceipt(retireRequest)).toMatchObject({ retirement })
    }
  )

  it('stops the automation scheduler before the daemon census, with or without retirement', async () => {
    const { request } = running()
    const order: string[] = []
    const retire = vi.fn(async () => {
      order.push('retire')
      return { retirement: 'retired' as const, liveSessions: 0, reason: null }
    })
    const stopAutomations = vi.fn(() => void order.push('automations'))
    await prepareOctopodManagedStop({ ...request, retireIdleDaemon: true }, retire, stopAutomations)
    expect(order).toEqual(['automations', 'retire'])

    await prepareOctopodManagedStop(request, retire, stopAutomations)
    expect(stopAutomations).toHaveBeenCalledTimes(2)
  })

  it('records a timed-out retirement without its in-process late verdict', async () => {
    const { request } = running()
    const retireRequest = { ...request, retireIdleDaemon: true as const }
    await prepareOctopodManagedStop(retireRequest, async () => ({
      retirement: 'unverifiable' as const,
      liveSessions: null,
      reason: null,
      lateRetirement: Promise.resolve(true)
    }))
    expect(readOctopodDaemonRetirementRecord(retireRequest)).toMatchObject({
      retirement: 'unverifiable'
    })
  })

  it('records unverifiable when the retirement attempt itself failed', async () => {
    const { request } = running()
    const retireRequest = { ...request, retireIdleDaemon: true as const }
    await prepareOctopodManagedStop(retireRequest, async () => {
      throw new Error('daemon socket closed')
    })
    expect(readOctopodDaemonRetirementRecord(retireRequest)).toMatchObject({
      retirement: 'unverifiable'
    })
  })

  it('reports unverifiable when octopod exited without recording retirement', async () => {
    const { request } = running()
    const retireRequest = { ...request, retireIdleDaemon: true as const }
    await completeOctopodManagedStop(retireRequest, options({ probeProcess: () => 'missing' }))
    expect(readOctopodCompletedStopReceipt(retireRequest)).toMatchObject({
      retirement: 'unverifiable'
    })
  })

  it('omits retirement from the receipt of a plain managed stop', async () => {
    const { request } = running()
    await completeOctopodManagedStop(request, options({ probeProcess: () => 'missing' }))
    expect(readOctopodCompletedStopReceipt(request)).not.toHaveProperty('retirement')
  })

  it('reports the recorded retirement in the completion line, so a client need not read files', async () => {
    const { request } = running()
    const retireRequest = { ...request, retireIdleDaemon: true as const }
    await prepareOctopodManagedStop(retireRequest, outcome('live', 1))
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    expect(
      await runOctopodManagedStopCommand(
        ['--complete-managed-stop', JSON.stringify(retireRequest)],
        options({ probeProcess: () => 'missing' })
      )
    ).toMatchObject({ verdict: 'exited', retirement: 'live' })
  })
})
