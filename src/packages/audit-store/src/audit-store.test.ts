import { describe, expect, it } from 'vitest'

import {
  canonicalEventJson,
  GENESIS_PREV_HASH,
  type AuditEvent,
  type EntryHashFn
} from '@shield/access/audit-chain'

import { isPostgresUniqueViolation, PostgresAuditSink, type PgResultLike } from './audit-store'

const INSERT_SQL_PREFIX = 'INSERT INTO audit_events'
const HEAD_SQL_PREFIX = 'SELECT entry_hash FROM audit_events'

const baseEvent: AuditEvent = {
  tsEpochMs: 1_700_000_000_000,
  actorKind: 'tentacle',
  actorId: 'armory',
  action: 'armory.run',
  resourceKind: 'armory-tool',
  resourceId: 'nmap',
  traceId: null,
  payload: { exitCode: 0, targets: ['127.0.0.1'], timedOut: false }
}

/** Deterministic 64-hex chain: each output depends on the previous hash it received. */
const fakeHashFn: EntryHashFn = (previousHash, canonicalJson) => {
  const input = `${previousHash}~${canonicalJson}`
  let out = ''
  for (let index = 0; index < 64; index = index + 1) {
    out += ((input.charCodeAt(index % input.length) + index) % 16).toString(16)
  }
  return out
}

type RecordedQuery = { text: string; values?: readonly unknown[] }

class FakePgClient {
  readonly queries: RecordedQuery[] = []
  /** null = empty ledger (no head row yet). */
  private head: string | null = null
  private uniqueViolationsLeft = 0

  armUniqueViolationOnce(): void {
    this.uniqueViolationsLeft = 1
  }

  setHead(hash: string): void {
    this.head = hash
  }

  inserts(): RecordedQuery[] {
    return this.queries.filter((query) => query.text.startsWith(INSERT_SQL_PREFIX))
  }

  async query(text: string, values?: readonly unknown[]): Promise<PgResultLike> {
    this.queries.push({ text, values })
    if (text.startsWith(HEAD_SQL_PREFIX)) {
      return this.head === null
        ? { rowCount: 0, rows: [] }
        : { rowCount: 1, rows: [{ entry_hash: this.head }] }
    }
    if (this.uniqueViolationsLeft > 0) {
      this.uniqueViolationsLeft = this.uniqueViolationsLeft - 1
      // A concurrent writer won the prev_hash slot; the retry's re-read must see its hash.
      this.head = 'b'.repeat(64)
      throw Object.assign(new Error('duplicate key value violates unique constraint'), {
        code: '23505'
      })
    }
    this.head = String(values?.[9])
    return { rowCount: 1, rows: [] }
  }
}

describe('PostgresAuditSink', () => {
  it('inserts parameterized values matching the audit.sql columns after reading the head', async () => {
    const client = new FakePgClient()
    client.setHead('a'.repeat(64))
    const sink = new PostgresAuditSink(client)

    const entry = await sink.append(baseEvent, fakeHashFn)

    expect(client.queries[0]?.text.startsWith(HEAD_SQL_PREFIX)).toBe(true)
    const insert = client.inserts()[0]
    expect(insert?.text).toContain(
      '(ts, actor_kind, actor_id, action, resource_kind, resource_id, trace_id, payload, prev_hash, entry_hash)'
    )
    expect(insert?.values).toEqual([
      new Date(baseEvent.tsEpochMs),
      'tentacle',
      'armory',
      'armory.run',
      'armory-tool',
      'nmap',
      null,
      '{"exitCode":0,"targets":["127.0.0.1"],"timedOut":false}',
      'a'.repeat(64),
      fakeHashFn('a'.repeat(64), canonicalEventJson(baseEvent))
    ])
    expect(entry.prevHash).toBe('a'.repeat(64))
    expect(entry.entryHash).toBe(fakeHashFn('a'.repeat(64), canonicalEventJson(baseEvent)))
  })

  it('falls back to the all-zero genesis prev hash on an empty ledger', async () => {
    const client = new FakePgClient()
    const sink = new PostgresAuditSink(client)

    const entry = await sink.append(baseEvent, fakeHashFn)

    expect(entry.prevHash).toBe(GENESIS_PREV_HASH)
    expect(client.inserts()[0]?.values?.[8]).toBe(GENESIS_PREV_HASH)
  })

  it('re-reads the head and retries once when the prev_hash race raises 23505', async () => {
    const client = new FakePgClient()
    client.setHead('a'.repeat(64))
    client.armUniqueViolationOnce()
    const sink = new PostgresAuditSink(client)

    const entry = await sink.append(baseEvent, fakeHashFn)

    expect(client.inserts()).toHaveLength(2)
    // The retry chains onto the winner's hash, not the stale one.
    expect(entry.prevHash).toBe('b'.repeat(64))
    expect(entry.entryHash).toBe(fakeHashFn('b'.repeat(64), canonicalEventJson(baseEvent)))
    expect(client.inserts()[0]?.values?.[8]).toBe('a'.repeat(64))
    expect(client.inserts()[1]?.values?.[8]).toBe('b'.repeat(64))
  })

  it('propagates a unique violation that persists through the single retry', async () => {
    class AlwaysViolateClient extends FakePgClient {
      override async query(text: string, values?: readonly unknown[]): Promise<PgResultLike> {
        if (text.startsWith(INSERT_SQL_PREFIX)) {
          this.queries.push({ text, values })
          throw Object.assign(new Error('duplicate key value violates unique constraint'), {
            code: '23505'
          })
        }
        return super.query(text, values)
      }
    }
    const hostile = new AlwaysViolateClient()

    await expect(new PostgresAuditSink(hostile).append(baseEvent, fakeHashFn)).rejects.toThrow(
      /duplicate key/
    )
    expect(hostile.inserts()).toHaveLength(2)
  })

  it('classifies postgres unique violations by error code', () => {
    expect(isPostgresUniqueViolation(Object.assign(new Error('x'), { code: '23505' }))).toBe(true)
    expect(isPostgresUniqueViolation(new Error('x'))).toBe(false)
    expect(isPostgresUniqueViolation(Object.assign(new Error('x'), { code: '23503' }))).toBe(false)
  })

  it('chains flush batches sequentially onto each appended head', async () => {
    const client = new FakePgClient()
    const sink = new PostgresAuditSink(client)

    const entries = await sink.flush(
      [baseEvent, { ...baseEvent, resourceId: 'nucleus' }],
      fakeHashFn
    )

    expect(entries).toHaveLength(2)
    expect(entries[1]?.prevHash).toBe(entries[0]?.entryHash)
  })
})
