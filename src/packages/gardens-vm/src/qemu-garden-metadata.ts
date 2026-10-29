import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export type QemuVmMetadata = {
  name: string
  backend: 'qemu'
  diskPath: string
  pidFilePath: string
  serialLogPath: string
  qmpPort: number
  sshHostPort: number
  vcpus: number
  memoryMb: number
  diskGb: number
  imageRef: string
  natNetwork: boolean
  createdAtEpochMs: number
  /** Set on every successful start; uptime base while the pid is alive. */
  lastStartedAtEpochMs?: number
  /** create --ssh: the hostfwd port was reserved at create time and must survive restarts. */
  sshRequested?: boolean
}

export const qemuMetadataPath = (dir: string, name: string): string =>
  join(dir, `${name}.garden.json`)

export const readQemuMetadata = (metadataPath: string): QemuVmMetadata =>
  JSON.parse(readFileSync(metadataPath, 'utf8')) as QemuVmMetadata

export const metadataFiles = (dir: string): string[] => {
  if (!existsSync(dir)) {
    return []
  }
  return readdirSync(dir).filter((entry) => entry.endsWith('.garden.json'))
}

export const listGardenNamesFromDir = (dir: string): string[] =>
  metadataFiles(dir).map((file) => file.slice(0, -'.garden.json'.length))

export const usedPortsFromMetadata = (dir: string): { ssh: Set<number>; qmp: Set<number> } => {
  const used = { ssh: new Set<number>(), qmp: new Set<number>() }
  for (const file of metadataFiles(dir)) {
    try {
      const meta = readQemuMetadata(join(dir, file))
      used.ssh.add(meta.sshHostPort)
      used.qmp.add(meta.qmpPort)
    } catch {
      // A torn metadata file must not block port allocation for healthy VMs.
    }
  }
  return used
}

export const nextFreePort = (used: ReadonlySet<number>, start: number): number => {
  let port = start
  while (used.has(port)) {
    port += 1
  }
  return port
}

export const readPidFromPidFile = (pidFilePath: string): number | undefined => {
  try {
    const parsed = Number.parseInt(readFileSync(pidFilePath, 'utf8').trim(), 10)
    return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
  } catch {
    return undefined
  }
}

/**
 * Applies a patch while keeping the create-time identity fields (name, backend, paths)
 * structurally un-overridable; ports, timing, and sizing may drift across starts.
 */
export const mergeQemuVmMetadata = (
  base: QemuVmMetadata,
  patch: Partial<QemuVmMetadata>
): QemuVmMetadata => ({
  ...base,
  qmpPort: patch.qmpPort ?? base.qmpPort,
  sshHostPort: patch.sshHostPort ?? base.sshHostPort,
  vcpus: patch.vcpus ?? base.vcpus,
  memoryMb: patch.memoryMb ?? base.memoryMb,
  diskGb: patch.diskGb ?? base.diskGb,
  imageRef: patch.imageRef ?? base.imageRef,
  natNetwork: patch.natNetwork ?? base.natNetwork,
  createdAtEpochMs: patch.createdAtEpochMs ?? base.createdAtEpochMs,
  lastStartedAtEpochMs: patch.lastStartedAtEpochMs ?? base.lastStartedAtEpochMs,
  sshRequested: patch.sshRequested ?? base.sshRequested
})
