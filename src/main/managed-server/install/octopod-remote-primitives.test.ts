import type * as ExecCommandModule from '../../ssh/remote-exec/remote-exec-command'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../ssh/remote-exec/remote-exec-command', async (importOriginal) => ({
  ...(await importOriginal<typeof ExecCommandModule>()),
  execCommand: vi.fn(),
  isUnconfirmedSshCommandTermination: (error: unknown) =>
    error instanceof Error && error.message === 'channel lost'
}))

vi.mock('../../ssh/ssh-remote-platform-detection', () => ({ detectRemoteHostPlatform: vi.fn() }))
vi.mock('../host-state/octopod-windows-host-preparation', () => ({
  prepareWindowsOctopodHost: vi.fn()
}))

import { execCommand } from '../../ssh/remote-exec/remote-exec-command'
import { detectRemoteHostPlatform } from '../../ssh/ssh-remote-platform-detection'
import { prepareWindowsOctopodHost } from '../host-state/octopod-windows-host-preparation'
import { resolveOctopodRemoteContext } from './octopod-remote-context'
import { getRemoteHostPlatform } from '../../ssh/ssh-remote-platform'
import type { OctopodHostTransport } from '../../ssh/octopod-host-transport'
import {
  readBoundedOctopodRemoteRecord,
  writeAtomicOctopodRemoteRecord
} from './octopod-remote-record-file'
import {
  readOctopodActivationRecord,
  writeOctopodActivationRecord
} from '../activation/octopod-activation-record-store'
import { emptyOctopodActivationRecord } from '../activation/octopod-activation-record'
import { readRemoteOctopodBuildHash } from './octopod-remote-build-hash'
import {
  launchOctopodSlotAndAwaitReadiness,
  OctopodActiveReadinessError,
  probeActiveOctopodReadiness
} from '../../ssh/octopod-active-readiness'
import { parseOctopodReadinessOutput } from './octopod-remote-launch'

const mockExec = vi.mocked(execCommand)
const linux = getRemoteHostPlatform('linux-x64')
const windows = getRemoteHostPlatform('win32-x64')
const conn: OctopodHostTransport = Object.create(null)
const target = { conn, host: linux }
const BUILD_HASH = 'abc123def4567890'

function readyLine(
  buildHash = BUILD_HASH,
  daemon: { coverage?: 'pty-spawn' | 'handshake'; platform?: string } = {}
): string {
  const selfTest = { ok: true, verdict: 'healthy', durationMs: 5 }
  return JSON.stringify({
    type: 'shield_server_ready',
    runtimeId: 'r1',
    boundEndpoint: 'ws://127.0.0.1:7777',
    advertisedEndpoint: null,
    managedWslCliReconciliation: 'settled',
    pairing: { available: false, reason: 'disabled_by_operator', guidance: 'n/a' },
    health: {
      buildHash,
      buildVersion: '0.2.0+bb01',
      nodeVersion: '24.21.0',
      nodeAbi: '137',
      platform: daemon.platform ?? 'linux',
      arch: 'x64',
      pid: 1,
      terminalDaemon: {
        state: 'live',
        ownsFreshSessions: true,
        pid: 2,
        buildVersion: '0.2.0+bb01',
        entryPath: '/x/daemon-entry.js',
        protocolVersion: 38,
        selfTest:
          'coverage' in daemon
            ? { ...selfTest, ...(daemon.coverage ? { coverage: daemon.coverage } : {}) }
            : { ...selfTest, coverage: 'pty-spawn' }
      }
    }
  })
}

beforeEach(() => {
  mockExec.mockReset()
})

describe('octopod host record files', () => {
  it('tells an absent record from one whose read gave no answer', async () => {
    mockExec.mockResolvedValueOnce('__OCTOPOD_RECORD_ABSENT__\n')
    await expect(readBoundedOctopodRemoteRecord(target, '/r.json', 64)).resolves.toEqual({
      state: 'absent'
    })
    mockExec.mockResolvedValueOnce('__OCTOPOD_RECORD_PRESENT__\n{"a":1}')
    await expect(readBoundedOctopodRemoteRecord(target, '/r.json', 64)).resolves.toEqual({
      state: 'present',
      raw: '{"a":1}'
    })
    mockExec.mockResolvedValueOnce('')
    await expect(readBoundedOctopodRemoteRecord(target, '/r.json', 64)).rejects.toThrow(
      'no verifiable answer'
    )
  })

  it('keeps the partial file when the write may still be running on the host', async () => {
    mockExec.mockRejectedValueOnce(new Error('channel lost'))
    await expect(writeAtomicOctopodRemoteRecord(target, '/r.json', '{}')).rejects.toThrow()
    expect(mockExec).toHaveBeenCalledOnce()
    mockExec.mockRejectedValueOnce(new Error('exit 1')).mockResolvedValueOnce('')
    await expect(writeAtomicOctopodRemoteRecord(target, '/r.json', '{}')).rejects.toThrow()
    expect(String(mockExec.mock.calls.at(-1)?.[1])).toContain('rm -f')
  })

  it('refuses a Windows read that names no pinned node.exe to run it', async () => {
    await expect(
      readBoundedOctopodRemoteRecord({ conn, host: windows }, 'C:/r.json', 64)
    ).rejects.toThrow('pinned node.exe')
    expect(mockExec).not.toHaveBeenCalled()
  })
})

describe('activation record store', () => {
  const options = { conn, host: linux, remoteHome: '/home/u' }
  const newer = JSON.stringify({ ...emptyOctopodActivationRecord(), schemaVersion: 2 })

  it('reads a lost read as an error, never as an empty record', async () => {
    mockExec.mockRejectedValueOnce(new Error('channel lost'))
    await expect(readOctopodActivationRecord(options)).rejects.toThrow('channel lost')
  })

  it('reads a newer schema as unreadable and never overwrites it', async () => {
    mockExec.mockResolvedValue(`__OCTOPOD_RECORD_PRESENT__\n${newer}`)
    await expect(readOctopodActivationRecord(options)).rejects.toThrow('schemaVersion 2')
    await expect(writeOctopodActivationRecord(options, emptyOctopodActivationRecord())).rejects.toThrow(
      'Refusing to overwrite'
    )
    expect(mockExec.mock.calls.some(([, command]) => String(command).includes('mv -f'))).toBe(false)
  })

  it('writes atomically when the host has no record yet', async () => {
    mockExec.mockResolvedValueOnce('__OCTOPOD_RECORD_ABSENT__\n').mockResolvedValueOnce('')
    await writeOctopodActivationRecord(options, emptyOctopodActivationRecord())
    expect(String(mockExec.mock.calls[1]?.[1])).toMatch(/printf %s .* && mv -f /s)
  })
})

describe('installed build identity and readiness', () => {
  const slot = { ...target, remoteInstallDir: '/home/u/.shield-remote/octopod-0.2.0+bb01' }
  const expectation = { buildHash: BUILD_HASH, fullVersion: '0.2.0+bb01' }

  it('reads the 16-hex build hash the slot reports', async () => {
    mockExec.mockResolvedValueOnce(`noise\n__OCTOPOD_BUILD_HASH__ ${BUILD_HASH.toUpperCase()}\n`)
    await expect(readRemoteOctopodBuildHash(target, '/slot')).resolves.toBe(BUILD_HASH)
    mockExec.mockResolvedValueOnce('')
    await expect(readRemoteOctopodBuildHash(target, '/slot')).rejects.toThrow()
  })

  it.each([
    ['DEAD', 'exited'],
    ['UNKNOWN', 'unverifiable'],
    ['', 'unverifiable']
  ])('reports a %j liveness probe as %s', async (liveness, verdict) => {
    mockExec.mockResolvedValueOnce(liveness)
    await expect(probeActiveOctopodReadiness(slot, expectation)).rejects.toMatchObject({
      verdict
    })
  })

  it('accepts only the expected build once the process is live', async () => {
    mockExec.mockResolvedValueOnce('LIVE').mockResolvedValueOnce(`${readyLine()}\n`)
    await expect(probeActiveOctopodReadiness(slot, expectation)).resolves.toMatchObject({
      runtimeId: 'r1'
    })
    mockExec
      .mockResolvedValueOnce('LIVE')
      .mockResolvedValueOnce(`${readyLine('ffffffffffffffff')}\n`)
    const rejected = probeActiveOctopodReadiness(slot, expectation)
    await expect(rejected).rejects.toBeInstanceOf(OctopodActiveReadinessError)
    await expect(rejected).rejects.toMatchObject({ verdict: 'rejected' })
  })

  it.each([
    ['a spawn-probed PTY', { coverage: 'pty-spawn' as const }],
    [
      'a handshake on a host whose daemon never spawn-probes',
      { coverage: 'handshake' as const, platform: 'win32' }
    ],
    ['an older build that does not report coverage', { coverage: undefined }]
  ])('accepts %s', async (_name, daemon) => {
    mockExec
      .mockResolvedValueOnce('LIVE')
      .mockResolvedValueOnce(`${readyLine(BUILD_HASH, daemon)}\n`)
    await expect(probeActiveOctopodReadiness(slot, expectation)).resolves.toMatchObject({
      runtimeId: 'r1'
    })
  })

  it('rejects handshake-only coverage on a host whose daemon should spawn a PTY', async () => {
    mockExec
      .mockResolvedValueOnce('LIVE')
      .mockResolvedValueOnce(`${readyLine(BUILD_HASH, { coverage: 'handshake' })}\n`)
    await expect(probeActiveOctopodReadiness(slot, expectation)).rejects.toMatchObject({
      verdict: 'rejected',
      message: expect.stringContaining("coverage 'handshake'")
    })
  })

  it('applies the same coverage rule to a slot it launches', async () => {
    mockExec
      .mockResolvedValueOnce('4242')
      .mockResolvedValueOnce(`${readyLine(BUILD_HASH, { coverage: 'handshake' })}\n`)
    await expect(
      launchOctopodSlotAndAwaitReadiness(
        { ...target, readinessTimeoutMs: 1_000, sleep: async () => {} },
        {
          remoteInstallDir: slot.remoteInstallDir,
          nodePath: '/usr/bin/node',
          fullVersion: '0.2.0+bb01',
          userDataDir: '/home/u/.shield',
          bindHost: '127.0.0.1',
          port: 7777,
          activationRoot: '/home/u/.shield-remote/.octopod-activation-transaction'
        },
        expectation
      )
    ).rejects.toMatchObject({ verdict: 'rejected' })
  })

  it('reads readiness once even when the client was descheduled past its deadline', async () => {
    mockExec.mockResolvedValueOnce('4242').mockResolvedValueOnce(`${readyLine(BUILD_HASH)}\n`)
    await expect(
      launchOctopodSlotAndAwaitReadiness(
        { ...target, readinessTimeoutMs: 0, sleep: async () => {} },
        {
          remoteInstallDir: slot.remoteInstallDir,
          nodePath: '/usr/bin/node',
          fullVersion: '0.2.0+bb01',
          userDataDir: '/home/u/.shield',
          bindHost: '127.0.0.1',
          port: 7777,
          activationRoot: '/home/u/.shield-remote/.octopod-activation-transaction'
        },
        expectation
      )
    ).resolves.toMatchObject({ runtimeId: 'r1' })
  })
})

describe('readiness parsing bounds', () => {
  it('waits on a half-written last line but rejects a finished invalid one', () => {
    expect(parseOctopodReadinessOutput('{"type":"shield_ser')).toEqual({ state: 'pending' })
    expect(parseOctopodReadinessOutput('{"type":"shield_ser\n')).toMatchObject({
      state: 'malformed'
    })
  })

  it('rejects a payload over the size cap', () => {
    expect(parseOctopodReadinessOutput('x'.repeat(256 * 1024 + 1))).toMatchObject({
      state: 'malformed'
    })
  })
})

describe('octopod remote context', () => {
  it('prepares a Windows host (runtime, host script) before reading the activation record', async () => {
    vi.mocked(detectRemoteHostPlatform).mockResolvedValueOnce(windows)
    const order: string[] = []
    vi.mocked(prepareWindowsOctopodHost).mockImplementationOnce(async () => {
      order.push('prepare')
    })
    mockExec.mockImplementation(async (_conn, command: string) => {
      if (command.includes('record-read')) {
        order.push('record')
        return '__OCTOPOD_RECORD_ABSENT__\r\n'
      }
      return 'C:\\Users\\u\r\n'
    })
    const sshTarget = { id: 't', label: 't', host: 'h', port: 22, username: 'u' }
    const context = await resolveOctopodRemoteContext(sshTarget, conn)
    expect(context).toMatchObject({ serverTarget: 'win32-x64', remoteHome: 'C:/Users/u' })
    expect(vi.mocked(prepareWindowsOctopodHost).mock.calls[0]?.[0]).toMatchObject({
      remoteHome: 'C:/Users/u',
      serverTarget: 'win32-x64'
    })
    expect(order).toEqual(['prepare', 'record'])
  })
})
