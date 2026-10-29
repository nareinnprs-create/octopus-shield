import type * as ExecCommandModule from '../../ssh/remote-exec/remote-exec-command'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../ssh/remote-exec/remote-exec-command', async (importOriginal) => ({
  ...(await importOriginal<typeof ExecCommandModule>()),
  execCommand: vi.fn()
}))

import { execCommand } from '../../ssh/remote-exec/remote-exec-command'
import type { OctopodHostTransport } from '../../ssh/octopod-host-transport'
import { getRemoteHostPlatform } from '../../ssh/ssh-remote-platform'
import { octopodLivenessProbeCommand, type OctopodLaunchSpec } from './octopod-remote-launch'
import {
  OctopodWindowsLaunchRefusedError,
  readWindowsOctopodLaunchReport,
  readWindowsOctopodSlotEntry,
  windowsOctopodLaunchCommand,
  windowsOctopodLaunchRuntimeCommand
} from './octopod-remote-launch-windows'
import { parseOctopodStopOutcome, stopOctopodCommand } from './octopod-remote-process-control'
import { octopodReadinessWaitCommand } from './octopod-remote-readiness-wait'
import { remoteOctopodBuildHashCommand, readRemoteOctopodBuildHash } from './octopod-remote-build-hash'
import {
  readBoundedOctopodRemoteRecord,
  writeAtomicOctopodRemoteRecord
} from './octopod-remote-record-file'
import { launchOctopodAndAwaitReadiness } from './octopod-remote-runtime-control'
import { probeActiveOctopodReadiness } from '../../ssh/octopod-active-readiness'
import { completeRemoteOctopodManagedStop } from '../lifecycle/octopod-managed-remote-stop'
import {
  installOctopodWindowsHostScript,
  octopodWindowsNodeCommandLine,
  octopodWindowsPinnedNodePath,
  OctopodWindowsCommandLineError
} from './octopod-remote-windows-node'
import {
  OCTOPOD_WINDOWS_HOST_SCRIPT,
  OCTOPOD_WINDOWS_HOST_SCRIPT_FILENAME
} from '../host-state/octopod-windows-host-script'
import type { OctopodSlotOptions } from '../../ssh/octopod-recovery-slot'
import { NODE_RUNTIME_ASSETS } from '../../../shared/node-runtime-pin'

const mockExec = vi.mocked(execCommand)
const host = getRemoteHostPlatform('win32-x64')
const base = 'C:/Users/u/.shield-remote'
const slot = `${base}/octopod-0.2.0+bb01`
const sha = NODE_RUNTIME_ASSETS['win32-x64'].executableSha256
const NODE = `C:\\Users\\u\\.shield-remote\\runtimes\\node-${sha}\\node.exe`
const SCRIPT = `${base}/${OCTOPOD_WINDOWS_HOST_SCRIPT_FILENAME}`
const SLOT_NODE = 'C:\\Users\\u\\.shield-remote\\runtimes\\node-ab\\node.exe'
const spec: OctopodLaunchSpec = {
  remoteInstallDir: slot,
  nodePath: 'C:/host/node.exe',
  fullVersion: '0.2.0+bb01',
  userDataDir: 'C:/Users/u/.shield',
  bindHost: '127.0.0.1',
  port: 7777,
  activationRoot: `${base}/.octopod-activation-transaction`
}

function windowsConn(): { conn: OctopodHostTransport; writes: [string, string][] } {
  const writes: [string, string][] = []
  const conn: OctopodHostTransport = Object.assign(Object.create(null), {
    writeFile: async (path: string, contents: string) => {
      writes.push([path, contents])
    }
  })
  return { conn, writes }
}

function encoded(marker: string, value: string): string {
  return `${marker} ${Buffer.from(value).toString('base64')}\r\n`
}

beforeEach(() => {
  mockExec.mockReset()
})

describe('Windows octopod commands run node.exe directly', () => {
  const commands = (): [string, string][] => [
    ['launch runtime', windowsOctopodLaunchRuntimeCommand(host, slot)],
    ['launch', windowsOctopodLaunchCommand(host, spec, SLOT_NODE)],
    ['readiness wait', octopodReadinessWaitCommand(host, slot, 20)],
    ['liveness', octopodLivenessProbeCommand(host, slot)],
    ['stop', stopOctopodCommand(host, slot, { waitSeconds: 20, nodePath: spec.nodePath })],
    ['build hash', remoteOctopodBuildHashCommand(host, slot)]
  ]

  it('selects the split server entry and preserves older host-script answers', () => {
    const server = `${slot}/octopod-server.js`
    const selected = readWindowsOctopodSlotEntry(encoded('__OCTOPOD_ENTRY__', server), host, slot)
    expect(selected).toBe(server)
    expect(windowsOctopodLaunchCommand(host, spec, SLOT_NODE, selected)).toContain(
      `${server} --windows-breakaway-launch`
    )
    expect(readWindowsOctopodSlotEntry(encoded('__OCTOPOD_RUNTIME__', SLOT_NODE), host, slot)).toBe(
      `${slot}/octopod.js`
    )
  })

  it.each(commands())('%s: no PowerShell hop, no encoding, no WMI or signal', (_name, command) => {
    expect(command).toMatch(/^C:\\Users\\u\\\.shield-remote\\runtimes\\node-[0-9a-f]+\\node\.exe /u)
    expect(command).not.toMatch(
      /EncodedCommand|powershell|pwsh|cmd\.exe|ExecutionPolicy|Cim|Wmi|taskkill|SIGTERM|kill -/iu
    )
    // Neither DefaultShell may expand or reinterpret arguments.
    expect(command).not.toMatch(/[%$`']/u)
  })

  it('host ops use the client pin; only the launch uses the slot runtime', () => {
    expect(octopodWindowsPinnedNodePath(host, base)).toBe(`${base}/runtimes/node-${sha}/node.exe`)
    expect(octopodLivenessProbeCommand(host, slot)).toBe(`${NODE} ${SCRIPT} liveness ${slot}`)
    expect(stopOctopodCommand(host, slot, { waitSeconds: 20, justLaunched: true })).toBe(
      `${NODE} ${SCRIPT} stop ${slot} "20" "1"`
    )
  })

  it('golden: the two launch lines', () => {
    expect(windowsOctopodLaunchRuntimeCommand(host, slot)).toBe(
      `${NODE} ${SCRIPT} slot-runtime ${slot} clear-stop-request`
    )
    expect(windowsOctopodLaunchCommand(host, spec, SLOT_NODE)).toMatchInlineSnapshot(
      `"C:\\Users\\u\\.shield-remote\\runtimes\\node-ab\\node.exe C:/Users/u/.shield-remote/octopod-0.2.0+bb01/octopod.js --windows-breakaway-launch --stdout-file C:/Users/u/.shield-remote/octopod-0.2.0+bb01/.octopod-readiness --stderr-file C:/Users/u/.shield-remote/octopod-0.2.0+bb01/octopod.log --stderr-keep-previous --process-file C:/Users/u/.shield-remote/octopod-0.2.0+bb01/.octopod-process.json --env OSHIELD_VERSION=0.2.0+bb01 --env OSHIELD_USER_DATA=C:/Users/u/.shield --env OSHIELD_OCTOPOD_MANAGED_ACTIVATION_ROOT=C:/Users/u/.shield-remote/.octopod-activation-transaction --octopod-args --json --bind "127.0.0.1" --port "7777""`
    )
  })

  it('passes the managed idle-exit fence through the breakaway environment', () => {
    const command = windowsOctopodLaunchCommand(
      host,
      { ...spec, activationRoot: 'C:/Users/u/.shield-remote/.octopod-activation-transaction' },
      SLOT_NODE
    )
    expect(command).toContain(
      '--env OSHIELD_OCTOPOD_MANAGED_ACTIVATION_ROOT=C:/Users/u/.shield-remote/.octopod-activation-transaction --octopod-args'
    )
    expect(command).not.toMatch(/[%$`']/u)
  })

  it('never polls across SSH: runtime, launch, then one host-side wait', async () => {
    mockExec
      .mockResolvedValueOnce(
        encoded('__OCTOPOD_RUNTIME__', SLOT_NODE) +
          encoded('__OCTOPOD_ENTRY__', `${slot}/octopod-server.js`)
      )
      .mockResolvedValueOnce(
        'OSHIELD_OCTOPOD_LAUNCH {"method":"breakaway","pid":4242,"inJob":false}\r\n'
      )
      .mockResolvedValueOnce(
        encoded(
          '__OCTOPOD_READINESS__',
          `${JSON.stringify({ type: 'shield_server_ready', runtimeId: 'r1' })}\n`
        )
      )
    const sleep = vi.fn(async () => {})
    const result = await launchOctopodAndAwaitReadiness(
      { conn: Object.create(null), host, readinessTimeoutMs: 60_000, sleep },
      spec
    )
    expect(result).toMatchObject({ state: 'ready', readiness: { runtimeId: 'r1' } })
    expect(mockExec).toHaveBeenCalledTimes(3)
    expect(String(mockExec.mock.calls[1]?.[1]).startsWith(`${SLOT_NODE} `)).toBe(true)
    expect(String(mockExec.mock.calls[1]?.[1])).toContain(
      `${slot}/octopod-server.js --windows-breakaway-launch`
    )
    expect(sleep).not.toHaveBeenCalled()
  })
})

describe('the active-slot readiness probe on Windows', () => {
  it('reads readiness through the host script instead of the POSIX head command', async () => {
    mockExec
      .mockResolvedValueOnce('LIVE\r\n')
      .mockResolvedValueOnce(
        encoded(
          '__OCTOPOD_READINESS__',
          `${JSON.stringify({ type: 'shield_server_ready', runtimeId: 'r1' })}\n`
        )
      )
    const probe = probeActiveOctopodReadiness(
      { conn: Object.create(null), host, remoteInstallDir: slot },
      { buildHash: 'bb01', fullVersion: '0.2.0+bb01' }
    )

    // Identity may still be refused; launch support must allow the probe to reach the host.
    await probe.catch((error: unknown) => {
      expect(error).not.toMatchObject({ name: 'OctopodRemoteLaunchUnsupportedError' })
    })
    expect(mockExec.mock.calls[1]?.[1]).toBe(
      `${NODE} ${SCRIPT} readiness-wait ${slot}/.octopod-readiness "262144" "0"`
    )
  })
})

describe('Windows command lines for both DefaultShells', () => {
  it('double-quotes arguments with spaces or leading digits, and passes the rest bare', () => {
    expect(
      octopodWindowsNodeCommandLine('C:/rt/node.exe', ['C:/Users/Ann Lee/x', '20', 'stop'])
    ).toBe('C:\\rt\\node.exe "C:/Users/Ann Lee/x" "20" stop')
  })

  it('falls back to one unencoded powershell -Command when node.exe itself needs quoting', () => {
    expect(
      octopodWindowsNodeCommandLine("C:/Users/Ann O'Lee/rt/node.exe", [
        "C:/Users/Ann O'Lee/x",
        'stop'
      ])
    ).toBe(
      `powershell.exe -NoProfile -NonInteractive -Command "& 'C:\\Users\\Ann O''Lee\\rt\\node.exe' 'C:/Users/Ann O''Lee/x' 'stop'"`
    )
  })

  it.each(['C:/Users/100%/x', 'C:/Users/$me/x', 'C:/Users/a`b/x'])(
    'refuses %s rather than letting a shell expand it',
    (value) => {
      expect(() => octopodWindowsNodeCommandLine('C:/rt/node.exe', [value])).toThrow(
        OctopodWindowsCommandLineError
      )
    }
  )
})

describe('Windows launch report', () => {
  it('reads a PID, a refusal, or a failure', () => {
    expect(
      readWindowsOctopodLaunchReport('OSHIELD_OCTOPOD_LAUNCH {"method":"breakaway","pid":9,"inJob":false}')
    ).toBe(9)
    expect(() =>
      readWindowsOctopodLaunchReport(
        'OSHIELD_OCTOPOD_LAUNCH {"method":"unavailable","reason":"breakaway-denied","step":"create-process","code":5}'
      )
    ).toThrow(OctopodWindowsLaunchRefusedError)
    expect(() =>
      readWindowsOctopodLaunchReport(
        'OSHIELD_OCTOPOD_LAUNCH {"method":"failed","reason":"failed","step":"open-stdout","code":32}'
      )
    ).toThrow('open-stdout (code 32)')
    expect(() =>
      readWindowsOctopodLaunchReport('OSHIELD_RELAY_LAUNCH {"method":"breakaway","pid":9,"inJob":false}')
    ).toThrow('no launch report')
  })

  it('reads UNSUPPORTED as a stop refusal', () => {
    expect(parseOctopodStopOutcome('UNSUPPORTED')).toBe('unsupported')
  })
})

describe('Windows build hash and host script', () => {
  it('reads the same marker as POSIX', async () => {
    mockExec.mockResolvedValueOnce('__OCTOPOD_BUILD_HASH__ ABC123DEF4567890\r\n')
    await expect(readRemoteOctopodBuildHash({ conn: Object.create(null), host }, slot)).resolves.toBe(
      'abc123def4567890'
    )
  })

  it('stages a missing host script through a partial file that installs itself, once per connection', async () => {
    const { conn, writes } = windowsConn()
    mockExec
      .mockRejectedValueOnce(new Error('Cannot find module'))
      .mockResolvedValueOnce('OCTOPOD_HOST_SCRIPT_PRESENT\r\n')
    await installOctopodWindowsHostScript({ conn, host }, base)
    await installOctopodWindowsHostScript({ conn, host }, base)
    expect(writes).toHaveLength(1)
    const [partial, contents] = writes[0] ?? []
    expect(contents).toBe(OCTOPOD_WINDOWS_HOST_SCRIPT)
    expect(String(mockExec.mock.calls[0]?.[1])).toBe(`${NODE} ${SCRIPT} script-present`)
    expect(String(mockExec.mock.calls[1]?.[1])).toBe(`${NODE} ${partial} script-install ${SCRIPT}`)
    expect(mockExec).toHaveBeenCalledTimes(2)
  })

  it('never rewrites a host script that is already present', async () => {
    const { conn, writes } = windowsConn()
    mockExec.mockResolvedValueOnce('OCTOPOD_HOST_SCRIPT_PRESENT\r\n')
    await installOctopodWindowsHostScript({ conn, host }, base)
    expect(writes).toEqual([])
  })
})

describe('Windows host records', () => {
  it('decodes a present record and reads absent as absent', async () => {
    const { conn } = windowsConn()
    const target = { conn, host, remoteHome: 'C:/Users/u' }
    mockExec.mockResolvedValueOnce(encoded('__OCTOPOD_RECORD_PRESENT__', '{"owner":"Zoë"}'))
    await expect(readBoundedOctopodRemoteRecord(target, 'C:/r.json', 64)).resolves.toEqual({
      state: 'present',
      raw: '{"owner":"Zoë"}'
    })
    expect(String(mockExec.mock.calls[0]?.[1])).toBe(`${NODE} ${SCRIPT} record-read C:/r.json "64"`)
    mockExec.mockResolvedValueOnce('__OCTOPOD_RECORD_ABSENT__\r\n')
    await expect(readBoundedOctopodRemoteRecord(target, 'C:/r.json', 64)).resolves.toEqual({
      state: 'absent'
    })
    mockExec.mockResolvedValueOnce('')
    await expect(readBoundedOctopodRemoteRecord(target, 'C:/r.json', 64)).rejects.toThrow(
      'no verifiable answer'
    )
  })

  it('refuses a Windows record without the remote home that locates node.exe', async () => {
    await expect(
      readBoundedOctopodRemoteRecord({ conn: Object.create(null), host }, 'C:/r.json', 64)
    ).rejects.toThrow('remote home')
  })

  it('stages the contents as a file and never puts them on a command line', async () => {
    const { conn, writes } = windowsConn()
    mockExec.mockResolvedValueOnce('')
    const contents = '{"secret-ish":"record body"}'
    await writeAtomicOctopodRemoteRecord(
      { conn, host, remoteHome: 'C:/Users/u' },
      'C:/r.json',
      contents
    )
    expect(writes).toHaveLength(1)
    expect(writes[0]?.[0]).toMatch(/^C:\/r\.json\.partial\./u)
    expect(writes[0]?.[1]).toBe(contents)
    const command = String(mockExec.mock.calls[0]?.[1])
    expect(command).not.toContain('record body')
    expect(command.startsWith(`${NODE} ${SCRIPT} record-publish `)).toBe(true)
  })
})

describe('Windows managed stop', () => {
  it('hands octopod a staged request file, not JSON on argv', async () => {
    const { conn, writes } = windowsConn()
    const request = {
      schemaVersion: 1 as const,
      transactionId: '0b9f6a3e-9e2c-4c8e-8f58-4c0f6b1d2e3a',
      version: '0.2.0+bb01',
      runtimeId: 'r1',
      instance: { pid: 9, startedAtMs: 5, nonce: 'n', lockPath: 'C:/Users/u/.shield/octopod.lock' }
    }
    mockExec
      .mockResolvedValueOnce(encoded('__OCTOPOD_RUNTIME__', SLOT_NODE))
      .mockResolvedValueOnce(
        `${JSON.stringify({ ...request, kind: 'octopod_managed_stop_completion', verdict: 'live', receiptPersisted: false })}\r\n`
      )
      .mockResolvedValueOnce('')
    const options: OctopodSlotOptions = {
      conn,
      host,
      remoteHome: 'C:/Users/u',
      nodePath: 'C:/host/node.exe',
      userDataDir: 'C:/Users/u/.shield',
      bindHost: '127.0.0.1',
      port: 7777
    }
    await expect(completeRemoteOctopodManagedStop(options, request)).resolves.toMatchObject({
      verdict: 'live'
    })
    const [stagedPath, stagedBody] = writes[0] ?? ['', '']
    expect(JSON.parse(stagedBody)).toEqual(request)
    expect(String(mockExec.mock.calls[0]?.[1])).toBe(`${NODE} ${SCRIPT} slot-runtime ${slot}`)
    const run = String(mockExec.mock.calls[1]?.[1])
    expect(run).not.toContain(request.transactionId)
    expect(run).toBe(
      `${SLOT_NODE} ${slot}/octopod.js --complete-managed-stop --request-file ${stagedPath}`
    )
    expect(String(mockExec.mock.calls[2]?.[1])).toBe(`${NODE} ${SCRIPT} remove-file ${stagedPath}`)
  })
})
