import { collectRoleGrants, evaluate } from '@shield/access/permission-evaluate'
import type { AuditEvent } from '@shield/access/audit-chain'
import type { Permission } from '@shield/access'
import { suckerInvokeAuditEvent, suckerLifecycleAuditEvent } from './sucker-audit'
import { declaredCapability, resolveGrantRows, type SuckerGrantSelection } from './sucker-grants'
import {
  SUCKER_CAPABILITY_RESOURCE_KIND,
  parseSuckerManifest,
  type SuckerManifest,
  type SuckerManifestParseOptions
} from './sucker-manifest'
import type { SuckerProcessLike, SuckerProcessResult } from './sucker-process'

/**
 * Sucker runtime broker (docs/sucker-contract.md §3 lifecycle, §5 egress).
 * Deny-by-default: an invoke runs only when evaluate() allows the exact
 * (sucker.capability, capability) row against the Sucker's in-memory
 * grant set, which mirrors role_permissions semantics on a Sucker-scoped
 * role. Grant snapshots are taken per invoke and never cached — a revoke
 * takes effect on the next call (contract §3 revocation completeness).
 */

export type { SuckerCapabilityGrant, SuckerGrantSelection } from './sucker-grants'
export type { SuckerProcessLike, SuckerProcessRequest, SuckerProcessResult } from './sucker-process'
export { noopSuckerProcess } from './sucker-process'

export type SuckerInvokeResult =
  | { outcome: 'satisfied'; process: SuckerProcessResult; auditEvent: AuditEvent }
  | { outcome: 'empty'; process: SuckerProcessResult; auditEvent: AuditEvent }
  | { outcome: 'permissionDenied'; because: 'explicit-deny' | 'no-grant'; auditEvent: AuditEvent }
  | { outcome: 'upstream-failure'; retryable: boolean; auditEvent: AuditEvent }

export type SuckerInstallResult =
  | { ok: true; manifest: SuckerManifest; auditEvent: AuditEvent }
  | { ok: false; reason: string }

export type SuckerGrantResult =
  | { ok: true; manifest: SuckerManifest; grantedCount: number; auditEvent: AuditEvent }
  | { ok: false; reason: string }

export type SuckerRevokeResult =
  | { ok: true; manifest: SuckerManifest; auditEvent: AuditEvent }
  | { ok: false; reason: string }

export type SuckerSummary = {
  id: string
  version: string
  kind: SuckerManifest['kind']
  tier: SuckerManifest['isolation']['tier']
  status: 'installed' | 'granted' | 'revoked'
  publisherId: string
  grantCount: number
  requestedCount: number
  declaredCapabilities: readonly string[]
}

export type SuckerBrokerOptions = {
  spawn: SuckerProcessLike
  invokeTimeoutMs?: number
  /** Forwarded to the manifest parser (contract §1 resource-kind registry). */
  resourceKinds?: ReadonlySet<string>
  /** Audit sink seam: the Postgres audit-store writer plugs in here later. */
  onAuditEvent?: (event: AuditEvent) => void
}

type SuckerStatus = 'installed' | 'granted' | 'revoked'

/** Persisted-shape record exchanged with the durable store (state file now, Postgres later). */
export type SuckerPersistedRecord = {
  manifest: SuckerManifest
  status: SuckerStatus
  grants: readonly Permission[]
}

type SuckerRecord = {
  manifest: SuckerManifest
  status: SuckerStatus
  grants: readonly Permission[]
}

const argsByteCount = (args: readonly string[]): number =>
  args.reduce((total, arg) => total + Buffer.byteLength(arg, 'utf8'), 0)

export class SuckerBroker {
  private readonly spawn: SuckerProcessLike
  private readonly invokeTimeoutMs: number
  private readonly manifestOptions: SuckerManifestParseOptions
  private readonly onAuditEvent: (event: AuditEvent) => void
  private readonly records = new Map<string, SuckerRecord>()

  constructor(options: SuckerBrokerOptions) {
    this.spawn = options.spawn
    this.invokeTimeoutMs = options.invokeTimeoutMs ?? 120_000
    this.manifestOptions =
      options.resourceKinds === undefined ? {} : { resourceKinds: options.resourceKinds }
    this.onAuditEvent = options.onAuditEvent ?? (() => {})
  }

  private audit(event: AuditEvent): AuditEvent {
    this.onAuditEvent(event)
    return event
  }

  private lifecycleRecord(
    suckerId: string,
    phase: 'install' | 'grant' | 'revoke',
    record: SuckerRecord,
    grantCount: number
  ): AuditEvent {
    return this.audit(
      suckerLifecycleAuditEvent({
        suckerId,
        phase,
        version: record.manifest.version,
        kind: record.manifest.kind,
        tier: record.manifest.isolation.tier,
        publisherId: record.manifest.publisher.id,
        grantCount,
        requestedCount: record.manifest.permissions.length
      })
    )
  }

  /**
   * install: validate and register with ZERO authority (contract §3.1
   * installed-not-attested). Ids are immutable principals — an id already
   * on file, installed or revoked, never reinstalls.
   */
  async install(input: unknown): Promise<SuckerInstallResult> {
    const parsed = parseSuckerManifest(input, this.manifestOptions)
    if (!parsed.ok) {
      return parsed
    }
    const manifest = parsed.manifest
    if (this.records.has(manifest.id)) {
      return { ok: false, reason: `sucker id already registered: ${manifest.id}` }
    }
    const record: SuckerRecord = { manifest, status: 'installed', grants: [] }
    this.records.set(manifest.id, record)
    const auditEvent = this.lifecycleRecord(manifest.id, 'install', record, 0)
    return { ok: true, manifest, auditEvent }
  }

  /**
   * grant: the human approval step (contract §3.3). Writes exact rows on
   * the Sucker-scoped role; the resolver rejects anything the manifest did
   * not request, and partial grants degrade to permissionDenied per §4.
   */
  async grant(suckerId: string, selection: SuckerGrantSelection = {}): Promise<SuckerGrantResult> {
    const record = this.records.get(suckerId)
    if (record === undefined) {
      return { ok: false, reason: `unknown sucker: ${suckerId}` }
    }
    if (record.status === 'revoked') {
      return { ok: false, reason: `sucker is revoked; grants are final: ${suckerId}` }
    }
    const resolved = resolveGrantRows(record.manifest, selection)
    if (!resolved.ok) {
      return resolved
    }
    record.grants = resolved.rows
    record.status = 'granted'
    const auditEvent = this.lifecycleRecord(suckerId, 'grant', record, resolved.rows.length)
    return { ok: true, manifest: record.manifest, grantedCount: resolved.rows.length, auditEvent }
  }

  /**
   * invoke: one brokered capability exchange (contract §4/§5). The grant
   * check re-evaluates per call against a fresh snapshot; refusal happens
   * BEFORE any process spawn. Malformed caller input throws (caller bug,
   * not an authority question); unknown suckers and ungranted capabilities
   * deny as permissionDenied.
   */
  async invoke(
    suckerId: string,
    capability: string,
    args: readonly string[] = []
  ): Promise<SuckerInvokeResult> {
    if (typeof capability !== 'string' || capability.length === 0) {
      throw new RangeError('capability must be a non-empty string')
    }
    if (!Array.isArray(args) || args.some((arg) => typeof arg !== 'string')) {
      throw new RangeError('args must be an array of strings')
    }
    const auditBase = { suckerId, capability, argsBytes: argsByteCount(args) }
    const denied = (because: 'explicit-deny' | 'no-grant'): SuckerInvokeResult => ({
      outcome: 'permissionDenied',
      because,
      auditEvent: this.audit(
        suckerInvokeAuditEvent({
          ...auditBase,
          outcome: 'permissionDenied',
          because,
          exitCode: null,
          timedOut: false,
          durationMs: 0
        })
      )
    })
    const record = this.records.get(suckerId)
    if (record === undefined || declaredCapability(record.manifest, capability) === undefined) {
      return denied('no-grant')
    }
    // Fresh per-call snapshot; never cached across invokes (contract §3.4).
    const grants = collectRoleGrants({ roles: [{ permissions: record.grants }] })
    const decision = evaluate(grants, {
      resourceKind: SUCKER_CAPABILITY_RESOURCE_KIND,
      action: capability
    })
    if (!decision.granted) {
      return denied(decision.because === 'explicit-deny' ? 'explicit-deny' : 'no-grant')
    }
    const startedAt = Date.now()
    let process: SuckerProcessResult
    try {
      process = await this.spawn({
        suckerId,
        capability,
        args: [...args],
        timeoutMs: this.invokeTimeoutMs
      })
    } catch {
      return {
        outcome: 'upstream-failure',
        retryable: false,
        auditEvent: this.audit(
          suckerInvokeAuditEvent({
            ...auditBase,
            outcome: 'upstream-failure',
            retryable: false,
            exitCode: null,
            timedOut: false,
            durationMs: Date.now() - startedAt
          })
        )
      }
    }
    if (process.timedOut) {
      return {
        outcome: 'upstream-failure',
        retryable: true,
        auditEvent: this.audit(
          suckerInvokeAuditEvent({
            ...auditBase,
            outcome: 'upstream-failure',
            retryable: true,
            exitCode: process.exitCode,
            timedOut: true,
            durationMs: process.durationMs
          })
        )
      }
    }
    const outcome = process.exitCode === 0 && process.stdout === '' ? 'empty' : 'satisfied'
    return {
      outcome,
      process,
      auditEvent: this.audit(
        suckerInvokeAuditEvent({
          ...auditBase,
          outcome,
          exitCode: process.exitCode,
          timedOut: process.timedOut,
          durationMs: process.durationMs
        })
      )
    }
  }

  /**
   * revoke: strips every grant; the next invoke denies with no-grant and
   * no process cooperation is required. Revocation is final for the id
   * (new principal = new id per contract §1).
   */
  async revoke(suckerId: string): Promise<SuckerRevokeResult> {
    const record = this.records.get(suckerId)
    if (record === undefined) {
      return { ok: false, reason: `unknown sucker: ${suckerId}` }
    }
    if (record.status === 'revoked') {
      return { ok: false, reason: `sucker already revoked: ${suckerId}` }
    }
    record.grants = []
    record.status = 'revoked'
    const auditEvent = this.lifecycleRecord(suckerId, 'revoke', record, 0)
    return { ok: true, manifest: record.manifest, auditEvent }
  }

  list(): readonly SuckerSummary[] {
    return [...this.records.values()]
      .map((record): SuckerSummary => ({
        id: record.manifest.id,
        version: record.manifest.version,
        kind: record.manifest.kind,
        tier: record.manifest.isolation.tier,
        status: record.status,
        publisherId: record.manifest.publisher.id,
        grantCount: record.grants.length,
        requestedCount: record.manifest.permissions.length,
        declaredCapabilities: record.manifest.egress.map((entry) => entry.capability)
      }))
      .sort((a, b) => a.id.localeCompare(b.id))
  }

  /**
   * Durable-state seam: rehydrates one Sucker from the persistence layer
   * (CLI state file now, the Postgres sucker_principals/sucker_grants store
   * later). Malformed grants are dropped, never guessed — a rehydrated
   * Sucker denies until its rows load intact. First registration of an id
   * wins; live in-memory state is never overwritten.
   */
  restore(record: {
    manifest: SuckerManifest
    status: SuckerStatus
    grants?: readonly Permission[]
  }): void {
    if (this.records.has(record.manifest.id)) {
      return
    }
    const grants = (record.grants ?? []).filter(
      (row): row is Permission =>
        (row.effect === 'allow' || row.effect === 'deny') &&
        typeof row.resourceKind === 'string' &&
        row.resourceKind.length > 0 &&
        typeof row.action === 'string' &&
        row.action.length > 0
    )
    const status: SuckerStatus =
      record.status === 'granted' || record.status === 'revoked' ? record.status : 'installed'
    this.records.set(record.manifest.id, { manifest: record.manifest, status, grants })
  }

  /** Exact persisted-shape view for the durable store to write back. */
  snapshot(): readonly SuckerPersistedRecord[] {
    return [...this.records.values()].map((record) => ({
      manifest: record.manifest,
      status: record.status,
      grants: [...record.grants]
    }))
  }
}
