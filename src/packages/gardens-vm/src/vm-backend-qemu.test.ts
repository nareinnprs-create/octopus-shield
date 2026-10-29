import { describe, expect, it } from 'vitest'
import {
  buildQemuImgCreateArgs,
  buildQemuImgSnapshotCreateArgs,
  buildQemuImgSnapshotListArgs,
  buildQemuImgSnapshotRollbackArgs,
  buildQemuSystemArgs,
  createQemuBackend,
  listGardenNamesFromDir,
  mergeQemuVmMetadata,
  parseQemuImgSnapshotList,
  qemuImgSiblingPath,
  qemuSizeToBytes,
  qemuSnapshotIdLooksSafe,
  qemuSystemCandidates,
  snapshotListHasName,
  QEMU_SNAPSHOT_ID_PATTERN,
  type QemuLaunchPlan
} from './vm-backend-qemu'
import type { ProcessResult, ProcessSpec } from '@shield/process-host/process-spec'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const launchPlan = (overrides: Partial<QemuLaunchPlan> = {}): QemuLaunchPlan => ({
  name: 'eng-7-det',
  vcpus: 1,
  memoryMb: 512,
  diskPath: 'C:\\gardens\\eng-7-det.qcow2',
  sshHostPort: 2222,
  qmpPort: 4444,
  serialLogPath: 'C:\\gardens\\eng-7-det.serial.log',
  pidFilePath: 'C:\\gardens\\eng-7-det.pid',
  natNetwork: true,
  platform: 'win32',
  ...overrides
})

const result = (code: number, stdout = '', stderr = ''): ProcessResult => ({
  code,
  signal: null,
  stdout,
  stderr,
  timedOut: false
})

describe('qemu argv construction (pure)', () => {
  it('builds the qemu-img create argv with byte-exact size', () => {
    expect(buildQemuImgCreateArgs('C:\\gardens\\d.qcow2', 0.25)).toEqual([
      'create',
      '-f',
      'qcow2',
      'C:\\gardens\\d.qcow2',
      String(256 * 1024 * 1024)
    ])
  })

  it('builds internal-snapshot argv for create, list, and rollback', () => {
    expect(buildQemuImgSnapshotCreateArgs('C:\\gardens\\d.qcow2', 'base')).toEqual([
      'snapshot',
      '-c',
      'base',
      'C:\\gardens\\d.qcow2'
    ])
    expect(buildQemuImgSnapshotListArgs('C:\\gardens\\d.qcow2')).toEqual([
      'snapshot',
      '-l',
      'C:\\gardens\\d.qcow2'
    ])
    expect(buildQemuImgSnapshotRollbackArgs('C:\\gardens\\d.qcow2', 'base')).toEqual([
      'snapshot',
      '-a',
      'base',
      'C:\\gardens\\d.qcow2'
    ])
  })

  it('builds the headless system argv with NAT hostfwd, serial file, pidfile, and QMP', () => {
    const args = buildQemuSystemArgs(launchPlan({ cdromPath: 'C:\\gardens\\alpine.iso' }))
    expect(args).toContain('-name')
    expect(args[args.indexOf('-m') + 1]).toBe('512')
    expect(args[args.indexOf('-smp') + 1]).toBe('1')
    expect(args[args.indexOf('-drive') + 1]).toBe(
      'file=C:/gardens/eng-7-det.qcow2,format=qcow2,if=virtio'
    )
    expect(args[args.indexOf('-cdrom') + 1]).toBe('C:/gardens/alpine.iso')
    expect(args[args.indexOf('-boot') + 1]).toBe('d')
    expect(args[args.indexOf('-netdev') + 1]).toBe(
      'user,id=oshield0,hostfwd=tcp:127.0.0.1:2222-:22'
    )
    expect(args[args.indexOf('-device') + 1]).toBe('virtio-net-pci,netdev=oshield0')
    expect(args[args.indexOf('-display') + 1]).toBe('none')
    expect(args[args.indexOf('-serial') + 1]).toBe('file:C:/gardens/eng-7-det.serial.log')
    expect(args).not.toContain('-daemonize')
    expect(args[args.indexOf('-monitor') + 1]).toBe('none')
    expect(args[args.indexOf('-qmp') + 1]).toBe('tcp:127.0.0.1:4444,server,nowait')
    expect(args[args.indexOf('-pidfile') + 1]).toBe('C:/gardens/eng-7-det.pid')
    expect(args.slice(args.indexOf('-accel'))).toEqual(['-accel', 'whpx', '-accel', 'tcg'])
  })

  it('drops networking when natNetwork is false', () => {
    const args = buildQemuSystemArgs(launchPlan({ natNetwork: false }))
    expect(args).not.toContain('-netdev')
    expect(args).not.toContain('hostfwd')
    expect(args[args.indexOf('-nic') + 1]).toBe('none')
  })

  it('falls back kvm→tcg on linux and hvf→tcg on darwin', () => {
    const linux = buildQemuSystemArgs(launchPlan({ platform: 'linux' }))
    expect(linux.slice(linux.indexOf('-accel'))).toEqual(['-accel', 'kvm', '-accel', 'tcg'])
    const darwin = buildQemuSystemArgs(launchPlan({ platform: 'darwin' }))
    expect(darwin.slice(darwin.indexOf('-accel'))).toEqual(['-accel', 'hvf', '-accel', 'tcg'])
  })
})

describe('snapshot id naming (pure)', () => {
  it('accepts filename-safe ids up to 64 chars', () => {
    expect(qemuSnapshotIdLooksSafe('base')).toBe(true)
    expect(qemuSnapshotIdLooksSafe('pre-update_2.final')).toBe(true)
    expect(qemuSnapshotIdLooksSafe('a'.repeat(64))).toBe(true)
  })

  it('rejects empty, over-long, and argv-hostile ids', () => {
    expect(qemuSnapshotIdLooksSafe('')).toBe(false)
    expect(qemuSnapshotIdLooksSafe('a'.repeat(65))).toBe(false)
    expect(qemuSnapshotIdLooksSafe('has space')).toBe(false)
    expect(qemuSnapshotIdLooksSafe('../../etc')).toBe(false)
    expect(qemuSnapshotIdLooksSafe('-a;rm')).toBe(false)
    expect(String(QEMU_SNAPSHOT_ID_PATTERN)).toContain('A-Za-z0-9._-')
  })
})

describe('qemu-img snapshot -l parsing (pure; QEMU 11.1 lacks --output=json for snapshots)', () => {
  const realTable = [
    'Snapshot list:',
    'ID      TAG               VM_SIZE                DATE        VM_CLOCK     ICOUNT',
    '1       base                  0 B 2026-10-29 11:38:06  0000:00:00.000          0',
    '2       pre-update            0 B 2026-10-29 11:38:06  0000:00:00.000          0'
  ].join('\n')

  it('parses the exact QEMU 11.1 human table', () => {
    const snapshots = parseQemuImgSnapshotList(realTable)
    expect(snapshots.map((snap) => snap.name)).toEqual(['base', 'pre-update'])
    expect(snapshots.map((snap) => snap.id)).toEqual(['1', '2'])
    expect(snapshots[0]?.vmStateSizeBytes).toBe(0)
    expect(Number.isNaN(snapshots[0]?.dateEpochMs)).toBe(false)
    expect(snapshotListHasName(snapshots, 'base')).toBe(true)
    expect(snapshotListHasName(snapshots, 'missing')).toBe(false)
  })

  it('parses saved-VM state sizes and skips unparseable lines', () => {
    const withState = [
      'Snapshot list:',
      'ID      TAG               VM_SIZE                DATE        VM_CLOCK     ICOUNT',
      '1       checkpoint           1.5 GiB 2026-10-29 11:38:06  00:00:05.000        123'
    ].join('\n')
    const snapshots = parseQemuImgSnapshotList(withState)
    expect(snapshots).toHaveLength(1)
    expect(snapshots[0]?.name).toBe('checkpoint')
    expect(snapshots[0]?.vmStateSizeBytes).toBe(Math.round(1.5 * 1024 ** 3))
    expect(parseQemuImgSnapshotList('qemu-img: could not open')).toEqual([])
    expect(parseQemuImgSnapshotList('')).toEqual([])
  })

  it('converts qemu size tokens to bytes', () => {
    expect(qemuSizeToBytes('0', 'B')).toBe(0)
    expect(qemuSizeToBytes('512', 'KiB')).toBe(512 * 1024)
    expect(qemuSizeToBytes('2', 'MiB')).toBe(2 * 1024 ** 2)
    expect(qemuSizeToBytes('1.5', 'GiB')).toBe(Math.round(1.5 * 1024 ** 3))
    expect(qemuSizeToBytes('3', 'TiB')).toBe(3 * 1024 ** 4)
    expect(qemuSizeToBytes('junk', 'B')).toBe(0)
    expect(qemuSizeToBytes('1', 'ZiB')).toBe(0)
  })
})

describe('qemu metadata merge (pure)', () => {
  const baseMetadata = {
    name: 'eng-7',
    backend: 'qemu' as const,
    diskPath: 'C:\\gardens\\eng-7.qcow2',
    pidFilePath: 'C:\\gardens\\eng-7.pid',
    serialLogPath: 'C:\\gardens\\eng-7.serial.log',
    qmpPort: 0,
    sshHostPort: 0,
    vcpus: 1,
    memoryMb: 512,
    diskGb: 0.25,
    imageRef: 'C:\\gardens\\alpine.iso',
    natNetwork: true,
    createdAtEpochMs: 1_000
  }

  it('applies port, timing, and sizing patches', () => {
    const merged = mergeQemuVmMetadata(baseMetadata, {
      sshHostPort: 2222,
      qmpPort: 4444,
      lastStartedAtEpochMs: 2_000,
      sshRequested: true
    })
    expect(merged.sshHostPort).toBe(2222)
    expect(merged.qmpPort).toBe(4444)
    expect(merged.lastStartedAtEpochMs).toBe(2_000)
    expect(merged.sshRequested).toBe(true)
    expect(merged.createdAtEpochMs).toBe(1_000)
  })

  it('locks create-time identity fields against patch drift', () => {
    const merged = mergeQemuVmMetadata(baseMetadata, {
      name: 'eng-9',
      diskPath: 'C:\\evil.qcow2',
      pidFilePath: 'C:\\evil.pid',
      serialLogPath: 'C:\\evil.log'
    })
    expect(merged.name).toBe('eng-7')
    expect(merged.diskPath).toBe('C:\\gardens\\eng-7.qcow2')
    expect(merged.pidFilePath).toBe('C:\\gardens\\eng-7.pid')
    expect(merged.serialLogPath).toBe('C:\\gardens\\eng-7.serial.log')
    expect(merged.backend).toBe('qemu')
  })

  it('skips undefined patch values instead of clobbering the base', () => {
    const withStart = mergeQemuVmMetadata(baseMetadata, { lastStartedAtEpochMs: 5_000 })
    const reMerged = mergeQemuVmMetadata(withStart, { lastStartedAtEpochMs: undefined })
    expect(reMerged.lastStartedAtEpochMs).toBe(5_000)
    expect(mergeQemuVmMetadata(withStart, { sshRequested: undefined }).sshRequested).toBeUndefined()
  })
})

describe('qemu binary discovery', () => {
  it('probes env override, PATH name, and the standard Windows install dir', () => {
    expect(qemuSystemCandidates({ OSHIELD_QEMU_SYSTEM_BIN: 'D:\\q\\q.exe' }, 'win32')).toEqual([
      'D:\\q\\q.exe',
      'qemu-system-x86_64',
      join('C:', 'Program Files', 'qemu', 'qemu-system-x86_64.exe')
    ])
    expect(qemuSystemCandidates({}, 'linux')).toContain('/usr/bin/qemu-system-x86_64')
    expect(qemuSystemCandidates({}, 'darwin')).toContain('/opt/homebrew/bin/qemu-system-x86_64')
  })

  it('resolves qemu-img beside the system binary', () => {
    expect(qemuImgSiblingPath('C:\\Program Files\\qemu\\qemu-system-x86_64.exe', 'win32')).toBe(
      join('C:\\Program Files\\qemu', 'qemu-img.exe')
    )
    expect(qemuImgSiblingPath('qemu-system-x86_64', 'linux')).toBe('qemu-img')
  })
})

describe('qemu backend lifecycle with fake process runners', () => {
  it('creates a disk, starts detached, and refuses delete while running', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gardens-qemu-test-'))
    try {
      const calls: { program: string; args?: readonly string[] }[] = []
      let qemuSpawned = false
      writeFileSync(join(dir, 'alpine.iso'), 'iso')
      const backend = createQemuBackend({
        dir,
        runProcess: async (spec: ProcessSpec) => {
          calls.push({ program: spec.program, args: spec.args })
          if (spec.program === 'qemu-img') {
            writeFileSync(join(dir, 'eng-7.qcow2'), 'qcow2')
          }
          return result(0)
        },
        startDetached: (spec: ProcessSpec) => {
          qemuSpawned = true
          calls.push({ program: spec.program, args: spec.args })
          writeFileSync(join(dir, 'eng-7.pid'), '4242\n')
          return { pid: 4242 }
        },
        isPidAlive: (pid: number) => pid === 4242 && qemuSpawned,
        sleep: async () => {}
      })
      const handle = await backend.create({
        name: 'eng-7',
        vcpus: 1,
        memoryMb: 512,
        diskGb: 0.25,
        imageRef: join(dir, 'alpine.iso'),
        natNetwork: true
      })
      expect(handle.state).toBe('created')
      const imgCreate = calls.find((call) => call.program === 'qemu-img')
      expect(imgCreate?.args).toEqual([
        'create',
        '-f',
        'qcow2',
        join(dir, 'eng-7.qcow2'),
        String(256 * 1024 * 1024)
      ])
      await expect(
        backend.create({
          name: 'eng-7',
          vcpus: 1,
          memoryMb: 512,
          diskGb: 1,
          imageRef: join(dir, 'alpine.iso'),
          natNetwork: true
        })
      ).rejects.toThrow('already exists')

      const started = await backend.start({ id: 'eng-7', backend: 'qemu', state: 'created' })
      expect(qemuSpawned).toBe(true)
      expect(started.state).toBe('running')
      expect(started.pid).toBe(4242)
      expect(started.sshHostPort).toBe(2222)
      const startedMetadata = JSON.parse(readFileSync(join(dir, 'eng-7.garden.json'), 'utf8')) as {
        lastStartedAtEpochMs?: number
      }
      expect(typeof startedMetadata.lastStartedAtEpochMs).toBe('number')

      await expect(backend.delete(handle)).rejects.toThrow('stop it before delete')

      qemuSpawned = false
      const stopped = await backend.stop(
        { id: 'eng-7', backend: 'qemu', state: 'running', pid: 4242 },
        'force'
      )
      expect(stopped.state).toBe('stopped')
      await expect(backend.delete(handle)).resolves.toBeUndefined()
      expect(listGardenNamesFromDir(dir)).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('reports unavailable when no qemu binary is found', async () => {
    const backend = createQemuBackend({
      dir: join(tmpdir(), 'gardens-unavailable-test'),
      runProcess: async () => result(1),
      env: {}
    })
    const verdict = await backend.availability()
    expect(verdict.available).toBe(false)
    expect(verdict.reason).toContain('qemu-system-x86_64 not found')
  })

  it('allocates the next free ports from existing garden metadata', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gardens-ports-test-'))
    try {
      mkdirSync(dir, { recursive: true })
      writeFileSync(
        join(dir, 'eng-1.garden.json'),
        JSON.stringify({
          name: 'eng-1',
          backend: 'qemu',
          diskPath: join(dir, 'eng-1.qcow2'),
          pidFilePath: join(dir, 'eng-1.pid'),
          serialLogPath: join(dir, 'eng-1.serial.log'),
          qmpPort: 4444,
          sshHostPort: 2222,
          vcpus: 1,
          memoryMb: 512,
          diskGb: 1,
          imageRef: 'x.iso',
          natNetwork: true,
          createdAtEpochMs: 0
        })
      )
      const backend = createQemuBackend({
        dir,
        runProcess: async () => result(0),
        startDetached: () => {
          writeFileSync(join(dir, 'eng-2.pid'), '4243\n')
          return { pid: 4243 }
        },
        isPidAlive: (pid: number) => pid === 4243,
        sleep: async () => {}
      })
      writeFileSync(join(dir, 'eng-2.iso'), 'iso')
      await backend.create({
        name: 'eng-2',
        vcpus: 1,
        memoryMb: 512,
        diskGb: 1,
        imageRef: join(dir, 'eng-2.iso'),
        natNetwork: true
      })
      const started = await backend.start({ id: 'eng-2', backend: 'qemu', state: 'created' })
      expect(started.sshHostPort).toBe(2223)
      const args = buildQemuSystemArgs({
        name: 'eng-2',
        vcpus: 1,
        memoryMb: 512,
        diskPath: join(dir, 'eng-2.qcow2'),
        sshHostPort: started.sshHostPort ?? 0,
        qmpPort: 4445,
        serialLogPath: join(dir, 's.log'),
        pidFilePath: join(dir, 'eng-2.pid'),
        natNetwork: true,
        platform: 'win32'
      })
      expect(args).toContain('user,id=oshield0,hostfwd=tcp:127.0.0.1:2223-:22')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('qemu internal snapshot flow (fake runProcess)', () => {
  const snapshotRow = (id: number, name: string): string =>
    `${String(id).padEnd(8)}${name.padEnd(22)}0 B 2026-10-29 10:00:00  0000:00:00.000          0`
  const snapshotTable = (names: string[]): string =>
    `${[
      'Snapshot list:',
      'ID      TAG               VM_SIZE                DATE        VM_CLOCK     ICOUNT',
      ...names.map((name, index) => snapshotRow(index + 1, name))
    ].join('\n')}\n`
  const writeGarden = (dir: string, name: string): void => {
    writeFileSync(join(dir, `${name}.qcow2`), 'qcow2')
    writeFileSync(
      join(dir, `${name}.garden.json`),
      JSON.stringify({
        name,
        backend: 'qemu',
        diskPath: join(dir, `${name}.qcow2`),
        pidFilePath: join(dir, `${name}.pid`),
        serialLogPath: join(dir, `${name}.serial.log`),
        qmpPort: 0,
        sshHostPort: 0,
        vcpus: 1,
        memoryMb: 512,
        diskGb: 0.25,
        imageRef: join(dir, 'alpine.iso'),
        natNetwork: true,
        createdAtEpochMs: 0
      })
    )
  }

  it('creates, lists, and rolls back snapshots on a stopped VM', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gardens-snap-test-'))
    try {
      const calls: ProcessSpec[] = []
      const backend = createQemuBackend({
        dir,
        runProcess: async (spec: ProcessSpec) => {
          calls.push(spec)
          const args = spec.args ?? []
          if (args[0] === 'snapshot' && args[1] === '-l') {
            const names = calls.some((call) => call.args?.[1] === '-c') ? ['base'] : []
            return result(0, snapshotTable(names))
          }
          return result(0)
        },
        sleep: async () => {}
      })
      writeGarden(dir, 'eng-8')
      const handle = { id: 'eng-8', backend: 'qemu' as const, state: 'stopped' as const }

      const snap = await backend.snapshot(handle, 'base')
      expect(snap).toEqual({ ok: true, path: join(dir, 'eng-8.qcow2') })
      const listCall = calls.find((call) => call.args?.[1] === '-l')
      const createCall = calls.find((call) => call.args?.[1] === '-c')
      expect(listCall?.args).toEqual(['snapshot', '-l', join(dir, 'eng-8.qcow2')])
      expect(createCall?.args).toEqual(['snapshot', '-c', 'base', join(dir, 'eng-8.qcow2')])

      const listed = await backend.listSnapshots(handle)
      expect(listed.ok).toBe(true)
      if (listed.ok) {
        expect(listed.snapshots.map((entry) => entry.name)).toEqual(['base'])
      }

      const rollback = await backend.rollbackSnapshot(handle, 'base')
      expect(rollback).toEqual({ ok: true })
      const rollbackCall = calls.find((call) => call.args?.[1] === '-a')
      expect(rollbackCall?.args).toEqual(['snapshot', '-a', 'base', join(dir, 'eng-8.qcow2')])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('refuses snapshot and rollback while running, and unsafe ids always, without shelling out', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gardens-snap-live-test-'))
    try {
      const calls: ProcessSpec[] = []
      writeGarden(dir, 'eng-9')
      writeFileSync(join(dir, 'eng-9.pid'), '4244\n')
      const backend = createQemuBackend({
        dir,
        runProcess: async (spec: ProcessSpec) => {
          calls.push(spec)
          return result(0)
        },
        isPidAlive: (pid: number) => pid === 4244,
        sleep: async () => {}
      })
      const running = { id: 'eng-9', backend: 'qemu' as const, state: 'running' as const }
      expect(await backend.snapshot(running, 'base')).toEqual({
        ok: false,
        reason: 'snapshot requires a stopped VM; eng-9 is running'
      })
      expect(await backend.rollbackSnapshot(running, 'base')).toEqual({
        ok: false,
        reason: 'rollback requires a stopped VM; eng-9 is running (pid 4244)'
      })
      expect(await backend.snapshot({ ...running, state: 'stopped' }, 'bad id')).toEqual({
        ok: false,
        reason: `snapshot id must match ${String(QEMU_SNAPSHOT_ID_PATTERN)}: bad id`
      })
      expect(await backend.rollbackSnapshot({ ...running, state: 'stopped' }, '../escape')).toEqual(
        {
          ok: false,
          reason: `snapshot id must match ${String(QEMU_SNAPSHOT_ID_PATTERN)}: ../escape`
        }
      )
      expect(calls).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('refuses duplicate snapshot ids and surfaces qemu-img failures honestly', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gardens-snap-dup-test-'))
    try {
      writeGarden(dir, 'eng-10')
      const backend = createQemuBackend({
        dir,
        runProcess: async (spec: ProcessSpec) => {
          if (spec.args?.[1] === '-l') {
            return result(0, snapshotTable(['base']))
          }
          if (spec.args?.[1] === '-a') {
            return result(1, '', `qemu-img: snapshot -a: no snapshot named 'ghost'`)
          }
          return result(0)
        },
        sleep: async () => {}
      })
      const stopped = { id: 'eng-10', backend: 'qemu' as const, state: 'stopped' as const }
      expect(await backend.snapshot(stopped, 'base')).toEqual({
        ok: false,
        reason: 'snapshot id already exists on eng-10: base'
      })
      expect(await backend.rollbackSnapshot(stopped, 'ghost')).toEqual({
        ok: false,
        reason: `qemu-img snapshot -a failed: qemu-img: snapshot -a: no snapshot named 'ghost'`
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('qemu backend inspect (fake runProcess)', () => {
  it('reports pid, uptime, disk size, ports, and snapshots for a running VM', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gardens-inspect-test-'))
    try {
      writeFileSync(join(dir, 'alpine.iso'), 'iso')
      writeFileSync(join(dir, 'eng-11.qcow2'), 'qcow2-bytes')
      writeFileSync(join(dir, 'eng-11.pid'), '4245\n')
      writeFileSync(
        join(dir, 'eng-11.garden.json'),
        JSON.stringify({
          name: 'eng-11',
          backend: 'qemu',
          diskPath: join(dir, 'eng-11.qcow2'),
          pidFilePath: join(dir, 'eng-11.pid'),
          serialLogPath: join(dir, 'eng-11.serial.log'),
          qmpPort: 4444,
          sshHostPort: 2222,
          vcpus: 1,
          memoryMb: 512,
          diskGb: 0.25,
          imageRef: join(dir, 'alpine.iso'),
          natNetwork: true,
          createdAtEpochMs: Date.now() - 60_000,
          lastStartedAtEpochMs: Date.now() - 5_000,
          sshRequested: true
        })
      )
      const backend = createQemuBackend({
        dir,
        runProcess: async () =>
          result(
            0,
            [
              'Snapshot list:',
              'ID      TAG               VM_SIZE                DATE        VM_CLOCK     ICOUNT',
              '1       base                  0 B 2026-10-29 10:00:00  0000:00:00.000          0'
            ].join('\n')
          ),
        isPidAlive: (pid: number) => pid === 4245,
        sleep: async () => {}
      })
      const info = await backend.inspect({ id: 'eng-11', backend: 'qemu', state: 'running' })
      expect(info.state).toBe('running')
      expect(info.pid).toBe(4245)
      expect(info.pidAlive).toBe(true)
      expect(info.uptimeMs).toBeGreaterThanOrEqual(5_000)
      expect(info.diskBytesOnHost).toBe('qcow2-bytes'.length)
      expect(info.sshHostPort).toBe(2222)
      expect(info.qmpPort).toBe(4444)
      expect(info.lastStartedAtEpochMs).toBeDefined()
      expect(info.snapshots.map((snap) => snap.name)).toEqual(['base'])
      expect(info.snapshotListError).toBeUndefined()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('reports a stopped VM without uptime and surfaces snapshot listing errors', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gardens-inspect-stopped-test-'))
    try {
      writeFileSync(join(dir, 'alpine.iso'), 'iso')
      const backend = createQemuBackend({
        dir,
        runProcess: async (spec: ProcessSpec) => {
          const args = spec.args ?? []
          if (args[0] === 'snapshot' && args[1] === '-l') {
            return result(1, '', 'qemu-img: could not open disk')
          }
          return result(0)
        },
        sleep: async () => {}
      })
      await backend.create({
        name: 'eng-12',
        vcpus: 1,
        memoryMb: 512,
        diskGb: 0.25,
        imageRef: join(dir, 'alpine.iso'),
        natNetwork: true
      })
      const info = await backend.inspect({ id: 'eng-12', backend: 'qemu', state: 'created' })
      expect(info.state).toBe('stopped')
      expect(info.pid).toBeUndefined()
      expect(info.pidAlive).toBe(false)
      expect(info.uptimeMs).toBeUndefined()
      expect(info.sshHostPort).toBeUndefined()
      expect(info.diskBytesOnHost).toBeUndefined()
      expect(info.snapshots).toEqual([])
      expect(info.snapshotListError).toContain('could not open disk')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('qemu --ssh hostfwd reservation', () => {
  it('records the port at create and reuses it across starts', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gardens-ssh-test-'))
    try {
      writeFileSync(join(dir, 'alpine.iso'), 'iso')
      const backend = createQemuBackend({
        dir,
        runProcess: async (spec: ProcessSpec) => {
          const args = spec.args ?? []
          if (args[0] === 'create') {
            writeFileSync(args[3], 'qcow2')
          }
          return result(0)
        },
        startDetached: (spec: ProcessSpec) => {
          const args = spec.args ?? []
          writeFileSync(args[args.indexOf('-pidfile') + 1], '4246\n')
          return { pid: 4246 }
        },
        isPidAlive: (pid: number) => pid === 4246,
        sleep: async () => {}
      })
      const handle = await backend.create({
        name: 'eng-13',
        vcpus: 1,
        memoryMb: 512,
        diskGb: 0.25,
        imageRef: join(dir, 'alpine.iso'),
        natNetwork: true,
        sshRequested: true
      })
      expect(handle.sshHostPort).toBe(2222)
      const metadata = JSON.parse(readFileSync(join(dir, 'eng-13.garden.json'), 'utf8')) as {
        sshHostPort: number
        sshRequested?: boolean
      }
      expect(metadata.sshHostPort).toBe(2222)
      expect(metadata.sshRequested).toBe(true)

      const started = await backend.start({ id: 'eng-13', backend: 'qemu', state: 'created' })
      expect(started.sshHostPort).toBe(2222)

      const plain = await backend.create({
        name: 'eng-14',
        vcpus: 1,
        memoryMb: 512,
        diskGb: 0.25,
        imageRef: join(dir, 'alpine.iso'),
        natNetwork: true
      })
      expect(plain.sshHostPort).toBeUndefined()
      const plainMetadata = JSON.parse(readFileSync(join(dir, 'eng-14.garden.json'), 'utf8')) as {
        sshHostPort: number
        sshRequested?: boolean
      }
      expect(plainMetadata.sshHostPort).toBe(0)
      expect('sshRequested' in plainMetadata).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
