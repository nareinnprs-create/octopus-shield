import { GENESIS_PREV_HASH, type EntryHashFn, type LedgerEntry } from '@shield/access/audit-chain'

import {
  chainStepBreak,
  rebuildLedgerEntry,
  type PersistedAuditRow,
  type PersistedChainBreak,
  type VerifyClientLike
} from './audit-verify'

export const AUDIT_WATCH_DEFAULT_POLL_MS = 1_000
export const AUDIT_WATCH_BATCH_LIMIT = 500

export const AUDIT_WATCH_TAIL_SQL =
  'SELECT id, floor(extract(epoch from ts) * 1000)::bigint AS ts_epoch_ms, prev_hash, entry_hash, actor_kind, actor_id, action, resource_kind, resource_id, trace_id, payload FROM audit_events ORDER BY ts DESC, id DESC LIMIT 1'

/**
 * Incremental scan after the last seen (ts, id) cursor. id alone is a random
 * uuid and never monotonic, so the cursor is the ledger-order pair.
 */
export const AUDIT_WATCH_POLL_SQL = `SELECT id, floor(extract(epoch from ts) * 1000)::bigint AS ts_epoch_ms, prev_hash, entry_hash, actor_kind, actor_id, action, resource_kind, resource_id, trace_id, payload FROM audit_events WHERE ($1::timestamptz IS NULL OR (ts, id) > ($1::timestamptz, $2::uuid)) ORDER BY ts, id LIMIT ${AUDIT_WATCH_BATCH_LIMIT}`

export type AuditWatchAppend = {
  /** Position in the watched sequence (0 = first row after the anchor). */
  index: number
  id: string
  entry: LedgerEntry
}

export type AuditWatchBreak = PersistedChainBreak

export type AuditWatchListeners = {
  append: AuditWatchAppend
  break: AuditWatchBreak
  error: unknown
}

export type AuditWatchOptions = {
  pollMs?: number
}

export type AuditWatch = {
  on<K extends keyof AuditWatchListeners>(
    event: K,
    listener: (info: AuditWatchListeners[K]) => void
  ): AuditWatch
  /** Resolves once the baseline tail anchor is set; rows present before it are baseline, not events. */
  readonly ready: Promise<void>
  stop(): void
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Incrementally verifies new rows against the anchored tail hash (trust at
 * start, verify forward; full-prefix verification is audit-verify's job).
 * First break halts polling: later rows cannot verify past a broken link.
 */
export function watchAudit(
  clientLike: VerifyClientLike,
  hashFn: EntryHashFn,
  options?: AuditWatchOptions
): AuditWatch {
  const pollMs = options?.pollMs ?? AUDIT_WATCH_DEFAULT_POLL_MS
  if (!Number.isSafeInteger(pollMs) || pollMs < 1) {
    throw new RangeError('pollMs must be a positive integer')
  }
  const listeners: {
    [K in keyof AuditWatchListeners]: ((info: AuditWatchListeners[K]) => void)[]
  } = { append: [], break: [], error: [] }
  let stopped = false
  let timer: NodeJS.Timeout | null = null
  let cursor: { tsEpochMs: number; id: string } | null = null
  let prevHash = GENESIS_PREV_HASH
  let appended = 0

  const emit = <K extends keyof AuditWatchListeners>(
    event: K,
    info: AuditWatchListeners[K]
  ): void => {
    for (const listener of listeners[event]) {
      listener(info)
    }
  }
  const clearTimer = (): void => {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }
  const haltOnBreak = (brk: AuditWatchBreak): void => {
    stopped = true
    clearTimer()
    emit('break', brk)
  }
  const pollTick = async (): Promise<void> => {
    if (stopped) {
      return
    }
    try {
      for (;;) {
        if (stopped) {
          return
        }
        const result = await clientLike.query(
          AUDIT_WATCH_POLL_SQL,
          cursor === null ? [null, null] : [new Date(cursor.tsEpochMs), cursor.id]
        )
        for (let index = 0; index < result.rows.length; index = index + 1) {
          const row = result.rows[index]
          const expectedPrevHash = prevHash
          const rowBreak = watchRowBreak(row, appended, expectedPrevHash, hashFn)
          if (rowBreak !== null) {
            haltOnBreak(rowBreak)
            return
          }
          const entry = rebuildLedgerEntry(row)
          prevHash = entry.entryHash
          cursor = { tsEpochMs: entry.tsEpochMs, id: row.id }
          appended += 1
          emit('append', { index: appended - 1, id: row.id, entry })
        }
        if (result.rows.length < AUDIT_WATCH_BATCH_LIMIT) {
          break
        }
      }
    } catch (error) {
      // Transient poll failure: surface and keep watching.
      emit('error', error)
    }
    schedule()
  }
  const schedule = (): void => {
    if (stopped) {
      return
    }
    timer = setTimeout(() => {
      void pollTick()
    }, pollMs)
  }

  const ready: Promise<void> = clientLike
    .query(AUDIT_WATCH_TAIL_SQL)
    .then((result) => {
      const tail = result.rows[0]
      if (tail !== undefined) {
        const tsEpochMs = Number(tail.ts_epoch_ms)
        if (!Number.isSafeInteger(tsEpochMs) || tsEpochMs < 0) {
          throw new RangeError(`audit_events tail row ${tail.id} has a malformed ts`)
        }
        cursor = { tsEpochMs, id: tail.id }
        prevHash = tail.entry_hash
      }
    })
    .then(() => {
      schedule()
    })
    .catch((error: unknown) => {
      stopped = true
      clearTimer()
      emit('error', error)
    })

  const watch: AuditWatch = {
    on: (event, listener) => {
      listeners[event].push(listener)
      return watch
    },
    ready,
    stop: () => {
      stopped = true
      clearTimer()
    }
  }
  return watch
}

function watchRowBreak(
  row: PersistedAuditRow,
  index: number,
  expectedPrevHash: string,
  hashFn: EntryHashFn
): AuditWatchBreak | null {
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
  return step === null ? null : { ...step, id: row.id }
}
