import { z } from 'zod'

/** Renderer-facing projection of an ArmoryToolDescriptor; targets are never executed without scope. */
export type ArmoryToolView = {
  id: string
  title: string
  category: string
  runtime: 'win' | 'wsl' | 'docker'
  target: string
  scopeClass: string
  status: 'ok' | 'failed' | 'quarantined-by-av' | 'skipped'
}

/** OSHIELD_ARMORY_SCOPE projection; scope env is operator configuration, not secret material. */
export type ArmoryScopeState = {
  raw: string
  targets: readonly string[]
  cidrs: readonly string[]
  exploitAuthorized: boolean
  authorized: boolean
}

export type ArmoryHealthEntryState = 'ok' | 'unhealthy' | 'denied' | 'spawn-failed' | 'skipped'

export type ArmoryHealthEntry = {
  toolId: string
  state: ArmoryHealthEntryState
  detail: string
}

export type ArmoryHealthReport = {
  entries: readonly ArmoryHealthEntry[]
  healthy: number
  checkable: number
}

/** Structural mirror of the access-ledger AuditEvent emitted per run. */
export type ArmoryAuditEventView = {
  tsEpochMs: number
  actorKind: string
  actorId: string
  action: string
  resourceKind: string
  resourceId: string
  traceId: string | null
  payload: unknown
}

export type ArmoryRunRecordView = {
  toolId: string
  argv: readonly string[]
  targets: readonly string[]
  exitCode: number | null
  timedOut: boolean
  durationMs: number
  stdout: string
  stderr: string
  audited: true
}

export type ArmoryRunOutcome =
  | { ok: true; record: ArmoryRunRecordView; auditEvent: ArmoryAuditEventView }
  | { ok: false; reason: string }

export const ArmoryRunIpcRequestSchema = z.object({
  toolId: z.string().min(1),
  targets: z.array(z.string().min(1)).min(1),
  args: z.array(z.string())
})

export type ArmoryRunIpcRequest = z.infer<typeof ArmoryRunIpcRequestSchema>
