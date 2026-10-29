import type { ProcessResult, ProcessSpec } from '@shield/process-host/process-spec'

export type VmBackendId = 'qemu' | 'hyperv' | 'vz'

export type VmStopMode = 'acpi' | 'force'

export type VmState = 'created' | 'running' | 'stopped' | 'error' | 'deleted'

export type VmSpec = {
  name: string
  vcpus: number
  memoryMb: number
  diskGb: number
  /** Local file path (ISO or qcow2 seed) after materialization via vm-images; remote URLs are refused at create. */
  imageRef: string
  natNetwork: boolean
  /** Reserve a 127.0.0.1 hostfwd port to guest :22 at create time (guest must run sshd itself). */
  sshRequested?: boolean
}

export type VmHandle = {
  id: string
  backend: VmBackendId
  state: VmState
  name?: string
  pid?: number
  diskPath?: string
  sshHostPort?: number
}

export type VmBackend = {
  id: VmBackendId
  available(): Promise<boolean>
  create(spec: VmSpec): Promise<VmHandle>
  start(handle: VmHandle): Promise<VmHandle>
  stop(handle: VmHandle, mode: VmStopMode): Promise<VmHandle>
  status(handle: VmHandle): Promise<VmState>
  delete(handle: VmHandle): Promise<void>
  /** Best-effort VM enumeration for `gardens-vm list`; backends without a directory model may omit it. */
  listNames?(): Promise<string[]>
  /** qcow2 internal snapshot creation (`qemu-img snapshot -c`); qemu-only today. */
  snapshot?(
    handle: VmHandle,
    snapshotId: string
  ): Promise<{ ok: true; path: string } | { ok: false; reason: string }>
  /** Applies a snapshot to the disk image; implementations must refuse while the VM runs. */
  rollbackSnapshot?(
    handle: VmHandle,
    snapshotId: string
  ): Promise<{ ok: true } | { ok: false; reason: string }>
  listSnapshots?(
    handle: VmHandle
  ): Promise<{ ok: true; snapshots: readonly VmDiskSnapshot[] } | { ok: false; reason: string }>
  /** Enriched read-only view for `gardens-vm status <name>`; falls back to plain status when omitted. */
  inspect?(handle: VmHandle): Promise<VmInspectInfo>
}

/** Backend-specific extras are opt-in extensions, never part of the VmBackend contract. */
export type VmBackendDiagnostics = {
  availability(): Promise<{ available: boolean; reason: string }>
}

export type VmDiskSnapshot = {
  id: string
  /** Snapshot tag inside the qcow2 header (our ids are filename-safe by pattern). */
  name: string
  /** Guest RAM state captured inside the snapshot, in bytes. */
  vmStateSizeBytes: number
  dateEpochMs: number
}

export type VmInspectInfo = {
  name: string
  backend: VmBackendId
  state: VmState
  pid?: number
  pidAlive: boolean
  /** Milliseconds since the recorded start of the current run; absent when unknown. */
  uptimeMs?: number
  imageRef?: string
  diskPath?: string
  diskGb?: number
  diskBytesOnHost?: number
  memoryMb?: number
  vcpus?: number
  sshHostPort?: number
  qmpPort?: number
  createdAtEpochMs?: number
  lastStartedAtEpochMs?: number
  snapshots: readonly VmDiskSnapshot[]
  snapshotListError?: string
}

export type RunProcessLike = (
  spec: ProcessSpec,
  outputCapture?: 'head' | 'tail'
) => Promise<ProcessResult>

export type StartDetachedLike = (spec: ProcessSpec) => { pid?: number }

export const VM_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

export const vmNameLooksSafe = (name: string): boolean => VM_NAME_PATTERN.test(name)

const specBounds = {
  vcpus: [1, 64],
  memoryMb: [32, 1_048_576],
  diskGb: [0.1, 1024]
} as const

export const validateVmSpec = (spec: VmSpec): { ok: true } | { ok: false; reason: string } => {
  if (!vmNameLooksSafe(spec.name)) {
    return { ok: false, reason: `vm name must match ${String(VM_NAME_PATTERN)}: ${spec.name}` }
  }
  if (
    !Number.isFinite(spec.vcpus) ||
    spec.vcpus < specBounds.vcpus[0] ||
    spec.vcpus > specBounds.vcpus[1]
  ) {
    return { ok: false, reason: `vcpus must be ${specBounds.vcpus[0]}..${specBounds.vcpus[1]}` }
  }
  if (
    !Number.isFinite(spec.memoryMb) ||
    spec.memoryMb < specBounds.memoryMb[0] ||
    spec.memoryMb > specBounds.memoryMb[1]
  ) {
    return {
      ok: false,
      reason: `memoryMb must be ${specBounds.memoryMb[0]}..${specBounds.memoryMb[1]}`
    }
  }
  if (
    !Number.isFinite(spec.diskGb) ||
    spec.diskGb < specBounds.diskGb[0] ||
    spec.diskGb > specBounds.diskGb[1]
  ) {
    return { ok: false, reason: `diskGb must be ${specBounds.diskGb[0]}..${specBounds.diskGb[1]}` }
  }
  return { ok: true }
}

/** Remote refs never auto-download; callers materialize catalog images via vm-images first. */
export const imageRefIsRemote = (imageRef: string): boolean => /^https?:\/\//i.test(imageRef)
