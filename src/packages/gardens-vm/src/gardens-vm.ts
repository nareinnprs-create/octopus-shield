import { join } from 'node:path'
import {
  createBackendSelector,
  createDefaultGardensBackends,
  type BackendSelector,
  type BackendVerdict
} from './gardens-vm-backends'
import { gardensVmDirFromEnv } from './gardens-vm-dirs'
import {
  resolveGardensImageRef,
  downloadCatalogImage,
  type GardensVmCreateRequest
} from './gardens-vm-image-ref'
import type { FetchLike, VmImageId } from './vm-images'
import {
  inspectGardensVm,
  listGardenSnapshots,
  listScopedGardens,
  type GardensReadOpsDeps
} from './gardens-vm-inspect'
import {
  runAuditedLifecycleOp,
  type GardensVmLifecycleRecord,
  type GardensVmOpResult
} from './gardens-vm-audit'
import { scopeFromEnv, scopeRefusalReason, type GardensScope } from './gardens-vm-scope'
import type {
  StartDetachedLike,
  VmBackend,
  VmBackendDiagnostics,
  VmDiskSnapshot,
  VmHandle,
  VmInspectInfo,
  VmState,
  VmStopMode,
  RunProcessLike
} from './vm-backend'

export {
  GARDENS_SCOPE_ENV,
  parseGardensScope,
  scopeFromEnv,
  scopeRefusalReason,
  vmNameInScope,
  type GardensScope
} from './gardens-vm-scope'
export { GARDENS_DIR_ENV, gardensVmDirFromEnv } from './gardens-vm-dirs'
export {
  gardensVmAuditEvent,
  runAuditedLifecycleOp,
  type GardensVmAuditEvent,
  type GardensVmLifecycleRecord,
  type GardensVmListEntry,
  type GardensVmOpResult
} from './gardens-vm-audit'
export type { GardensVmCreateRequest } from './gardens-vm-image-ref'

export type GardensVmManagerOptions = {
  env?: Readonly<Record<string, string | undefined>>
  dir?: string
  runProcess?: RunProcessLike
  backends?: readonly VmBackend[]
  startDetached?: StartDetachedLike
}

export class GardensVmManager {
  private readonly env: Readonly<Record<string, string | undefined>>
  private readonly dir: string
  private readonly backends: readonly (VmBackend & Partial<VmBackendDiagnostics>)[]
  private readonly selector: BackendSelector

  constructor(options: GardensVmManagerOptions = {}) {
    this.env = options.env ?? process.env
    this.dir = options.dir ?? gardensVmDirFromEnv(this.env)
    this.backends =
      options.backends ??
      createDefaultGardensBackends({
        dir: this.dir,
        env: this.env,
        runProcess: options.runProcess,
        startDetached: options.startDetached
      })
    this.selector = createBackendSelector(this.backends)
  }

  get gardensDir(): string {
    return this.dir
  }

  get imagesDir(): string {
    return join(this.dir, 'images')
  }

  private scope(): GardensScope {
    return scopeFromEnv(this.env)
  }

  private ensureScope(
    operation: string,
    name: string
  ): { ok: true } | { ok: false; reason: string } {
    const reason = scopeRefusalReason(this.scope(), operation, name)
    return reason === undefined ? { ok: true } : { ok: false, reason }
  }

  /** Probe every backend for the CLI status view; verdicts are cached for the manager lifetime. */
  async backendMatrix(): Promise<BackendVerdict[]> {
    return this.selector.matrix()
  }

  /** First available backend in configured order wins (default: qemu → hyperv → vz). */
  async resolveBackend(): Promise<
    { ok: true; backend: VmBackend } | { ok: false; reason: string }
  > {
    return this.selector.resolve()
  }

  async create(request: GardensVmCreateRequest): Promise<GardensVmOpResult> {
    const scopeCheck = this.ensureScope('create', request.name)
    if (!scopeCheck.ok) {
      return { ok: false, reason: scopeCheck.reason }
    }
    const imageRef = resolveGardensImageRef(request, this.imagesDir)
    if (!imageRef.ok) {
      return { ok: false, reason: imageRef.reason }
    }
    return this.run(
      'create',
      request.name,
      (backend) =>
        backend.create({
          name: request.name,
          vcpus: request.vcpus ?? 1,
          memoryMb: request.memoryMb ?? 512,
          diskGb: request.diskGb ?? 2,
          imageRef: imageRef.path,
          natNetwork: request.natNetwork ?? true,
          sshRequested: request.ssh === true
        }),
      (handle) => ({ state: handle.state, handle, detail: `image ${imageRef.path}` })
    )
  }

  async start(name: string): Promise<GardensVmOpResult> {
    return this.run(
      'start',
      name,
      (backend) => backend.start(this.bareHandle(name)),
      (handle) => ({
        state: handle.state,
        handle
      })
    )
  }

  async stop(name: string, mode: VmStopMode = 'acpi'): Promise<GardensVmOpResult> {
    return this.run(
      'stop',
      name,
      (backend) => backend.stop(this.bareHandle(name), mode),
      (handle) => ({
        state: handle.state,
        handle
      })
    )
  }

  async delete(name: string): Promise<GardensVmOpResult> {
    return this.run(
      'delete',
      name,
      async (backend) => {
        await backend.delete(this.bareHandle(name))
        return undefined
      },
      () => ({ state: 'deleted' })
    )
  }

  async status(name: string): Promise<GardensVmOpResult> {
    return this.run(
      'status',
      name,
      (backend) => backend.status(this.bareHandle(name)),
      (state) => ({
        state,
        detail: `state ${state}`
      })
    )
  }

  /** Enriched read-only view (pid, uptime, disk, ports, snapshots) for `status <name>`. */
  async inspect(
    name: string
  ): Promise<{ ok: true; info: VmInspectInfo } | { ok: false; reason: string }> {
    return inspectGardensVm(this.readDeps(), name)
  }

  async snapshot(name: string, snapshotId: string): Promise<GardensVmOpResult> {
    return this.run(
      'snapshot',
      name,
      async (backend) => {
        if (backend.snapshot === undefined) {
          throw new Error(`snapshot unsupported on backend ${backend.id}`)
        }
        const result = await backend.snapshot(this.bareHandle(name), snapshotId)
        if (!result.ok) {
          throw new Error(result.reason)
        }
        return result
      },
      (result) => ({ detail: `snapshot ${snapshotId} recorded in ${result.path}` })
    )
  }

  async rollback(name: string, snapshotId: string): Promise<GardensVmOpResult> {
    return this.run(
      'rollback',
      name,
      async (backend) => {
        if (backend.rollbackSnapshot === undefined) {
          throw new Error(`rollback unsupported on backend ${backend.id}`)
        }
        const result = await backend.rollbackSnapshot(this.bareHandle(name), snapshotId)
        if (!result.ok) {
          throw new Error(result.reason)
        }
        return result
      },
      () => ({ detail: `disk rolled back to snapshot ${snapshotId}` })
    )
  }

  async listSnapshots(
    name: string
  ): Promise<{ ok: true; snapshots: readonly VmDiskSnapshot[] } | { ok: false; reason: string }> {
    return listGardenSnapshots(this.readDeps(), name)
  }

  async list(): Promise<GardensVmOpResult> {
    return listScopedGardens(this.readDeps())
  }

  private readDeps(): GardensReadOpsDeps {
    return {
      ensureScope: (operation, name) => this.ensureScope(operation, name),
      resolveBackend: () => this.resolveBackend(),
      bareHandle: (name) => this.bareHandle(name),
      scope: () => this.scope()
    }
  }

  async downloadImage(imageId: VmImageId, fetchLike: FetchLike): Promise<GardensVmOpResult> {
    return downloadCatalogImage(imageId, this.imagesDir, fetchLike)
  }

  private async run<T>(
    operation: GardensVmLifecycleRecord['operation'],
    vmName: string,
    work: (backend: VmBackend) => Promise<T>,
    describe: (result: T) => { state?: VmState; detail?: string; handle?: VmHandle }
  ): Promise<GardensVmOpResult> {
    return runAuditedLifecycleOp(
      {
        ensureScope: (op, name) => this.ensureScope(op, name),
        resolveBackend: () => this.resolveBackend(),
        defaultBackendId: this.backends[0]?.id ?? 'qemu'
      },
      operation,
      vmName,
      work,
      describe
    )
  }

  private bareHandle(name: string): VmHandle {
    return { id: name, backend: this.backends[0]?.id ?? 'qemu', state: 'created' }
  }
}
