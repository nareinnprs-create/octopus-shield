import { join } from 'node:path'
import type { VmDiskSnapshot } from './vm-backend'

export type QemuLaunchPlan = {
  name: string
  vcpus: number
  memoryMb: number
  diskPath: string
  cdromPath?: string
  sshHostPort: number
  qmpPort: number
  serialLogPath: string
  pidFilePath: string
  natNetwork: boolean
  platform: NodeJS.Platform
}

/** Forward slashes: QEMU option values (file=..., serial file:, pidfile) parse them reliably on Windows. */
export const toQemuPath = (p: string): string => p.replace(/\\/g, '/')

export const qemuDiskBytes = (diskGb: number): number => Math.round(diskGb * 1024 * 1024 * 1024)

export const buildQemuImgCreateArgs = (diskPath: string, diskGb: number): string[] => [
  'create',
  '-f',
  'qcow2',
  diskPath,
  String(qemuDiskBytes(diskGb))
]

/**
 * qcow2 internal snapshots (qemu-img snapshot -c/-l/-a): all snapshots live inside the disk
 * file itself, so no overlay path bookkeeping is needed. Tags with spaces or separators would
 * break `snapshot -l` parsing and CLI argv, hence the strict id pattern.
 */
export const QEMU_SNAPSHOT_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/

export const qemuSnapshotIdLooksSafe = (snapshotId: string): boolean =>
  QEMU_SNAPSHOT_ID_PATTERN.test(snapshotId)

export const buildQemuImgSnapshotCreateArgs = (diskPath: string, snapshotId: string): string[] => [
  'snapshot',
  '-c',
  snapshotId,
  diskPath
]

export const buildQemuImgSnapshotListArgs = (diskPath: string): string[] => [
  'snapshot',
  '-l',
  diskPath
]

export const buildQemuImgSnapshotRollbackArgs = (
  diskPath: string,
  snapshotId: string
): string[] => ['snapshot', '-a', snapshotId, diskPath]

const QEMU_SIZE_UNIT_BYTES: Readonly<Record<string, number>> = {
  B: 1,
  KiB: 1024,
  MiB: 1024 ** 2,
  GiB: 1024 ** 3,
  TiB: 1024 ** 4
}

export const qemuSizeToBytes = (value: string, unit: string): number => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || QEMU_SIZE_UNIT_BYTES[unit] === undefined) {
    return 0
  }
  return Math.round(parsed * QEMU_SIZE_UNIT_BYTES[unit])
}

/** QEMU 11.1 has no --output=json for `snapshot -l`; this matches the fixed human table. */
const QEMU_SNAPSHOT_LIST_LINE =
  /^(\d+)\s+(\S+)\s{2,}(?:(\d+(?:\.\d+)?)\s([KMGTP]?i?B)\s+)?(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})\s+([\d:.]+)\s*(\d*)\s*$/

export const parseQemuImgSnapshotList = (stdout: string): VmDiskSnapshot[] => {
  const snapshots: VmDiskSnapshot[] = []
  for (const line of stdout.split(/\r?\n/)) {
    const match = QEMU_SNAPSHOT_LIST_LINE.exec(line)
    if (match === null) {
      continue
    }
    const [id, name, sizeValue, sizeUnit, date, time] = match.slice(1) as string[]
    snapshots.push({
      id,
      name,
      vmStateSizeBytes:
        sizeValue !== undefined && sizeUnit !== undefined
          ? qemuSizeToBytes(sizeValue, sizeUnit)
          : 0,
      dateEpochMs: new Date(`${date}T${time}`).getTime()
    })
  }
  return snapshots
}

export const snapshotListHasName = (snapshots: readonly VmDiskSnapshot[], name: string): boolean =>
  snapshots.some((snapshot) => snapshot.name === name)

export const qemuAccelArgs = (platform: NodeJS.Platform): string[] => {
  if (platform === 'win32') {
    return ['-accel', 'whpx', '-accel', 'tcg']
  }
  if (platform === 'darwin') {
    return ['-accel', 'hvf', '-accel', 'tcg']
  }
  return ['-accel', 'kvm', '-accel', 'tcg']
}

export const buildQemuSystemArgs = (plan: QemuLaunchPlan): string[] => {
  const args = [
    '-name',
    plan.name,
    '-m',
    String(plan.memoryMb),
    '-smp',
    String(plan.vcpus),
    '-drive',
    `file=${toQemuPath(plan.diskPath)},format=qcow2,if=virtio`
  ]
  if (plan.cdromPath !== undefined) {
    args.push('-cdrom', toQemuPath(plan.cdromPath), '-boot', 'd')
  }
  if (plan.natNetwork) {
    args.push(
      '-netdev',
      `user,id=oshield0,hostfwd=tcp:127.0.0.1:${plan.sshHostPort}-:22`,
      '-device',
      'virtio-net-pci,netdev=oshield0'
    )
  } else {
    args.push('-nic', 'none')
  }
  args.push(
    '-display',
    'none',
    '-serial',
    `file:${toQemuPath(plan.serialLogPath)}`,
    '-monitor',
    'none',
    '-qmp',
    `tcp:127.0.0.1:${plan.qmpPort},server,nowait`,
    '-pidfile',
    toQemuPath(plan.pidFilePath),
    ...qemuAccelArgs(plan.platform)
  )
  return args
}

export const qemuSystemCandidates = (
  env: Readonly<Record<string, string | undefined>>,
  platform: NodeJS.Platform
): string[] => {
  const exe = platform === 'win32' ? 'qemu-system-x86_64.exe' : 'qemu-system-x86_64'
  const candidates = [
    env.OSHIELD_QEMU_SYSTEM_BIN,
    'qemu-system-x86_64',
    platform === 'win32' ? join('C:', 'Program Files', 'qemu', exe) : undefined,
    platform === 'linux' ? `/usr/bin/${exe}` : undefined,
    platform === 'linux' ? `/usr/local/bin/${exe}` : undefined,
    platform === 'darwin' ? `/opt/homebrew/bin/${exe}` : undefined
  ]
  return candidates.filter((candidate): candidate is string => candidate !== undefined)
}

export const qemuImgSiblingPath = (qemuSystemBin: string, platform: NodeJS.Platform): string => {
  const img = platform === 'win32' ? 'qemu-img.exe' : 'qemu-img'
  if (!qemuSystemBin.includes('\\') && !qemuSystemBin.includes('/')) {
    return 'qemu-img'
  }
  return join(qemuSystemBin, '..', img)
}
