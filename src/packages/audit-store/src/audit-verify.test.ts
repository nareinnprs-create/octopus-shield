import { randomUUID } from 'node:crypto'

import { describe, expect, it, vi } from 'vitest'

import {
  AuditChain,
  GENESIS_PREV_HASH,
  type AuditEvent,
  type LedgerEntry
} from '@shield/access/audit-chain'
import { sha256EntryHashFn } from '@shield/access/audit-chain-sha256'

import {
  AUDIT_VERIFY_DEFAULT_LIMIT,
  AUDIT_VERIFY_SELECT_SQL,
  pinpointChainBreak,
  rebuildLedgerEntries,
  verifyPersistedChain,
  type PersistedAuditRow,
  type PersistedChainBreak,
  type VerifyClientLike,
  type VerifyResultLike
} from './audit-verify'
import {
  AUDIT_VERIFY_EXIT_BROKEN,
  AUDIT_VERIFY_EXIT_EMPTY,
  AUDIT_VERIFY_EXIT_VERIFIED,
  auditVerifyVerdictLines,
  parseAuditVerifyArgs,
  runAuditVerifyCli
} from './audit-verify-cli'
import { AUDIT_WATCH_BATCH_LIMIT, watchAudit, type AuditWatchAppend } from './audit-watch'

/** Client surface the CLI's createClient seam provides (query + close). */
type CliVerifyClient = VerifyClientLike & { close(): Promise<void> }

/** Deterministic in-memory audit_events: query routing mirrors the production SQL shapes. */
class FakeAuditLedger implements CliVerifyClient {
  readonly rows: PersistedAuditRow[] = []
  readonly queries: { text: string; values?: readonly unknown[] }[] = []

  async query(text: string, values?: readonly unknown[]): Promise<VerifyResultLike> {
    this.queries.push({ text, values })
    if (text.includes('ORDER BY ts DESC')) {
      const sorted = this.sorted()
      const tail = sorted.at(-1)
      return tail === undefined ? { rowCount: 0, rows: [] } : { rowCount: 1, rows: [tail] }
    }
    if (text.includes('(ts, id) >')) {
      const tsValue = values?.[0]
      const idValue = values?.[1]
      const cursorTs = tsValue instanceof Date ? tsValue.getTime() : null
      const cursorId = typeof idValue === 'string' ? idValue : null
      const after = this.sorted().filter((row) => {
        if (cursorTs === null || cursorId === null) {
          return true
        }
        const rowTs = Number(row.ts_epoch_ms)
        return rowTs > cursorTs || (rowTs === cursorTs && row.id > cursorId)
      })
      const batch = after.slice(0, AUDIT_WATCH_BATCH_LIMIT)
      return { rowCount: batch.length, rows: batch }
    }
    const limit = Number(values?.[0])
    const batch = this.sorted().slice(0, limit)
    return { rowCount: batch.length, rows: batch }
  }

  async close(): Promise<void> {}

  private sorted(): PersistedAuditRow[] {
    return [...this.rows].sort(
      (a, b) =>
        Number(a.ts_epoch_ms) - Number(b.ts_epoch_ms) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    )
  }
}

const baseEvent: AuditEvent = {
  tsEpochMs: 1_700_000_000_000,
  actorKind: 'tentacle',
  actorId: 'audit-verify-test',
  action: 'test.event',
  resourceKind: 'test-resource',
  resourceId: 'row-0',
  traceId: null,
  payload: { index: 0, secretMarker: 'payload-body-never-printed' }
}

function rowFromEntry(entry: LedgerEntry): PersistedAuditRow {
  return {
    id: randomUUID(),
    ts_epoch_ms: entry.tsEpochMs,
    prev_hash: entry.prevHash,
    entry_hash: entry.entryHash,
    actor_kind: entry.actorKind,
    actor_id: entry.actorId,
    action: entry.action,
    resource_kind: entry.resourceKind,
    resource_id: entry.resourceId,
    trace_id: entry.traceId,
    payload: entry.payload
  }
}

/** Builds `count` chained rows exactly the way PostgresAuditSink would commit them. */
function ledgerRows(count: number): PersistedAuditRow[] {
  const chain = AuditChain.genesis(sha256EntryHashFn)
  const rows: PersistedAuditRow[] = []
  for (let index = 0; index < count; index = index + 1) {
    const entry = chain.append({
      ...baseEvent,
      tsEpochMs: baseEvent.tsEpochMs + index * 1_000,
      resourceId: `row-${index}`,
      traceId: index % 2 === 0 ? null : `trace-${index}`,
      payload: { index, secretMarker: 'payload-body-never-printed' }
    })
    rows.push(rowFromEntry(entry))
  }
  return rows
}

function ledgerWith(count: number): FakeAuditLedger {
  const ledger = new FakeAuditLedger()
  ledger.rows.push(...ledgerRows(count))
  return ledger
}

describe('verifyPersistedChain', () => {
  it('verifies an intact persisted chain including genesis', async () => {
    const ledger = ledgerWith(3)

    const result = await verifyPersistedChain(ledger, sha256EntryHashFn)

    expect(result).toEqual({
      ok: true,
      checked: 3,
      genesisPresent: true,
      tailEntryHash: ledger.rows[2].entry_hash,
      firstBroken: null
    })
    expect(ledger.queries[0]?.text).toBe(AUDIT_VERIFY_SELECT_SQL)
    expect(ledger.queries[0]?.values).toEqual([AUDIT_VERIFY_DEFAULT_LIMIT])
  })

  it('detects a tampered payload at the exact index with both hashes', async () => {
    const ledger = ledgerWith(4)
    const tampered = ledger.rows[2]
    tampered.payload = { index: 2, secretMarker: 'payload-body-never-printed', tampered: true }

    const result = await verifyPersistedChain(ledger, sha256EntryHashFn)

    expect(result.ok).toBe(false)
    expect(result.checked).toBe(2)
    expect(result.tailEntryHash).toBeNull()
    expect(result.firstBroken).toMatchObject({
      index: 2,
      id: tampered.id,
      kind: 'entry_hash_mismatch',
      storedPrevHash: ledger.rows[1].entry_hash,
      storedEntryHash: tampered.entry_hash
    })
    expect(result.firstBroken?.expectedEntryHash).toMatch(/^[0-9a-f]{64}$/)
    expect(result.firstBroken?.expectedEntryHash).not.toBe(tampered.entry_hash)
  })

  it('rejects a first row that does not chain from genesis', async () => {
    const ledger = ledgerWith(2)
    ledger.rows[0].prev_hash = 'a'.repeat(64)

    const result = await verifyPersistedChain(ledger, sha256EntryHashFn)

    expect(result.ok).toBe(false)
    expect(result.genesisPresent).toBe(false)
    expect(result.firstBroken).toMatchObject({
      index: 0,
      kind: 'prev_hash_mismatch',
      expectedPrevHash: GENESIS_PREV_HASH,
      storedPrevHash: 'a'.repeat(64)
    })
  })

  it('treats a NULL prev_hash row as unverified at its index', async () => {
    const ledger = ledgerWith(3)
    ledger.rows[1].prev_hash = null

    const result = await verifyPersistedChain(ledger, sha256EntryHashFn)

    expect(result.ok).toBe(false)
    expect(result.checked).toBe(1)
    expect(result.firstBroken).toMatchObject({
      index: 1,
      id: ledger.rows[1].id,
      kind: 'prev_hash_null',
      expectedPrevHash: ledger.rows[0].entry_hash
    })
  })

  it('returns an empty verification for an empty table', async () => {
    const result = await verifyPersistedChain(new FakeAuditLedger(), sha256EntryHashFn)

    expect(result).toEqual({
      ok: true,
      checked: 0,
      genesisPresent: false,
      tailEntryHash: null,
      firstBroken: null
    })
  })

  it('only verifies the oldest `limit` rows', async () => {
    const ledger = ledgerWith(3)
    ledger.rows[2].payload = { tampered: true }

    const result = await verifyPersistedChain(ledger, sha256EntryHashFn, { limit: 2 })

    expect(result.ok).toBe(true)
    expect(result.checked).toBe(2)
  })

  it('rejects a non-positive limit', async () => {
    await expect(
      verifyPersistedChain(ledgerWith(1), sha256EntryHashFn, { limit: 0 })
    ).rejects.toThrow(RangeError)
  })
})

describe('pinpointChainBreak', () => {
  it('returns null for an intact rebuilt ledger', () => {
    const entries = rebuildLedgerEntries(ledgerRows(3))

    expect(pinpointChainBreak(entries, sha256EntryHashFn)).toBeNull()
  })

  it('pinpoints the FIRST divergence with stored and expected hashes', () => {
    const rows = ledgerRows(4)
    rows[2].entry_hash = '0'.repeat(64)
    const entries = rebuildLedgerEntries(rows)

    const brk: PersistedChainBreak | null = pinpointChainBreak(entries, sha256EntryHashFn)

    expect(brk).toMatchObject({
      index: 2,
      kind: 'entry_hash_mismatch',
      storedEntryHash: '0'.repeat(64)
    })
    expect(brk?.expectedEntryHash).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('audit-verify CLI', () => {
  const capture = () => {
    const out: string[] = []
    const err: string[] = []
    return {
      out,
      err,
      outFn: (line: string) => out.push(line),
      errFn: (line: string) => err.push(line)
    }
  }

  it('maps empty ledger to the exit-2 path', async () => {
    const captured = capture()

    const code = await runAuditVerifyCli({
      argv: [],
      out: captured.outFn,
      err: captured.errFn,
      createClient: () => new FakeAuditLedger()
    })

    expect(code).toBe(AUDIT_VERIFY_EXIT_EMPTY)
    expect(captured.out.join('\n')).toContain('EMPTY LEDGER')
  })

  it('exits 0 with a verdict block when the chain verifies', async () => {
    const captured = capture()

    const code = await runAuditVerifyCli({
      argv: ['--limit', '2'],
      out: captured.outFn,
      err: captured.errFn,
      createClient: () => ledgerWith(3)
    })

    expect(code).toBe(AUDIT_VERIFY_EXIT_VERIFIED)
    const text = captured.out.join('\n')
    expect(text).toContain('rows checked: 2 (limit 2)')
    expect(text).toContain('genesis present: yes')
    expect(text).toContain('chain OK')
  })

  it('exits 1 on a break and never prints payload contents', async () => {
    const ledger = ledgerWith(4)
    ledger.rows[2].payload = {
      index: 2,
      secretMarker: 'payload-body-never-printed',
      tampered: true
    }
    const captured = capture()

    const code = await runAuditVerifyCli({
      argv: [],
      out: captured.outFn,
      err: captured.errFn,
      createClient: () => ledger
    })

    expect(code).toBe(AUDIT_VERIFY_EXIT_BROKEN)
    const text = captured.out.join('\n')
    expect(text).toContain(`CHAIN BREAK at index 2 (id ${ledger.rows[2].id})`)
    expect(text).toContain('recomputed expected:')
    expect(text).not.toContain('payload-body-never-printed')
    expect(text).not.toContain('"index"')
  })

  it('emits machine-readable json with --json', async () => {
    const captured = capture()

    const code = await runAuditVerifyCli({
      argv: ['--json', '--limit=5'],
      out: captured.outFn,
      err: captured.errFn,
      createClient: () => ledgerWith(2)
    })

    expect(code).toBe(AUDIT_VERIFY_EXIT_VERIFIED)
    const parsed: unknown = JSON.parse(captured.out.join('\n'))
    expect(parsed).toMatchObject({ ok: true, checked: 2 })
  })

  it('prints usage and exits 2 on unknown flags', async () => {
    const captured = capture()

    const code = await runAuditVerifyCli({
      argv: ['--wat'],
      out: captured.outFn,
      err: captured.errFn,
      createClient: () => new FakeAuditLedger()
    })

    expect(code).toBe(2)
    expect(captured.err.join('\n')).toContain('usage: audit-verify')
  })

  it('exits 1 when the password file cannot be read', async () => {
    const captured = capture()
    const previous = process.env.OSHIELD_NUCLEUS_PG_PASSWORD_FILE
    process.env.OSHIELD_NUCLEUS_PG_PASSWORD_FILE = 'Z:/definitely/not/a/real/path'
    try {
      const code = await runAuditVerifyCli({
        argv: [],
        out: captured.outFn,
        err: captured.errFn
      })
      expect(code).toBe(AUDIT_VERIFY_EXIT_BROKEN)
      expect(captured.err.join('\n')).toContain('cannot read nucleus pg password file')
    } finally {
      if (previous === undefined) {
        delete process.env.OSHIELD_NUCLEUS_PG_PASSWORD_FILE
      } else {
        process.env.OSHIELD_NUCLEUS_PG_PASSWORD_FILE = previous
      }
    }
  })

  it('parses --limit forms and rejects bad values', () => {
    expect(parseAuditVerifyArgs([])).toEqual({ limit: 1000, json: false })
    expect(parseAuditVerifyArgs(['--limit', '50', '--json'])).toEqual({ limit: 50, json: true })
    expect(parseAuditVerifyArgs(['--limit=9'])).toEqual({ limit: 9, json: false })
    expect(parseAuditVerifyArgs(['--limit', '0'])).toBeNull()
    expect(parseAuditVerifyArgs(['--limit', 'abc'])).toBeNull()
    expect(parseAuditVerifyArgs(['extra'])).toBeNull()
  })

  it('renders verdict lines for every outcome', () => {
    const ok = auditVerifyVerdictLines(
      {
        ok: true,
        checked: 6,
        genesisPresent: true,
        tailEntryHash: 'b'.repeat(64),
        firstBroken: null
      },
      1000
    )
    expect(ok.at(-1)).toContain(
      'chain OK — 6 entries verified, tail bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
    )

    const empty = auditVerifyVerdictLines(
      { ok: true, checked: 0, genesisPresent: false, tailEntryHash: null, firstBroken: null },
      1000
    )
    expect(empty.at(-1)).toContain('EMPTY LEDGER')

    const broken = auditVerifyVerdictLines(
      {
        ok: false,
        checked: 2,
        genesisPresent: true,
        tailEntryHash: null,
        firstBroken: {
          index: 1,
          id: 'row-id',
          kind: 'prev_hash_mismatch',
          reason: 'prev_hash does not chain onto the preceding entry_hash',
          storedPrevHash: 'a'.repeat(64),
          expectedPrevHash: 'c'.repeat(64),
          storedEntryHash: 'd'.repeat(64),
          expectedEntryHash: null
        }
      },
      1000
    )
    expect(broken.join('\n')).toContain('CHAIN BREAK at index 1 (id row-id)')
    expect(broken.join('\n')).toContain(`expected prev_hash: ${'c'.repeat(64)}`)
  })
})

describe('watchAudit', () => {
  it('emits append for rows landing after the anchor', async () => {
    const ledger = ledgerWith(1)
    const appends: AuditWatchAppend[] = []
    const watch = watchAudit(ledger, sha256EntryHashFn, { pollMs: 10 })
    watch.on('append', (info) => appends.push(info))
    await watch.ready

    const tail = ledger.rows[0]
    const chain = AuditChain.resume(sha256EntryHashFn, tail.entry_hash)
    const entry = chain.append({
      ...baseEvent,
      tsEpochMs: baseEvent.tsEpochMs + 5_000,
      resourceId: 'row-new'
    })
    ledger.rows.push(rowFromEntry(entry))

    await vi.waitFor(() => expect(appends).toHaveLength(1))
    expect(appends[0]).toMatchObject({ index: 0, id: ledger.rows[1].id })
    expect(appends[0].entry.entryHash).toBe(entry.entryHash)
    expect(appends[0].entry.prevHash).toBe(tail.entry_hash)
    watch.stop()
  })

  it('emits break with hashes and stops polling after a broken link', async () => {
    const ledger = ledgerWith(1)
    const appends: AuditWatchAppend[] = []
    const breaks: PersistedChainBreak[] = []
    const watch = watchAudit(ledger, sha256EntryHashFn, { pollMs: 10 })
    watch.on('append', (info) => appends.push(info))
    watch.on('break', (info) => breaks.push(info))
    await watch.ready

    const chain = AuditChain.resume(sha256EntryHashFn, ledger.rows[0].entry_hash)
    const forgedEntry = chain.append({ ...baseEvent, tsEpochMs: baseEvent.tsEpochMs + 6_000 })
    const forged = rowFromEntry({ ...forgedEntry, prevHash: 'f'.repeat(64) })
    ledger.rows.push(forged)
    await vi.waitFor(() => expect(breaks).toHaveLength(1))
    expect(breaks[0]).toMatchObject({
      index: 0,
      id: forged.id,
      kind: 'prev_hash_mismatch',
      storedPrevHash: 'f'.repeat(64),
      expectedPrevHash: ledger.rows[0].entry_hash
    })

    // The watch halted on the break: a later well-chained row emits nothing.
    const tailChain = AuditChain.resume(sha256EntryHashFn, forged.entry_hash)
    ledger.rows.push(
      rowFromEntry(tailChain.append({ ...baseEvent, tsEpochMs: baseEvent.tsEpochMs + 9_000 }))
    )
    await new Promise((resolveSleep) => setTimeout(resolveSleep, 60))
    expect(appends).toHaveLength(0)
    expect(breaks).toHaveLength(1)
  })

  it('anchors on an empty ledger and verifies the genesis append', async () => {
    const ledger = new FakeAuditLedger()
    const appends: AuditWatchAppend[] = []
    const breaks: PersistedChainBreak[] = []
    const watch = watchAudit(ledger, sha256EntryHashFn, { pollMs: 10 })
    watch.on('append', (info) => appends.push(info))
    watch.on('break', (info) => breaks.push(info))
    await watch.ready

    const chain = AuditChain.genesis(sha256EntryHashFn)
    const genesisRow = rowFromEntry(chain.append({ ...baseEvent }))
    ledger.rows.push(genesisRow)

    await vi.waitFor(() => expect(appends).toHaveLength(1))
    expect(appends[0].entry.prevHash).toBe(GENESIS_PREV_HASH)
    expect(breaks).toHaveLength(0)
    watch.stop()
  })
})
