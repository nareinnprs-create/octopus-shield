import {
  canonicalEventJson,
  GENESIS_PREV_HASH,
  verifyLedger,
  type EntryHashFn,
  type LedgerEntry
} from '@shield/access/audit-chain'

/** Structural read surface for chain verification; pg Client and test fakes both satisfy it. */
export type VerifyClientLike = {
  query(text: string, values?: readonly unknown[]): Promise<VerifyResultLike>
}

export type VerifyResultLike = {
  rowCount: number | null
  rows: PersistedAuditRow[]
}

/** audit_events row as read back: jsonb payload parsed, ts reduced to exact integer milliseconds. */
export type PersistedAuditRow = {
  id: string
  ts_epoch_ms: string | number
  prev_hash: string | null
  entry_hash: string
  actor_kind: string
  actor_id: string
  action: string
  resource_kind: string
  resource_id: string
  trace_id: string | null
  payload: unknown
}

export const AUDIT_VERIFY_DEFAULT_LIMIT = 1000

/** Mirrors the audit_events actor_kind CHECK (infra/db/audit.sql) = @shield/access PRINCIPAL_KINDS; kept local for a checked, cast-free rebuild. */
const AUDIT_EVENT_ACTOR_KINDS = ['human', 'tentacle', 'sucker', 'engine'] as const

/**
 * Ledger-order scan. floor(extract(epoch ...)*1000) round-trips the integer-ms
 * ts the writer hashed (node-pg Date would truncate the same way, but this
 * keeps the value exact through pg's bigint-string path).
 */
export const AUDIT_VERIFY_SELECT_SQL =
  'SELECT id, floor(extract(epoch from ts) * 1000)::bigint AS ts_epoch_ms, prev_hash, entry_hash, actor_kind, actor_id, action, resource_kind, resource_id, trace_id, payload FROM audit_events ORDER BY ts, id LIMIT $1'

export type PersistedChainBreakKind =
  | 'malformed_row'
  | 'prev_hash_null'
  | 'prev_hash_mismatch'
  | 'entry_hash_mismatch'

export type PersistedChainBreak = {
  index: number
  id: string | null
  kind: PersistedChainBreakKind
  reason: string
  storedPrevHash: string | null
  expectedPrevHash: string | null
  storedEntryHash: string | null
  expectedEntryHash: string | null
}

export type PersistedChainVerification = {
  ok: boolean
  checked: number
  genesisPresent: boolean
  tailEntryHash: string | null
  firstBroken: PersistedChainBreak | null
}

export type VerifyPersistedChainOptions = {
  /** Max ledger rows to scan; oldest (ts, id) first. */
  limit?: number
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Rebuilds one persisted row into a LedgerEntry; throws RangeError on a row the chain can never re-verify. */
export function rebuildLedgerEntry(row: PersistedAuditRow): LedgerEntry {
  const tsEpochMs = Number(row.ts_epoch_ms)
  if (!Number.isSafeInteger(tsEpochMs) || tsEpochMs < 0) {
    throw new RangeError(`row ${row.id} has a malformed ts`)
  }
  const actorKind = AUDIT_EVENT_ACTOR_KINDS.find((kind) => kind === row.actor_kind)
  if (actorKind === undefined) {
    throw new RangeError(`row ${row.id} has an unknown actor_kind`)
  }
  return {
    tsEpochMs,
    actorKind,
    actorId: row.actor_id,
    action: row.action,
    resourceKind: row.resource_kind,
    resourceId: row.resource_id,
    traceId: row.trace_id,
    payload: row.payload,
    // SAFETY: '' is a never-valid sentinel for NULL prev_hash so verifyLedger flags the row; the raw null is classified upstream.
    prevHash: row.prev_hash ?? '',
    entryHash: row.entry_hash
  }
}

export function rebuildLedgerEntries(rows: readonly PersistedAuditRow[]): LedgerEntry[] {
  return rows.map((row) => rebuildLedgerEntry(row))
}

/** Verifies one chain link against the expected prev hash; returns the divergence with both hashes, or null. */
export function chainStepBreak(
  index: number,
  entry: LedgerEntry,
  expectedPrevHash: string,
  hashFn: EntryHashFn
): PersistedChainBreak | null {
  if (entry.prevHash !== expectedPrevHash) {
    return {
      index,
      id: null,
      kind: 'prev_hash_mismatch',
      reason: 'prev_hash does not chain onto the preceding entry_hash',
      storedPrevHash: entry.prevHash,
      expectedPrevHash,
      storedEntryHash: entry.entryHash,
      expectedEntryHash: null
    }
  }
  const expectedEntryHash = hashFn(entry.prevHash, canonicalEventJson(entry))
  if (expectedEntryHash !== entry.entryHash) {
    return {
      index,
      id: null,
      kind: 'entry_hash_mismatch',
      reason: 'entry_hash does not match the recomputed canonical hash',
      storedPrevHash: entry.prevHash,
      expectedPrevHash,
      storedEntryHash: entry.entryHash,
      expectedEntryHash
    }
  }
  return null
}

/**
 * Tamper test helper: recomputes each entry hash from genesis and pinpoints
 * the FIRST divergence (index + stored vs expected hashes), or null.
 */
export function pinpointChainBreak(
  entries: readonly LedgerEntry[],
  hashFn: EntryHashFn
): PersistedChainBreak | null {
  let prevHash = GENESIS_PREV_HASH
  for (let index = 0; index < entries.length; index = index + 1) {
    const entry = entries[index]
    const step = chainStepBreak(index, entry, prevHash, hashFn)
    if (step !== null) {
      return step
    }
    prevHash = entry.entryHash
  }
  return null
}

function persistedRowBreak(
  row: PersistedAuditRow,
  index: number,
  expectedPrevHash: string,
  hashFn: EntryHashFn
): PersistedChainBreak | null {
  let entry: LedgerEntry
  try {
    entry = rebuildLedgerEntry(row)
  } catch (error) {
    return {
      index,
      id: row.id,
      kind: 'malformed_row',
      reason: `row cannot be rebuilt as a ledger entry: ${errorMessage(error)}`,
      storedPrevHash: row.prev_hash,
      expectedPrevHash: null,
      storedEntryHash: row.entry_hash,
      expectedEntryHash: null
    }
  }
  if (row.prev_hash === null) {
    return {
      index,
      id: row.id,
      kind: 'prev_hash_null',
      reason: 'prev_hash is NULL (imported row without chain context; treat as unverified)',
      storedPrevHash: null,
      expectedPrevHash,
      storedEntryHash: row.entry_hash,
      expectedEntryHash: null
    }
  }
  const step = chainStepBreak(index, entry, expectedPrevHash, hashFn)
  return step === null ? step : { ...step, id: row.id }
}

/**
 * Reads the persisted ledger in (ts, id) order, rebuilds LedgerEntry[] and
 * verifies with @shield/access verifyLedger. On break, pinpoints the FIRST
 * divergence with both hashes. Never returns payload contents.
 */
export async function verifyPersistedChain(
  clientLike: VerifyClientLike,
  hashFn: EntryHashFn,
  options?: VerifyPersistedChainOptions
): Promise<PersistedChainVerification> {
  const limit = options?.limit ?? AUDIT_VERIFY_DEFAULT_LIMIT
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new RangeError('limit must be a positive integer')
  }
  const result = await clientLike.query(AUDIT_VERIFY_SELECT_SQL, [limit])
  const rows = result.rows

  const entries: LedgerEntry[] = []
  let malformedIndex = -1
  let malformedError: unknown = null
  for (let index = 0; index < rows.length; index = index + 1) {
    try {
      entries.push(rebuildLedgerEntry(rows[index]))
    } catch (error) {
      malformedIndex = index
      malformedError = error
      break
    }
  }

  const ledger = verifyLedger(entries, hashFn)
  let firstBroken: PersistedChainBreak | null = null
  if (malformedIndex !== -1) {
    const row = rows[malformedIndex]
    firstBroken = {
      index: malformedIndex,
      id: row.id,
      kind: 'malformed_row',
      reason: `row cannot be rebuilt as a ledger entry: ${errorMessage(malformedError)}`,
      storedPrevHash: row.prev_hash,
      expectedPrevHash: null,
      storedEntryHash: row.entry_hash,
      expectedEntryHash: null
    }
  } else if (!ledger.ok && ledger.brokenIndex !== null) {
    const index = ledger.brokenIndex
    const expectedPrevHash = index === 0 ? GENESIS_PREV_HASH : entries[index - 1].entryHash
    firstBroken = persistedRowBreak(rows[index], index, expectedPrevHash, hashFn)
  }

  return {
    ok: firstBroken === null,
    checked: firstBroken === null ? entries.length : firstBroken.index,
    genesisPresent: entries.length > 0 && entries[0].prevHash === GENESIS_PREV_HASH,
    tailEntryHash:
      firstBroken === null && entries.length > 0 ? (entries.at(-1)?.entryHash ?? null) : null,
    firstBroken
  }
}
