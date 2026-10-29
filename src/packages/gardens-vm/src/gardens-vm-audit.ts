import type { VmBackendId, VmBackend, VmHandle, VmState } from './vm-backend'

export type GardensVmOperation =
  | 'create'
  | 'start'
  | 'stop'
  | 'delete'
  | 'status'
  | 'list'
  | 'snapshot'
  | 'rollback'
  | 'image-download'

export type GardensVmLifecycleRecord = {
  operation: GardensVmOperation
  vmName: string
  backend: VmBackendId | 'none'
  ok: boolean
  state?: VmState
  durationMs: number
  detail?: string
  audited: true
}

/** Same shape as @shield/armory armory-audit events (actor_kind='tentacle'). */
export type GardensVmAuditEvent = {
  tsEpochMs: number
  actorKind: 'tentacle'
  actorId: 'gardens-vm'
  action: string
  resourceKind: 'gardens-vm'
  resourceId: string
  traceId: null
  payload: Record<string, unknown>
}

export const gardensVmAuditEvent = (record: GardensVmLifecycleRecord): GardensVmAuditEvent => ({
  tsEpochMs: Date.now(),
  actorKind: 'tentacle',
  actorId: 'gardens-vm',
  action: `gardens.vm.${record.operation}`,
  resourceKind: 'gardens-vm',
  resourceId: record.vmName,
  traceId: null,
  payload: {
    backend: record.backend,
    ok: record.ok,
    state: record.state,
    durationMs: record.durationMs,
    detail: record.detail
  }
})

export type GardensVmListEntry = { name: string; state: VmState }

export type GardensVmOpResult =
  | {
      ok: true
      record: GardensVmLifecycleRecord
      audit: GardensVmAuditEvent
      handle?: VmHandle
      entries?: readonly GardensVmListEntry[]
    }
  | { ok: false; reason: string; record?: GardensVmLifecycleRecord; audit?: GardensVmAuditEvent }

/** Everything a scoped, audit-wrapped lifecycle op needs from the manager. */
export type GardensLifecycleContext = {
  ensureScope: (operation: string, name: string) => { ok: true } | { ok: false; reason: string }
  resolveBackend: () => Promise<{ ok: true; backend: VmBackend } | { ok: false; reason: string }>
  defaultBackendId: VmBackendId
}

/** Scope check → backend resolution → audited work; failures become failed records. */
export const runAuditedLifecycleOp = async <T>(
  context: GardensLifecycleContext,
  operation: GardensVmOperation,
  vmName: string,
  work: (backend: VmBackend) => Promise<T>,
  describe: (result: T) => { state?: VmState; detail?: string; handle?: VmHandle }
): Promise<GardensVmOpResult> => {
  const scopeCheck = context.ensureScope(operation, vmName)
  if (!scopeCheck.ok) {
    return { ok: false, reason: scopeCheck.reason }
  }
  const resolved = await context.resolveBackend()
  if (!resolved.ok) {
    return { ok: false, reason: resolved.reason }
  }
  const startedAt = Date.now()
  try {
    const shaped = describe(await work(resolved.backend))
    const record: GardensVmLifecycleRecord = {
      operation,
      vmName,
      backend: resolved.backend.id,
      ok: true,
      state: shaped.state,
      durationMs: Date.now() - startedAt,
      detail: shaped.detail,
      audited: true
    }
    return { ok: true, record, audit: gardensVmAuditEvent(record), handle: shaped.handle }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    const record: GardensVmLifecycleRecord = {
      operation,
      vmName,
      backend: resolved.backend.id,
      ok: false,
      durationMs: Date.now() - startedAt,
      detail,
      audited: true
    }
    return { ok: false, reason: detail, record, audit: gardensVmAuditEvent(record) }
  }
}
