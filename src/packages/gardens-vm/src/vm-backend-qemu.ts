import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  imageRefIsRemote,
  validateVmSpec,
  type RunProcessLike,
  type StartDetachedLike,
  type VmBackend,
  type VmBackendDiagnostics,
  type VmHandle,
  type VmSpec,
  type VmStopMode
} from './vm-backend'
import {
  buildQemuImgCreateArgs,
  buildQemuSystemArgs,
  qemuImgSiblingPath,
  qemuSystemCandidates,
  type QemuLaunchPlan
} from './qemu-command-line'
import { qmpSystemPowerdown, sleepMs, startDetachedProcess } from './qemu-process-control'
import { stopQemuPid } from './qemu-vm-stop'
import { createQemuSnapshotOps, type QemuBinLocator } from './qemu-snapshot-ops'
import {
  listGardenNamesFromDir,
  mergeQemuVmMetadata,
  nextFreePort,
  qemuMetadataPath,
  readPidFromPidFile,
  readQemuMetadata,
  usedPortsFromMetadata,
  type QemuVmMetadata
} from './qemu-garden-metadata'

export * from './qemu-command-line'
export * from './qemu-snapshot-ops'
export {
  listGardenNamesFromDir,
  mergeQemuVmMetadata,
  qemuMetadataPath,
  readQemuMetadata,
  type QemuVmMetadata
} from './qemu-garden-metadata'

export type QemuBackendDeps = {
  dir: string
  runProcess: RunProcessLike
  startDetached?: StartDetachedLike
  isPidAlive?: (pid: number) => boolean
  sleep?: (ms: number) => Promise<void>
  qmpPowerdown?: (port: number) => Promise<void>
  env?: Readonly<Record<string, string | undefined>>
  platform?: NodeJS.Platform
  qemuSystemBin?: string
  qemuImgBin?: string
}

const defaultIsPidAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

export type QemuBackend = VmBackend &
  VmBackendDiagnostics &
  Pick<Required<VmBackend>, 'snapshot' | 'rollbackSnapshot' | 'listSnapshots' | 'inspect'>

export const createQemuBackend = (deps: QemuBackendDeps): QemuBackend => {
  const platform = deps.platform ?? process.platform
  const env = deps.env ?? process.env
  const runProcess = deps.runProcess
  const startDetached = deps.startDetached ?? startDetachedProcess
  const isPidAlive = deps.isPidAlive ?? defaultIsPidAlive
  const sleep = deps.sleep ?? sleepMs
  const qmpPowerdown = deps.qmpPowerdown ?? qmpSystemPowerdown
  let resolvedBins: { qemuSystem: string; qemuImg: string } | null = null

  const locateBins: QemuBinLocator = async (): Promise<
    { ok: true; bins: { qemuSystem: string; qemuImg: string } } | { ok: false; reason: string }
  > => {
    if (resolvedBins !== null) {
      return { ok: true, bins: resolvedBins }
    }
    const candidates = deps.qemuSystemBin
      ? [deps.qemuSystemBin]
      : qemuSystemCandidates(env, platform)
    for (const candidate of candidates) {
      const probe = await runProcess({ program: candidate, args: ['--version'], timeoutMs: 10_000 })
      if (probe.code !== 0) {
        continue
      }
      const qemuImg = deps.qemuImgBin ?? qemuImgSiblingPath(candidate, platform)
      resolvedBins = { qemuSystem: candidate, qemuImg }
      return { ok: true, bins: resolvedBins }
    }
    return { ok: false, reason: `qemu-system-x86_64 not found (probed: ${candidates.join(', ')})` }
  }

  const currentPid = (metadata: QemuVmMetadata): number | undefined =>
    readPidFromPidFile(metadata.pidFilePath)

  const snapshotOps = createQemuSnapshotOps({
    dir: deps.dir,
    runProcess,
    locateBins,
    isPidAlive
  })

  return {
    id: 'qemu',
    availability: async () => {
      const bins = await locateBins()
      return bins.ok
        ? { available: true, reason: `qemu at ${bins.bins.qemuSystem}` }
        : { available: false, reason: bins.reason }
    },
    available: async () => {
      const bins = await locateBins()
      return bins.ok
    },
    create: async (spec: VmSpec) => {
      const valid = validateVmSpec(spec)
      if (!valid.ok) {
        throw new Error(valid.reason)
      }
      if (imageRefIsRemote(spec.imageRef)) {
        throw new Error(
          `remote imageRef refused; materialize via vm-images first: ${spec.imageRef}`
        )
      }
      if (!existsSync(spec.imageRef)) {
        throw new Error(`imageRef does not exist: ${spec.imageRef}`)
      }
      const bins = await locateBins()
      if (!bins.ok) {
        throw new Error(bins.reason)
      }
      mkdirSync(deps.dir, { recursive: true })
      const diskPath = join(deps.dir, `${spec.name}.qcow2`)
      const metadataPath = qemuMetadataPath(deps.dir, spec.name)
      if (existsSync(diskPath) || existsSync(metadataPath)) {
        throw new Error(`garden VM ${spec.name} already exists on the qemu backend`)
      }
      const create = await runProcess({
        program: bins.bins.qemuImg,
        args: buildQemuImgCreateArgs(diskPath, spec.diskGb),
        timeoutMs: 120_000
      })
      if (create.code !== 0) {
        throw new Error(
          `qemu-img create failed: ${create.stderr.trim() || `exit ${String(create.code)}`}`
        )
      }
      // --ssh reserves the hostfwd port at create time so it is known before the first start.
      const sshReserved =
        spec.sshRequested === true ? nextFreePort(usedPortsFromMetadata(deps.dir).ssh, 2222) : 0
      const metadata = mergeQemuVmMetadata(
        {
          name: spec.name,
          backend: 'qemu',
          diskPath,
          pidFilePath: join(deps.dir, `${spec.name}.pid`),
          serialLogPath: join(deps.dir, `${spec.name}.serial.log`),
          qmpPort: 0,
          sshHostPort: 0,
          vcpus: spec.vcpus,
          memoryMb: spec.memoryMb,
          diskGb: spec.diskGb,
          imageRef: spec.imageRef,
          natNetwork: spec.natNetwork,
          createdAtEpochMs: Date.now()
        },
        { sshHostPort: sshReserved, sshRequested: spec.sshRequested === true ? true : undefined }
      )
      writeFileSync(metadataPath, JSON.stringify(metadata, null, 2))
      return {
        id: spec.name,
        backend: 'qemu',
        state: 'created',
        name: spec.name,
        diskPath,
        sshHostPort: sshReserved > 0 ? sshReserved : undefined
      }
    },
    start: async (handle: VmHandle) => {
      const metadataPath = qemuMetadataPath(deps.dir, handle.id)
      const metadata = readQemuMetadata(metadataPath)
      const pid = currentPid(metadata)
      if (pid !== undefined && isPidAlive(pid)) {
        return {
          ...handle,
          state: 'running',
          pid,
          name: metadata.name,
          diskPath: metadata.diskPath
        }
      }
      const bins = await locateBins()
      if (!bins.ok) {
        throw new Error(bins.reason)
      }
      const used = usedPortsFromMetadata(deps.dir)
      // A --ssh reservation from create wins; otherwise allocate the next free hostfwd port.
      const sshHostPort =
        metadata.sshHostPort > 0 ? metadata.sshHostPort : nextFreePort(used.ssh, 2222)
      const qmpPort = nextFreePort(used.qmp, 4444)
      const plan: QemuLaunchPlan = {
        name: metadata.name,
        vcpus: metadata.vcpus,
        memoryMb: metadata.memoryMb,
        diskPath: metadata.diskPath,
        cdromPath: metadata.imageRef.toLowerCase().endsWith('.iso') ? metadata.imageRef : undefined,
        sshHostPort,
        qmpPort,
        serialLogPath: metadata.serialLogPath,
        pidFilePath: metadata.pidFilePath,
        natNetwork: metadata.natNetwork,
        platform
      }
      rmSync(metadata.pidFilePath, { force: true })
      rmSync(metadata.serialLogPath, { force: true })
      const spawned = startDetached({
        program: bins.bins.qemuSystem,
        args: buildQemuSystemArgs(plan),
        timeoutMs: null
      })
      if (spawned.pid === undefined) {
        throw new Error('qemu spawn failed: no pid')
      }
      // -pidfile appears once QEMU parsed its args; absence means the launch died immediately.
      for (let waited = 0; waited < 15_000; waited += 500) {
        if (readPidFromPidFile(metadata.pidFilePath) !== undefined) {
          break
        }
        if (!isPidAlive(spawned.pid)) {
          throw new Error(
            `qemu exited during startup (pid ${String(spawned.pid)}); see ${metadata.serialLogPath}`
          )
        }
        await sleep(500)
      }
      const startedPid = readPidFromPidFile(metadata.pidFilePath) ?? spawned.pid
      writeFileSync(
        metadataPath,
        JSON.stringify(
          mergeQemuVmMetadata(metadata, {
            sshHostPort,
            qmpPort,
            lastStartedAtEpochMs: Date.now()
          }),
          null,
          2
        )
      )
      return {
        ...handle,
        state: 'running',
        pid: startedPid,
        name: metadata.name,
        diskPath: metadata.diskPath,
        sshHostPort
      }
    },
    stop: async (handle: VmHandle, mode: VmStopMode) => {
      const metadata = readQemuMetadata(qemuMetadataPath(deps.dir, handle.id))
      const pid = currentPid(metadata) ?? handle.pid
      if (pid === undefined || !isPidAlive(pid)) {
        return { ...handle, state: 'stopped', pid: undefined }
      }
      await stopQemuPid(
        { runProcess, isPidAlive, sleep, qmpPowerdown, platform },
        pid,
        mode,
        metadata.qmpPort
      )
      return { ...handle, state: 'stopped', pid: undefined }
    },
    status: async (handle: VmHandle) => {
      const metadata = readQemuMetadata(qemuMetadataPath(deps.dir, handle.id))
      const pid = currentPid(metadata) ?? handle.pid
      if (pid === undefined) {
        return 'stopped'
      }
      return isPidAlive(pid) ? 'running' : 'stopped'
    },
    listNames: async () => listGardenNamesFromDir(deps.dir),
    delete: async (handle: VmHandle) => {
      const metadataPath = qemuMetadataPath(deps.dir, handle.id)
      const metadata = readQemuMetadata(metadataPath)
      const pid = currentPid(metadata) ?? handle.pid
      if (pid !== undefined && isPidAlive(pid)) {
        throw new Error(
          `garden VM ${handle.id} is running (pid ${String(pid)}); stop it before delete`
        )
      }
      rmSync(metadata.diskPath, { force: true })
      rmSync(metadataPath, { force: true })
      rmSync(metadata.pidFilePath, { force: true })
      rmSync(metadata.serialLogPath, { force: true })
    },
    ...snapshotOps
  }
}
