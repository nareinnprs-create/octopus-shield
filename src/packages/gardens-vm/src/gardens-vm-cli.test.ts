import { describe, expect, it } from 'vitest'
import { formatVmInspection, parseGardensVmCommand, runGardensVmCli } from './gardens-vm-cli'
import { GardensVmManager } from './gardens-vm'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { VmBackend, VmDiskSnapshot, VmHandle, VmInspectInfo, VmSpec } from './vm-backend'

describe('command parsing', () => {
  it('keeps boolean flags boolean and values string', () => {
    expect(parseGardensVmCommand(['create', 'vm', '--ssh'])).toEqual({
      command: 'create',
      positional: ['vm'],
      flags: new Map([['ssh', true]])
    })
    expect(
      parseGardensVmCommand(['create', 'vm', '--ssh', '--disk', '0.25']).flags.get('disk')
    ).toBe('0.25')
    expect(parseGardensVmCommand(['rollback', 'vm', 'base']).positional).toEqual(['vm', 'base'])
    expect(parseGardensVmCommand(['status', 'eng-7-det']).positional).toEqual(['eng-7-det'])
  })
})

describe('inspection formatting (pure)', () => {
  it('renders one fact per line and omits unknowns', () => {
    const info: VmInspectInfo = {
      name: 'eng-7-det',
      backend: 'qemu',
      state: 'running',
      pid: 4242,
      pidAlive: true,
      uptimeMs: 65_000,
      imageRef: 'C:\\iso\\alpine.iso',
      diskPath: 'C:\\gardens\\eng-7-det.qcow2',
      diskGb: 0.25,
      diskBytesOnHost: 208896,
      memoryMb: 512,
      vcpus: 1,
      sshHostPort: 2222,
      qmpPort: 4444,
      snapshots: [{ id: '1', name: 'base', vmStateSizeBytes: 0, dateEpochMs: 0 }]
    }
    const lines = formatVmInspection(info)
    expect(lines[0]).toBe('state     running')
    expect(lines[1]).toBe('pid       4242 (alive)')
    expect(lines[2]).toBe('uptime    65s')
    expect(lines.find((line) => line.startsWith('ports'))).toBe(
      'ports     ssh 127.0.0.1:2222, qmp 127.0.0.1:4444'
    )
    expect(lines.find((line) => line.startsWith('snapshots'))).toBe('snapshots base')
    expect(lines.find((line) => line.startsWith('disk'))).toContain('host 208896 bytes')

    const minimal = formatVmInspection({
      name: 'x',
      backend: 'hyperv',
      state: 'stopped',
      pidAlive: false,
      snapshots: []
    })
    expect(minimal.find((line) => line.startsWith('pid'))).toBe('pid       none')
    expect(minimal.find((line) => line.startsWith('uptime'))).toBeUndefined()
    expect(minimal.find((line) => line.startsWith('ports'))).toBe('ports     none')
    expect(minimal.find((line) => line.startsWith('snapshots'))).toBe('snapshots (none)')
  })
})

describe('cli wiring for the new commands', () => {
  const cliBackend = (options: {
    inspectInfo?: VmInspectInfo
    snapshotResult?: { ok: true; path: string } | { ok: false; reason: string }
    rollbackResult?: { ok: true } | { ok: false; reason: string }
    snapshots?: VmDiskSnapshot[]
    createSshPort?: number
  }): VmBackend => {
    const created = (spec: VmSpec): VmHandle => ({
      id: spec.name,
      backend: 'qemu',
      state: 'created',
      name: spec.name,
      sshHostPort: options.createSshPort
    })
    return {
      id: 'qemu',
      available: async () => true,
      create: async (spec: VmSpec) => created(spec),
      start: async (handle: VmHandle) => ({ ...handle, state: 'running' }),
      stop: async (handle: VmHandle) => ({ ...handle, state: 'stopped' }),
      status: async () => 'stopped',
      delete: async () => {},
      snapshot: async () => options.snapshotResult ?? { ok: true, path: 'C:\\gardens\\d.qcow2' },
      rollbackSnapshot: async () => options.rollbackResult ?? { ok: true },
      listSnapshots: async () => ({ ok: true, snapshots: options.snapshots ?? [] }),
      inspect: async () =>
        options.inspectInfo ?? {
          name: 'eng-7-det',
          backend: 'qemu',
          state: 'stopped',
          pidAlive: false,
          snapshots: []
        }
    }
  }

  const runCli = async (manager: GardensVmManager, argv: string[]) => {
    const out: string[] = []
    const err: string[] = []
    const code = await runGardensVmCli({
      argv,
      env: { OSHIELD_GARDENS_SCOPE: 'eng-7' },
      manager,
      out: (line) => out.push(line),
      err: (line) => err.push(line)
    })
    return { code, out, err }
  }

  it('status <name> prints the enriched inspection', async () => {
    const manager = new GardensVmManager({
      env: { OSHIELD_GARDENS_SCOPE: 'eng-7' },
      backends: [
        cliBackend({
          inspectInfo: {
            name: 'eng-7-det',
            backend: 'qemu',
            state: 'running',
            pid: 4242,
            pidAlive: true,
            uptimeMs: 12_000,
            sshHostPort: 2222,
            qmpPort: 4444,
            snapshots: [{ id: '1', name: 'base', vmStateSizeBytes: 0, dateEpochMs: 0 }]
          }
        })
      ]
    })
    const { code, out } = await runCli(manager, ['status', 'eng-7-det'])
    expect(code).toBe(0)
    expect(out.join('\n')).toContain('pid       4242 (alive)')
    expect(out.join('\n')).toContain('snapshots base')
  })

  it('status without a name keeps the backend matrix view', async () => {
    const { code, out } = await runCli(
      new GardensVmManager({
        env: { OSHIELD_GARDENS_SCOPE: 'eng-7' },
        backends: [cliBackend({})]
      }),
      ['status']
    )
    expect(code).toBe(0)
    expect(out.join('\n')).toContain('OSHIELD_GARDENS_SCOPE=eng-7')
    expect(out.join('\n')).toContain('available')
  })

  it('create --ssh prints the reserved hostfwd port', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gardens-cli-ssh-test-'))
    try {
      const imageRef = join(dir, 'seed.iso')
      writeFileSync(imageRef, 'iso')
      const { code, out } = await runCli(
        new GardensVmManager({
          env: { OSHIELD_GARDENS_SCOPE: 'eng-7' },
          backends: [cliBackend({ createSshPort: 2222 })]
        }),
        ['create', 'eng-7-det', '--image-ref', imageRef, '--ssh']
      )
      expect(code).toBe(0)
      expect(out.join('\n')).toContain('ssh hostfwd reserved: 127.0.0.1:2222 -> guest :22')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('snapshot / list-snapshots print results; rollback refusal exits 3 with the reason', async () => {
    const manager = new GardensVmManager({
      env: { OSHIELD_GARDENS_SCOPE: 'eng-7' },
      backends: [
        cliBackend({
          snapshots: [{ id: '1', name: 'base', vmStateSizeBytes: 0, dateEpochMs: 0 }],
          rollbackResult: {
            ok: false,
            reason: 'rollback requires a stopped VM; eng-7-det is running'
          }
        })
      ]
    })
    const snap = await runCli(manager, ['snapshot', 'eng-7-det', 'base'])
    expect(snap.code).toBe(0)
    expect(snap.out.join('\n')).toContain('gardens-vm: snapshot eng-7-det ok=true')

    const list = await runCli(manager, ['list-snapshots', 'eng-7-det'])
    expect(list.code).toBe(0)
    expect(list.out.join('\n')).toContain('base')
    expect(list.out.join('\n')).toContain('1 snapshot(s) on eng-7-det')

    const rollback = await runCli(manager, ['rollback', 'eng-7-det', 'base'])
    expect(rollback.code).toBe(3)
    expect(rollback.err.join('\n')).toContain('rollback requires a stopped VM')
  })

  it('usage errors exit 2 for incomplete snapshot commands', async () => {
    const { code, err } = await runCli(
      new GardensVmManager({
        env: { OSHIELD_GARDENS_SCOPE: 'eng-7' },
        backends: [cliBackend({})]
      }),
      ['snapshot', 'eng-7-det']
    )
    expect(code).toBe(2)
    expect(err.join('\n')).toContain('usage:')
  })
})
