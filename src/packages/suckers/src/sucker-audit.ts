import type { AuditEvent } from '@shield/access/audit-chain'
import type { SuckerKind, SuckerShedTier } from './sucker-manifest'

/**
 * Audit builders for the Sucker lifecycle (docs/sucker-contract.md §3, §5):
 * every transition — install, grant, invoke, revoke — becomes one
 * audit-chain event with actor_kind='sucker' and the Sucker id as actor_id.
 * Mirrors @shield/armory/src/armory-audit.ts.
 *
 * Inkout §6 hygiene: payloads carry shapes and counts, never raw args or
 * provider responses — invoke payloads record arg byte counts only.
 */

export const SUCKER_AUDIT_RESOURCE_KIND = 'sucker'
export const SUCKER_AUDIT_INVOKE_ACTION = 'sucker.invoke'

export type SuckerLifecyclePhase = 'install' | 'grant' | 'revoke'

export type SuckerLifecycleAuditRecord = {
  suckerId: string
  phase: SuckerLifecyclePhase
  version: string
  kind: SuckerKind
  tier: SuckerShedTier
  publisherId: string
  /** Requested rows on install; approved rows on grant; 0 on revoke. */
  grantCount: number
  requestedCount: number
}

export const suckerLifecycleAuditEvent = (record: SuckerLifecycleAuditRecord): AuditEvent => ({
  tsEpochMs: Date.now(),
  actorKind: 'sucker',
  actorId: record.suckerId,
  action: `sucker.${record.phase}`,
  resourceKind: SUCKER_AUDIT_RESOURCE_KIND,
  resourceId: record.suckerId,
  traceId: null,
  payload: {
    version: record.version,
    kind: record.kind,
    tier: record.tier,
    publisherId: record.publisherId,
    grantCount: record.grantCount,
    requestedCount: record.requestedCount
  }
})

/** Outcome vocabulary of the contract §4 SuckerResponse envelope. */
export type SuckerInvokeOutcome = 'satisfied' | 'empty' | 'permissionDenied' | 'upstream-failure'

export type SuckerInvokeAuditRecord = {
  suckerId: string
  capability: string
  outcome: SuckerInvokeOutcome
  /** permissionDenied reason; undefined for other outcomes. */
  because?: 'explicit-deny' | 'no-grant'
  /** Byte count of the serialized args — never the args themselves (Inkout §6). */
  argsBytes: number
  retryable?: boolean
  exitCode: number | null
  timedOut: boolean
  durationMs: number
}

export const suckerInvokeAuditEvent = (record: SuckerInvokeAuditRecord): AuditEvent => ({
  tsEpochMs: Date.now(),
  actorKind: 'sucker',
  actorId: record.suckerId,
  action: SUCKER_AUDIT_INVOKE_ACTION,
  resourceKind: 'sucker.capability',
  resourceId: record.capability,
  traceId: null,
  payload: {
    outcome: record.outcome,
    ...(record.because === undefined ? {} : { because: record.because }),
    argsBytes: record.argsBytes,
    ...(record.retryable === undefined ? {} : { retryable: record.retryable }),
    exitCode: record.exitCode,
    timedOut: record.timedOut,
    durationMs: record.durationMs
  }
})
