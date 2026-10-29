import { statSync } from 'node:fs'
import type {
  RunProcessLike,
  VmBackend,
  VmDiskSnapshot,
  VmHandle,
  VmInspectInfo,
  VmState
} from './vm-backend'
import {
  buildQemuImgSnapshotCreateArgs,
  buildQemuImgSnapshotListArgs,
  buildQemuImgSnapshotRollbackArgs,
  parseQemuImgSnapshotList,
  qemuSnapshotIdLooksSafe,
  snapshotListHasName,
  QEMU_SNAPSHOT_ID_PATTERN
} from './qemu-command-line'
import { qemuMetadataPath, readPidFromPidFile, readQemuMetadata } from './qemu-garden-metadata'

export type QemuBinLocator = () => Promise<
  { ok: true; bins: { qemuSystem: string; qemuImg: string } } | { ok: false; reason: string }
>

export type QemuSnapshotOpsDeps = {
  dir: string
  runProcess: RunProcessLike
  locateBins: QemuBinLocator
  isPidAlive: (pid: number) => boolean
}

export type QemuSnapshotOps = Pick<
  Required<VmBackend>,
  'snapshot' | 'rollbackSnapshot' | 'listSnapshots' | 'inspect'
>

const snapshotIdProblem = (snapshotId: string): string | undefined =>
  qemuSnapshotIdLooksSafe(snapshotId)
    ? undefined
    : `snapshot id must match ${String(QEMU_SNAPSHOT_ID_PATTERN)}: ${snapshotId}`

const diskBytesOnHost = (diskPath: string): number | undefined => {
  try {
    return statSync(diskPath).size
  } catch {
    return undefined
  }
}

/**
 * qcow2 internal snapshot ops plus the enriched read-only view, split out of the launch
 * lifecycle in vm-backend-qemu. All ops refuse to touch a disk whose VM is still running.
 */
export const createQemuSnapshotOps = (deps: QemuSnapshotOpsDeps): QemuSnapshotOps => {
  const gardenMetadata = (handle: VmHandle) =>
    readQemuMetadata(qemuMetadataPath(deps.dir, handle.id))

  const runningPid = (handle: VmHandle): number | undefined => {
    const pid = readPidFromPidFile(gardenMetadata(handle).pidFilePath)
    return pid !== undefined && deps.isPidAlive(pid) ? pid : undefined
  }

  const listSnapshotsInternal = async (
    diskPath: string
  ): Promise<
    { ok: true; snapshots: readonly VmDiskSnapshot[] } | { ok: false; reason: string }
  > => {
    const bins = await deps.locateBins()
    if (!bins.ok) {
      return { ok: false, reason: bins.reason }
    }
    const list = await deps.runProcess({
      program: bins.bins.qemuImg,
      args: buildQemuImgSnapshotListArgs(diskPath),
      timeoutMs: 60_000
    })
    if (list.code !== 0) {
      return {
        ok: false,
        reason: `qemu-img snapshot -l failed: ${list.stderr.trim() || `exit ${String(list.code)}`}`
      }
    }
    return { ok: true, snapshots: parseQemuImgSnapshotList(list.stdout) }
  }

  return {
    snapshot: async (handle: VmHandle, snapshotId: string) => {
      const namingProblem = snapshotIdProblem(snapshotId)
      if (namingProblem !== undefined) {
        return { ok: false, reason: namingProblem }
      }
      const metadata = gardenMetadata(handle)
      const pid = runningPid(handle)
      if (pid !== undefined) {
        return { ok: false, reason: `snapshot requires a stopped VM; ${handle.id} is running` }
      }
      const listed = await listSnapshotsInternal(metadata.diskPath)
      if (!listed.ok) {
        return { ok: false, reason: listed.reason }
      }
      if (snapshotListHasName(listed.snapshots, snapshotId)) {
        return { ok: false, reason: `snapshot id already exists on ${handle.id}: ${snapshotId}` }
      }
      const bins = await deps.locateBins()
      if (!bins.ok) {
        return { ok: false, reason: bins.reason }
      }
      const snap = await deps.runProcess({
        program: bins.bins.qemuImg,
        args: buildQemuImgSnapshotCreateArgs(metadata.diskPath, snapshotId),
        timeoutMs: 120_000
      })
      if (snap.code !== 0) {
        return {
          ok: false,
          reason: `qemu-img snapshot -c failed: ${snap.stderr.trim() || `exit ${String(snap.code)}`}`
        }
      }
      return { ok: true, path: metadata.diskPath }
    },
    rollbackSnapshot: async (handle: VmHandle, snapshotId: string) => {
      const namingProblem = snapshotIdProblem(snapshotId)
      if (namingProblem !== undefined) {
        return { ok: false, reason: namingProblem }
      }
      const pid = runningPid(handle)
      if (pid !== undefined) {
        return {
          ok: false,
          reason: `rollback requires a stopped VM; ${handle.id} is running (pid ${String(pid)})`
        }
      }
      const bins = await deps.locateBins()
      if (!bins.ok) {
        return { ok: false, reason: bins.reason }
      }
      const rollback = await deps.runProcess({
        program: bins.bins.qemuImg,
        args: buildQemuImgSnapshotRollbackArgs(gardenMetadata(handle).diskPath, snapshotId),
        timeoutMs: 120_000
      })
      if (rollback.code !== 0) {
        return {
          ok: false,
          reason: `qemu-img snapshot -a failed: ${rollback.stderr.trim() || `exit ${String(rollback.code)}`}`
        }
      }
      return { ok: true }
    },
    listSnapshots: async (handle: VmHandle) =>
      listSnapshotsInternal(gardenMetadata(handle).diskPath),
    inspect: async (handle: VmHandle): Promise<VmInspectInfo> => {
      const metadata = gardenMetadata(handle)
      const pid = readPidFromPidFile(metadata.pidFilePath)
      const pidAlive = pid !== undefined && deps.isPidAlive(pid)
      const state: VmState = pidAlive ? 'running' : 'stopped'
      const listed = await listSnapshotsInternal(metadata.diskPath)
      return {
        name: metadata.name,
        backend: 'qemu',
        state,
        pid,
        pidAlive,
        uptimeMs:
          pidAlive && metadata.lastStartedAtEpochMs !== undefined
            ? Date.now() - metadata.lastStartedAtEpochMs
            : undefined,
        imageRef: metadata.imageRef,
        diskPath: metadata.diskPath,
        diskGb: metadata.diskGb,
        diskBytesOnHost: diskBytesOnHost(metadata.diskPath),
        memoryMb: metadata.memoryMb,
        vcpus: metadata.vcpus,
        sshHostPort: metadata.sshHostPort > 0 ? metadata.sshHostPort : undefined,
        qmpPort: metadata.qmpPort > 0 ? metadata.qmpPort : undefined,
        createdAtEpochMs: metadata.createdAtEpochMs,
        lastStartedAtEpochMs: metadata.lastStartedAtEpochMs,
        snapshots: listed.ok ? listed.snapshots : [],
        snapshotListError: listed.ok ? undefined : listed.reason
      }
    }
  }
}
