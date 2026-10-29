/**
 * Pure append-only audit hash chain (see infra/db/audit.sql).
 * No crypto here: an injected `hash(previousHash, canonicalEventJson)`
 * function performs the digesting, so web/artifact targets can substitute
 * their own implementation without importing node crypto.
 */

import type { AuditActorKind } from './permission-domain'

/** Version tag shared by every hash composition; must match the composition documented in infra/db/audit.sql. */
export const AUDIT_HASH_DOMAIN = 'osh-audit-v1'

/** Unit separator between composed fields. */
export const AUDIT_HASH_FIELD_SEPARATOR = '\u001f'

/** 64 zeros per the SQL genesis rule. */
export const GENESIS_PREV_HASH = '0'.repeat(64)

/**
 * Budgets so a hostile payload cannot recurse/dilate the audit writer, and a
 * serialized ledger row cannot diverge from the hashed bytes.
 */
const MAX_PAYLOAD_DEPTH = 12
const MAX_PAYLOAD_NODES = 10_000
const MAX_PAYLOAD_BYTES = 524_288

export type AuditEvent = {
  tsEpochMs: number
  actorKind: AuditActorKind
  actorId: string
  action: string
  resourceKind: string
  resourceId: string
  traceId: string | null
  /** JSON-serializable payload as written to audit_events.payload. */
  payload: unknown
}

export type LedgerEntry = AuditEvent & {
  prevHash: string
  entryHash: string
}

/** Injected digest contract: bytes are UTF-8 of the composed string. Returns 64 lowercase hex chars. */
export type EntryHashFn = (previousHash: string, canonicalEventJson: string) => string

/** True for 64 lowercase hex chars. */
export function isHashHex(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value)
}

function requireHashHex(value: string, field: 'prevHash' | 'entryHash' | 'initialHash'): void {
  if (!isHashHex(value)) {
    throw new RangeError(`${field} must be 64 lowercase hex chars`)
  }
}

type WriteBudget = { depth: number; nodes: number }

/**
 * Stable-order JSON: object keys sorted, undefined members and their keys
 * dropped, arrays preserved. Produces the writer-side `payloadJson` that the
 * DB stores (NOT Postgres jsonb text, which re-orders keys — see audit.sql
 * TODO(verify)). Values with no deterministic encoding (NaN/Infinity,
 * bigint, Map/Set, symbol/function nodes, non-plain objects) and payloads
 * beyond the depth/node/byte budgets are rejected: byte-stability of the
 * hashed composition is the contract.
 */
export function stableJson(value: unknown): string {
  const out = writeStable(value, { depth: 0, nodes: 0 })
  if (out.length > MAX_PAYLOAD_BYTES) {
    throw new RangeError(`payload exceeds ${MAX_PAYLOAD_BYTES} canonical bytes`)
  }
  return out
}

function budgetNext(budget: WriteBudget): WriteBudget {
  const nodes = budget.nodes + 1
  if (nodes > MAX_PAYLOAD_NODES) {
    throw new RangeError(`payload exceeds ${MAX_PAYLOAD_NODES} nodes`)
  }
  if (budget.depth + 1 > MAX_PAYLOAD_DEPTH) {
    throw new RangeError(`payload exceeds ${MAX_PAYLOAD_DEPTH} levels of depth`)
  }
  return { depth: budget.depth + 1, nodes }
}

function writeStable(value: unknown, budget: WriteBudget): string {
  const next = budgetNext(budget)
  if (value === null) {
    return 'null'
  }
  switch (typeof value) {
    case 'bigint':
    case 'symbol':
    case 'function':
      throw new RangeError(`payload contains non-JSON-encodable ${typeof value}`)
    case 'undefined':
      return 'null'
    case 'number':
      if (!Number.isFinite(value)) {
        throw new RangeError('payload contains NaN/Infinity: no byte-stable JSON encoding exists')
      }
      return JSON.stringify(value)
    case 'string':
      return JSON.stringify(value)
    case 'boolean':
      return JSON.stringify(value)
    case 'object': {
      if (Array.isArray(value)) {
        const parts: string[] = []
        for (const item of value) {
          parts.push(writeStable(item, { depth: next.depth, nodes: next.nodes }))
        }
        return `[${parts.join(',')}]`
      }
      if (!isPlainObject(value)) {
        throw new RangeError('payload contains a non-plain object (Map/Set/Date/class instance)')
      }
      // SAFETY: value is a plain object record here; unknown carries string keys only after the check.
      const record = value as Record<string, unknown>
      const keys = Object.keys(record).sort()
      const members: string[] = []
      for (const key of keys) {
        const item = record[key]
        if (item === undefined) {
          continue
        }
        members.push(
          `${JSON.stringify(key)}:${writeStable(item, { depth: next.depth, nodes: next.nodes })}`
        )
      }
      return `{${members.join(',')}}`
    }
    default:
      throw new RangeError(`payload contains non-JSON-encodable ${typeof value}`)
  }
}

function isPlainObject(value: object): boolean {
  const prototype = Object.getPrototypeOf(value) as unknown
  return prototype === null || prototype === Object.prototype
}

/**
 * The composed fields are joined with 0x1F; a control char inside a field
 * would let two distinct events produce identical canonical bytes
 * (field-shift ambiguity). Rejected in depth here and mirrored as a CHECK in
 * infra/db/audit.sql.
 */
export function assertEventFieldsControlFree(event: AuditEvent): void {
  const fields = [
    event.actorId,
    event.action,
    event.resourceKind,
    event.resourceId,
    ...(event.traceId === null ? [] : [event.traceId])
  ]
  for (const field of fields) {
    // oxlint-disable-next-line no-control-regex -- matching control chars is the point; mirrors audit_events_no_control_chars
    if (/[\u0000-\u001f\u007f]/.test(field)) {
      throw new RangeError(
        `audit event field contains a control character: ${JSON.stringify(field.slice(0, 32))}`
      )
    }
  }
}

/** Canonical post-prev-hash composition: everything after prev_hash, in field order. */
export function canonicalEventJson(event: AuditEvent): string {
  return [
    event.actorKind,
    event.actorId,
    event.action,
    event.resourceKind,
    event.resourceId,
    event.traceId ?? '',
    String(event.tsEpochMs),
    stableJson(event.payload)
  ].join(AUDIT_HASH_FIELD_SEPARATOR)
}

/** DB-writer composition (infra/db/audit.sql ENTRY_HASH): hashFn over the tail-or-genesis prev hash plus the canonical event. */
export function composeEntryHash(prevHash: string, event: AuditEvent, hashFn: EntryHashFn): string {
  requireHashHex(prevHash, 'prevHash')
  return requireComputedHash(hashFn(prevHash, canonicalEventJson(event)))
}

/** Append-only builder. Validation errors are thrown before state mutation, so a failed append leaves the chain untouched. */
export class AuditChain {
  private readonly hash: EntryHashFn
  private readonly entries: LedgerEntry[] = []
  private lastHash: string

  constructor(hashFn: EntryHashFn, initialPrevHash: string) {
    requireHashHex(initialPrevHash, 'initialHash')
    this.hash = hashFn
    this.lastHash = initialPrevHash
  }

  static genesis(hashFn: EntryHashFn): AuditChain {
    return new AuditChain(hashFn, GENESIS_PREV_HASH)
  }

  /** Resume a chain from the tail row's entry_hash (e.g. process restart). */
  static resume(hashFn: EntryHashFn, tailEntryHash: string): AuditChain {
    return new AuditChain(hashFn, tailEntryHash)
  }

  append(event: AuditEvent): LedgerEntry {
    if (!Number.isSafeInteger(event.tsEpochMs) || event.tsEpochMs < 0) {
      throw new RangeError('tsEpochMs must be a non-negative safe integer')
    }
    if (event.actorId.length === 0 || event.action.length === 0) {
      throw new RangeError('actorId and action must be non-empty')
    }
    assertEventFieldsControlFree(event)
    const prevHash = this.lastHash
    const entryHash = requireComputedHash(this.hash(prevHash, canonicalEventJson(event)))
    const entry: LedgerEntry = { ...event, prevHash, entryHash }
    this.entries.push(entry)
    this.lastHash = entryHash
    return entry
  }

  get lastEntryHash(): string {
    return this.lastHash
  }

  get readonlyEntries(): readonly LedgerEntry[] {
    return this.entries
  }

  get entryCount(): number {
    return this.entries.length
  }

  /** Off-chain pin target for a watchdog (Ganglion parity job per audit.sql). */
  toCheckpoint(): string {
    return this.lastHash
  }
}

function requireComputedHash(entryHash: string): string {
  requireHashHex(entryHash, 'entryHash')
  return entryHash
}

/**
 * Verify a persisted row sequence against this hasher; returns the first
 * break it finds. Rows must arrive in (ts, id) ledger order — imported rows
 * with a NULL prev_hash have no chain context and must be filtered upstream.
 */
export function verifyLedger(
  entries: readonly LedgerEntry[],
  hashFn: EntryHashFn
): { ok: boolean; brokenIndex: number | null } {
  let prevHash = GENESIS_PREV_HASH
  for (let index = 0; index < entries.length; index = index + 1) {
    const entry = entries[index]
    if (entry.prevHash !== prevHash) {
      return { ok: false, brokenIndex: index }
    }
    const recomputed = hashFn(entry.prevHash, canonicalEventJson(entry))
    if (recomputed !== entry.entryHash) {
      return { ok: false, brokenIndex: index }
    }
    prevHash = entry.entryHash
  }
  return { ok: true, brokenIndex: null }
}
