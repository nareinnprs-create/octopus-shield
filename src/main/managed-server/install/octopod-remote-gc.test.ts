import type * as ExecCommandModule from '../../ssh/remote-exec/remote-exec-command'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../ssh/remote-exec/remote-exec-command', async (importOriginal) => ({
  ...(await importOriginal<typeof ExecCommandModule>()),
  execCommand: vi.fn()
}))
vi.mock('../../../shared/shell-argument-quoting', () => ({
  quotePosixShell: (s: string) => `'${s}'`
}))
vi.mock('./remote-install-gc-claim', () => ({
  isRelayGcClaimOwned: vi.fn().mockResolvedValue(true),
  releaseRelayGcClaimWithRetry: vi.fn().mockResolvedValue('released'),
  tryAcquireRelayGcClaim: vi.fn().mockResolvedValue('token')
}))
vi.mock('./remote-install-gc-tombstone', () => ({
  cleanupRemoteInstallGcTombstones: vi.fn().mockResolvedValue(undefined)
}))
vi.mock('./remote-install-lock', () => ({
  RELAY_INSTALL_LOCK_NAME: '.install-lock',
  INSTALL_LOCK_STALE_MS: 20 * 60_000,
  INSTALL_LOCK_STALE_SECONDS: 20 * 60,
  isRelayInstallLockStale: vi.fn().mockResolvedValue(false)
}))

import { execCommand } from '../../ssh/remote-exec/remote-exec-command'
import { gcOldOctopodVersions } from './octopod-remote-gc'
import { emptyOctopodActivationRecord } from '../activation/octopod-activation-record'
import { serializeOctopodActivationTransaction } from '../activation/octopod-activation-transaction'
import { createOctopodActivationTransaction } from '../activation/octopod-activation-transaction-transitions'
import { getRemoteHostPlatform } from '../../ssh/ssh-remote-platform'
import type { OctopodHostTransport } from '../../ssh/octopod-host-transport'

const conn: OctopodHostTransport = Object.create(null)
const host = getRemoteHostPlatform('linux-x64')
const mockExec = vi.mocked(execCommand)

/** Script a host whose default GC verdicts are unlocked, complete and dead unless overridden. */
function scriptHost(options: {
  listing: string[]
  liveness?: Record<string, 'LIVE' | 'DEAD' | 'UNKNOWN' | Error>
  removed: string[]
  /** Absent by default; raw journal or error overrides the read. */
  journal?: string | Error
  fenceHeld?: boolean
}): void {
  mockExec.mockImplementation(async (_conn, command: string) => {
    if (command.includes('__OCTOPOD_RECORD_PRESENT__') && command.includes('transaction.json')) {
      if (options.journal instanceof Error) {
        throw options.journal
      }
      return options.journal === undefined
        ? '__OCTOPOD_RECORD_ABSENT__\n'
        : `__OCTOPOD_RECORD_PRESENT__\n${options.journal}`
    }
    if (command.includes('.octopod-activation-transaction') && command.includes('LOCKED')) {
      return options.fenceHeld ? 'LOCKED' : 'OPEN'
    }
    if (command.includes('-mindepth 1 -maxdepth 1')) {
      return options.listing.join('\n')
    }
    if (command.includes('.install-lock')) {
      return 'OPEN'
    }
    if (command.includes('.store-lock') && command.includes('mkdir')) {
      return 'OK'
    }
    if (command.includes('.install-complete')) {
      return 'COMPLETE'
    }
    if (command.includes('.octopod-pid')) {
      const dir = Object.keys(options.liveness ?? {}).find((name) => command.includes(name))
      const result = dir ? (options.liveness?.[dir] ?? 'DEAD') : 'DEAD'
      if (result instanceof Error) {
        throw result
      }
      return result
    }
    if (command.startsWith('mv ')) {
      const match = command.match(/'([^']*)'/)
      if (match) {
        options.removed.push(match[1].split('/').pop() ?? '')
      }
      return 'MOVED'
    }
    return ''
  })
}

describe('octopod GC', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('scopes its remote listing to the octopod namespace', async () => {
    const removed: string[] = []
    scriptHost({ listing: [], removed })
    await gcOldOctopodVersions({
      conn,
      host,
      remoteHome: '/home/u',
      currentDirAbsPath: '/home/u/.shield-remote/octopod-0.2.0+bb',
      record: emptyOctopodActivationRecord()
    })
    const listCommand = mockExec.mock.calls
      .map((call) => String(call[1]))
      .find((c) => c.includes('find'))
    expect(listCommand).toContain("-name 'octopod-*'")
    expect(listCommand).not.toContain("-name 'relay-*'")
  })

  it('leaves relay directories alone even when the host hands them to it', async () => {
    // Even a widened listing must not authorize removal of another model's namespace.
    const removed: string[] = []
    scriptHost({
      listing: ['relay-0.1.0+aa', 'relay-0.0.9+ff', 'octopod-0.1.0+aa'],
      removed
    })
    await gcOldOctopodVersions({
      conn,
      host,
      remoteHome: '/home/u',
      currentDirAbsPath: '/home/u/.shield-remote/octopod-0.2.0+bb',
      record: emptyOctopodActivationRecord()
    })
    expect(removed).toEqual(['octopod-0.1.0+aa'])
  })

  it('never removes the active or the previous version', async () => {
    const removed: string[] = []
    scriptHost({
      listing: ['octopod-0.1.0+01d', 'octopod-0.2.0+9ee0', 'octopod-0.3.0+cc0'],
      removed
    })
    await gcOldOctopodVersions({
      conn,
      host,
      remoteHome: '/home/u',
      currentDirAbsPath: '/home/u/.shield-remote/octopod-0.3.0+cc0',
      record: {
        ...emptyOctopodActivationRecord(),
        active: '0.3.0+cc0',
        previous: '0.2.0+9ee0'
      }
    })
    expect(removed).toEqual(['octopod-0.1.0+01d'])
  })

  it('never removes the version a live daemon was forked from', async () => {
    const removed: string[] = []
    scriptHost({ listing: ['octopod-0.1.0+01d', 'octopod-0.0.9+01de'], removed })
    await gcOldOctopodVersions({
      conn,
      host,
      remoteHome: '/home/u',
      currentDirAbsPath: '/home/u/.shield-remote/octopod-0.3.0+cc0',
      record: { ...emptyOctopodActivationRecord(), active: '0.3.0+cc0' },
      liveDaemonVersion: '0.1.0+01d'
    })
    expect(removed).toEqual(['octopod-0.0.9+01de'])
  })

  it('treats an unanswerable liveness probe as in use', async () => {
    const removed: string[] = []
    scriptHost({
      listing: ['octopod-0.1.0+bb0', 'octopod-0.0.9+dead'],
      liveness: { 'octopod-0.1.0+bb0': 'UNKNOWN', 'octopod-0.0.9+dead': 'DEAD' },
      removed
    })
    await gcOldOctopodVersions({
      conn,
      host,
      remoteHome: '/home/u',
      currentDirAbsPath: '/home/u/.shield-remote/octopod-0.3.0+cc0',
      record: emptyOctopodActivationRecord()
    })
    expect(removed).toEqual(['octopod-0.0.9+dead'])
  })

  it('stops before later versions when liveness probe termination is unconfirmed', async () => {
    const removed: string[] = []
    const error = Object.assign(new Error('Liveness probe termination is unconfirmed'), {
      sshChannelCloseConfirmed: false
    })
    scriptHost({
      listing: ['octopod-0.1.0+bb0', 'octopod-0.0.9+dead'],
      liveness: { 'octopod-0.1.0+bb0': error },
      removed
    })

    await expect(
      gcOldOctopodVersions({
        conn,
        host,
        remoteHome: '/home/u',
        currentDirAbsPath: '/home/u/.shield-remote/octopod-0.3.0+cc0',
        record: emptyOctopodActivationRecord()
      })
    ).rejects.toBe(error)

    expect(removed).toEqual([])
    expect(mockExec).toHaveBeenCalledTimes(6)
    expect(mockExec.mock.calls.at(-1)?.[1]).toContain('.octopod-pid')
  })

  it('keeps a version after an ordinary probe failure and checks later versions', async () => {
    const removed: string[] = []
    scriptHost({
      listing: ['octopod-0.1.0+bb0', 'octopod-0.0.9+dead'],
      liveness: { 'octopod-0.1.0+bb0': new Error('Probe failed') },
      removed
    })

    await gcOldOctopodVersions({
      conn,
      host,
      remoteHome: '/home/u',
      currentDirAbsPath: '/home/u/.shield-remote/octopod-0.3.0+cc0',
      record: emptyOctopodActivationRecord()
    })

    expect(removed).toEqual(['octopod-0.0.9+dead'])
  })

  it('collects the runtime store only when the caller names its runtime pins', async () => {
    const removed: string[] = []
    scriptHost({ listing: [], removed })
    const options = {
      conn,
      host,
      remoteHome: '/home/u',
      currentDirAbsPath: '/home/u/.shield-remote/octopod-0.2.0+bb',
      record: emptyOctopodActivationRecord()
    }
    const inventories = (): number =>
      mockExec.mock.calls.filter(([, command]) => String(command).includes('RUNTIME_STORE')).length

    await gcOldOctopodVersions(options)
    expect(inventories()).toBe(0)

    await gcOldOctopodVersions({ ...options, nodeRuntimePins: ['a'.repeat(64)] })
    expect(inventories()).toBe(1)
  })

  describe('with an activation transaction in flight', () => {
    const listing = ['octopod-0.1.0+01d', 'octopod-0.2.0+9ee0', 'octopod-0.3.0+cc0']
    const record = { ...emptyOctopodActivationRecord(), active: '0.3.0+cc0' }
    const run = () =>
      gcOldOctopodVersions({
        conn,
        host,
        remoteHome: '/home/u',
        currentDirAbsPath: '/home/u/.shield-remote/octopod-0.3.0+cc0',
        record
      })

    it('keeps every slot a pending journal names', async () => {
      const removed: string[] = []
      const before = { ...record, previous: '0.1.0+01d' }
      scriptHost({
        listing,
        removed,
        journal: serializeOctopodActivationTransaction(
          createOctopodActivationTransaction({
            transactionId: '7f1c2a7e-6c1b-4a8e-9f0e-0a1b2c3d4e5f',
            candidateVersion: '0.2.0+9ee0',
            recordBefore: before,
            snapshotDirName: 'pre-0.2.0+9ee0-1',
            now: new Date(0)
          })
        )
      })
      await run()
      expect(removed).toEqual([])
    })

    it.each([
      ['an unreadable journal', { journal: '{"schemaVersion":99}' }],
      ['a journal read with no answer', { journal: new Error('lost') }],
      ['a held fence without a journal', { fenceHeld: true }]
    ])('collects nothing behind %s', async (_name, state) => {
      const removed: string[] = []
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      scriptHost({ listing, removed, ...state })
      await run()
      expect(removed).toEqual([])
      expect(mockExec.mock.calls.some(([, command]) => command.includes('-mindepth 1'))).toBe(false)
    })

    it('never names a snapshot or rescue copy as a candidate', async () => {
      const removed: string[] = []
      scriptHost({ listing: [...listing, 'octopod-state-snapshots'], removed })
      await run()
      expect(removed).not.toContain('octopod-state-snapshots')
    })
  })
})
