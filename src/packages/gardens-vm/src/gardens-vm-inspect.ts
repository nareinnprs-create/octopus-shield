import {
  gardensVmAuditEvent,
  type GardensVmLifecycleRecord,
  type GardensVmListEntry,
  type GardensVmOpResult
} from './gardens-vm-audit'
import { GARDENS_SCOPE_ENV, vmNameInScope, type GardensScope } from './gardens-vm-scope'
import type {
  VmBackend,
  VmBackendId,
  VmDiskSnapshot,
  VmHandle,
  VmInspectInfo,
  VmState
} from './vm-backend'

/** Everything the read-only views need from the manager; no mutation, no audit records. */
export type GardensReadOpsDeps = {
  ensureScope: (operation: string, name: string) => { ok: true } | { ok: false; reason: string }
  resolveBackend: () => Promise<{ ok: true; backend: VmBackend } | { ok: false; reason: string }>
  bareHandle: (name: string) => VmHandle
  scope: () => GardensScope
}

/** Enriched read-only view (pid, uptime, disk, ports, snapshots) for `status <name>`. */
export const inspectGardensVm = async (
  deps: GardensReadOpsDeps,
  name: string
): Promise<{ ok: true; info: VmInspectInfo } | { ok: false; reason: string }> => {
  const scopeCheck = deps.ensureScope('status', name)
  if (!scopeCheck.ok) {
    return scopeCheck
  }
  const resolved = await deps.resolveBackend()
  if (!resolved.ok) {
    return resolved
  }
  const handle = deps.bareHandle(name)
  if (resolved.backend.inspect === undefined) {
    const state = await resolved.backend.status(handle).catch(() => 'error' as VmState)
    return {
      ok: true,
      info: {
        name,
        backend: resolved.backend.id,
        state,
        pidAlive: state === 'running',
        snapshots: []
      }
    }
  }
  return { ok: true, info: await resolved.backend.inspect(handle) }
}

export const listGardenSnapshots = async (
  deps: GardensReadOpsDeps,
  name: string
): Promise<{ ok: true; snapshots: readonly VmDiskSnapshot[] } | { ok: false; reason: string }> => {
  const scopeCheck = deps.ensureScope('list-snapshots', name)
  if (!scopeCheck.ok) {
    return scopeCheck
  }
  const resolved = await deps.resolveBackend()
  if (!resolved.ok) {
    return resolved
  }
  if (resolved.backend.listSnapshots === undefined) {
    return { ok: false, reason: `snapshot listing unsupported on backend ${resolved.backend.id}` }
  }
  return resolved.backend.listSnapshots(deps.bareHandle(name))
}

const listRecord = (
  backendId: VmBackendId,
  vmName: string,
  startedAt: number,
  ok: boolean,
  detail?: string
): GardensVmLifecycleRecord => ({
  operation: 'list',
  vmName,
  backend: backendId,
  ok,
  durationMs: Date.now() - startedAt,
  detail,
  audited: true
})

export const listScopedGardens = async (deps: GardensReadOpsDeps): Promise<GardensVmOpResult> => {
  const scope = deps.scope()
  if (scope.size === 0) {
    return {
      ok: false,
      reason: `list refused: ${GARDENS_SCOPE_ENV} is unset or empty (deny-by-default)`
    }
  }
  const resolved = await deps.resolveBackend()
  if (!resolved.ok) {
    return { ok: false, reason: resolved.reason }
  }
  const startedAt = Date.now()
  try {
    const names = (await resolved.backend.listNames?.()) ?? []
    const entries: GardensVmListEntry[] = []
    for (const name of names.filter((candidate) => vmNameInScope(scope, candidate))) {
      const state = await resolved.backend
        .status(deps.bareHandle(name))
        .catch(() => 'error' as VmState)
      entries.push({ name, state })
    }
    const record = listRecord(resolved.backend.id, `${entries.length} in scope`, startedAt, true)
    return { ok: true, record, audit: gardensVmAuditEvent(record), entries }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    const record = listRecord(resolved.backend.id, '*', startedAt, false, detail)
    return { ok: false, reason: detail, record, audit: gardensVmAuditEvent(record) }
  }
}
