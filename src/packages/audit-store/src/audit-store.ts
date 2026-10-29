import {
  assertEventFieldsControlFree,
  composeEntryHash,
  GENESIS_PREV_HASH,
  isHashHex,
  stableJson,
  type AuditEvent,
  type EntryHashFn
} from '@shield/access/audit-chain'

/** Minimal structural pg surface the sink needs; tests substitute fakes. */
export type PgClientLike = {
  query(text: string, values?: readonly unknown[]): Promise<PgResultLike>
}

export type PgResultLike = {
  rowCount: number | null
  rows: { entry_hash: string }[]
}

export type AuditLedgerEntry = AuditEvent & {
  prevHash: string
  entryHash: string
}

const HEAD_SQL = 'SELECT entry_hash FROM audit_events ORDER BY ts DESC, id DESC LIMIT 1'
const INSERT_SQL =
  'INSERT INTO audit_events (ts, actor_kind, actor_id, action, resource_kind, resource_id, trace_id, payload, prev_hash, entry_hash) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10)'

const UNIQUE_VIOLATION_CODE = '23505'

/** The prev_hash unique index (audit_events_prev_hash_unique) turns a concurrent append into this code. */
export function isPostgresUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === UNIQUE_VIOLATION_CODE
  )
}

/**
 * Append-only audit_events writer (infra/db/audit.sql). Each append chains
 * onto the live head; a 23505 prev_hash race retries once against the
 * re-read head so concurrent writers serialize instead of forking.
 */
export class PostgresAuditSink {
  private readonly client: PgClientLike

  constructor(client: PgClientLike) {
    this.client = client
  }

  async append(event: AuditEvent, hashFn: EntryHashFn): Promise<AuditLedgerEntry> {
    assertAppendableEvent(event)
    try {
      return await this.insertChained(event, hashFn)
    } catch (error) {
      if (!isPostgresUniqueViolation(error)) {
        throw error
      }
      return this.insertChained(event, hashFn)
    }
  }

  /** Sequential by design: every entry chains onto the previous append's head. */
  async flush(batch: readonly AuditEvent[], hashFn: EntryHashFn): Promise<AuditLedgerEntry[]> {
    const entries: AuditLedgerEntry[] = []
    for (const event of batch) {
      entries.push(await this.append(event, hashFn))
    }
    return entries
  }

  private async insertChained(event: AuditEvent, hashFn: EntryHashFn): Promise<AuditLedgerEntry> {
    const prevHash = await this.readHeadHash()
    const entryHash = composeEntryHash(prevHash, event, hashFn)
    const result = await this.client.query(INSERT_SQL, [
      new Date(event.tsEpochMs),
      event.actorKind,
      event.actorId,
      event.action,
      event.resourceKind,
      event.resourceId,
      event.traceId,
      stableJson(event.payload),
      prevHash,
      entryHash
    ])
    if ((result.rowCount ?? 0) !== 1) {
      throw new Error(`audit_events insert affected ${result.rowCount ?? 0} rows`)
    }
    return { ...event, prevHash, entryHash }
  }

  private async readHeadHash(): Promise<string> {
    const head = await this.client.query(HEAD_SQL)
    if (head.rowCount === null || head.rowCount === 0 || head.rows.length === 0) {
      return GENESIS_PREV_HASH
    }
    const entryHash = head.rows[0].entry_hash
    if (!isHashHex(entryHash)) {
      throw new RangeError('audit_events head row has a malformed entry_hash')
    }
    return entryHash
  }
}

function assertAppendableEvent(event: AuditEvent): void {
  if (!Number.isSafeInteger(event.tsEpochMs) || event.tsEpochMs < 0) {
    throw new RangeError('tsEpochMs must be a non-negative safe integer')
  }
  if (event.actorId.length === 0 || event.action.length === 0) {
    throw new RangeError('actorId and action must be non-empty')
  }
  assertEventFieldsControlFree(event)
}
