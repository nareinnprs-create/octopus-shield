import { describe, expect, it } from 'vitest'

import {
  AUDIT_HASH_DOMAIN,
  AUDIT_HASH_FIELD_SEPARATOR,
  GENESIS_PREV_HASH,
  AuditChain,
  assertEventFieldsControlFree,
  canonicalEventJson,
  isHashHex,
  stableJson,
  verifyLedger,
  type AuditEvent,
  type LedgerEntry
} from './audit-chain'
import { sha256EntryHashFn } from './audit-chain-sha256'

const event = (overrides: Partial<AuditEvent> = {}): AuditEvent => ({
  tsEpochMs: 1_700_000_000_000,
  actorKind: 'tentacle',
  actorId: 'tentacle:verifier',
  action: 'ledger.append',
  resourceKind: 'audit',
  resourceId: 'row-1',
  traceId: null,
  payload: { ok: true },
  ...overrides
})

describe('AuditChain construction', () => {
  it('genesis starts at the 64-zero prev hash with no entries', () => {
    const chain = AuditChain.genesis(sha256EntryHashFn)
    expect(chain.lastEntryHash).toBe(GENESIS_PREV_HASH)
    expect(GENESIS_PREV_HASH).toBe('0'.repeat(64))
    expect(chain.entryCount).toBe(0)
    expect(chain.toCheckpoint()).toBe(GENESIS_PREV_HASH)
  })

  it('resume continues from a tail entry hash', () => {
    const first = AuditChain.genesis(sha256EntryHashFn)
    const appended = first.append(event())
    const resumed = AuditChain.resume(sha256EntryHashFn, appended.entryHash)
    expect(resumed.lastEntryHash).toBe(appended.entryHash)

    const next = resumed.append(event({ action: 'ledger.append-2' }))
    expect(next.prevHash).toBe(appended.entryHash)
  })

  it('rejects non-hex initial hashes', () => {
    expect(() => new AuditChain(sha256EntryHashFn, 'not-a-hash')).toThrow(RangeError)
    expect(() => AuditChain.resume(sha256EntryHashFn, 'A'.repeat(64))).toThrow(RangeError)
  })
})

describe('AuditChain.append', () => {
  it('links entries: each prevHash is the previous entryHash', () => {
    const chain = AuditChain.genesis(sha256EntryHashFn)
    const first = chain.append(event())
    const second = chain.append(event({ action: 'ledger.append-2', resourceId: 'row-2' }))

    expect(first.prevHash).toBe(GENESIS_PREV_HASH)
    expect(second.prevHash).toBe(first.entryHash)
    expect(isHashHex(first.entryHash)).toBe(true)
    expect(isHashHex(second.entryHash)).toBe(true)
    expect(chain.entryCount).toBe(2)
    expect(chain.lastEntryHash).toBe(second.entryHash)
    expect(chain.readonlyEntries.map((entry) => entry.action)).toEqual(['ledger.append', 'ledger.append-2'])
  })

  it('isHashHex enforces 64 lowercase hex chars', () => {
    expect(isHashHex('a'.repeat(64))).toBe(true)
    expect(isHashHex('A'.repeat(64))).toBe(false)
    expect(isHashHex('a'.repeat(63))).toBe(false)
    expect(isHashHex(`${'a'.repeat(63)}g`)).toBe(false)
  })

  it('a failed append leaves the chain untouched', () => {
    const chain = AuditChain.genesis(sha256EntryHashFn)
    chain.append(event())
    const before = chain.lastEntryHash

    expect(() => chain.append(event({ actorId: 'bad\u001fid' }))).toThrow(RangeError)
    expect(chain.entryCount).toBe(1)
    expect(chain.lastEntryHash).toBe(before)
  })

  it('rejects non-safe or negative tsEpochMs and empty actorId/action', () => {
    const chain = AuditChain.genesis(sha256EntryHashFn)
    expect(() => chain.append(event({ tsEpochMs: -1 }))).toThrow(RangeError)
    expect(() => chain.append(event({ tsEpochMs: Number.MAX_SAFE_INTEGER + 1 }))).toThrow(RangeError)
    expect(() => chain.append(event({ tsEpochMs: 1.5 }))).toThrow(RangeError)
    expect(() => chain.append(event({ actorId: '' }))).toThrow(RangeError)
    expect(() => chain.append(event({ action: '' }))).toThrow(RangeError)
  })
})

describe('assertEventFieldsControlFree', () => {
  it('accepts a clean event and a null traceId', () => {
    expect(assertEventFieldsControlFree(event())).toBeUndefined()
  })

  it('rejects control characters in every free-text field', () => {
    const controlChars = ['\u0000', '\u001f', '\n', '\t', '\u007f']
    for (const controlChar of controlChars) {
      expect(() => assertEventFieldsControlFree(event({ actorId: `a${controlChar}b` }))).toThrow(RangeError)
      expect(() => assertEventFieldsControlFree(event({ action: `a${controlChar}b` }))).toThrow(RangeError)
      expect(() => assertEventFieldsControlFree(event({ resourceKind: `a${controlChar}b` }))).toThrow(RangeError)
      expect(() => assertEventFieldsControlFree(event({ resourceId: `a${controlChar}b` }))).toThrow(RangeError)
      expect(() => assertEventFieldsControlFree(event({ traceId: `a${controlChar}b` }))).toThrow(RangeError)
    }
  })
})

describe('canonicalEventJson', () => {
  it('composes post-prev-hash fields in order, joined with 0x1F', () => {
    const composed = canonicalEventJson(event({ payload: { ok: true } }))
    expect(composed).toBe(
      ['tentacle', 'tentacle:verifier', 'ledger.append', 'audit', 'row-1', '', '1700000000000', '{"ok":true}'].join(
        AUDIT_HASH_FIELD_SEPARATOR
      )
    )
  })

  it('uses the traceId verbatim when present and the shared domain tag constant', () => {
    expect(canonicalEventJson(event({ traceId: 'trace-9' })).split(AUDIT_HASH_FIELD_SEPARATOR)[5]).toBe('trace-9')
    expect(AUDIT_HASH_DOMAIN).toBe('osh-audit-v1')
  })
})

describe('stableJson', () => {
  it('sorts object keys and preserves array order', () => {
    expect(stableJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}')
    expect(stableJson([2, 1, [3, 4]])).toBe('[2,1,[3,4]]')
    expect(stableJson({ n: null, f: false, t: true, s: 'x' })).toBe('{"f":false,"n":null,"s":"x","t":true}')
  })

  it('drops undefined members and their keys', () => {
    expect(stableJson({ a: undefined, b: 1 })).toBe('{"b":1}')
  })

  it('rejects NaN/Infinity with no byte-stable encoding', () => {
    expect(() => stableJson({ x: Number.NaN })).toThrow(RangeError)
    expect(() => stableJson({ x: Number.POSITIVE_INFINITY })).toThrow(RangeError)
    expect(() => stableJson(Number.NEGATIVE_INFINITY)).toThrow(RangeError)
  })

  it('rejects bigint, symbol, and function nodes', () => {
    expect(() => stableJson({ x: 1n })).toThrow(RangeError)
    expect(() => stableJson({ x: Symbol('s') })).toThrow(RangeError)
    expect(() => stableJson({ x: () => 1 })).toThrow(RangeError)
  })

  it('rejects non-plain objects (Map/Set/Date/class instances)', () => {
    class Box {
      value = 1
    }
    expect(() => stableJson({ x: new Map() })).toThrow(/non-plain object/)
    expect(() => stableJson({ x: new Set() })).toThrow(/non-plain object/)
    expect(() => stableJson({ x: new Date(0) })).toThrow(/non-plain object/)
    expect(() => stableJson({ x: new Box() })).toThrow(/non-plain object/)
  })

  it('enforces the depth budget: the leaf counts too, so 11 nested arrays pass and 12 throw', () => {
    const nest = (levels: number): unknown => {
      let value: unknown = 1
      for (let index = 0; index < levels; index = index + 1) {
        value = [value]
      }
      return value
    }
    expect(stableJson(nest(11))).toBe('['.repeat(11) + '1' + ']'.repeat(11))
    expect(() => stableJson(nest(12))).toThrow(/depth/)
  })

  it('sibling breadth does not accumulate node counts; the byte budget bounds size instead', () => {
    expect(stableJson(Array.from({ length: 10_000 }, () => 1))).toHaveLength(20_001)
  })

  it('enforces the byte budget', () => {
    expect(() => stableJson({ blob: 'x'.repeat(524_289) })).toThrow(/canonical bytes/)
  })
})

describe('verifyLedger', () => {
  const buildChain = (events: readonly AuditEvent[]): LedgerEntry[] => {
    const chain = AuditChain.genesis(sha256EntryHashFn)
    return events.map((entry) => chain.append(entry))
  }

  it('accepts a full unmodified ledger', () => {
    const entries = buildChain([event(), event({ action: 'ledger.append-2' }), event({ action: 'ledger.append-3' })])
    expect(verifyLedger(entries, sha256EntryHashFn)).toEqual({ ok: true, brokenIndex: null })
  })

  it('accepts an empty ledger', () => {
    expect(verifyLedger([], sha256EntryHashFn)).toEqual({ ok: true, brokenIndex: null })
  })

  it('detects a tampered field at its index', () => {
    const entries = buildChain([event(), event({ action: 'ledger.append-2' })])
    const tampered: LedgerEntry[] = entries.map((entry, index) =>
      index === 1 ? { ...entry, action: 'ledger.tampered' } : entry
    )
    expect(verifyLedger(tampered, sha256EntryHashFn)).toEqual({ ok: false, brokenIndex: 1 })
  })

  it('detects a broken prevHash linkage', () => {
    const entries = buildChain([event(), event({ action: 'ledger.append-2' })])
    const broken: LedgerEntry[] = entries.map((entry, index) =>
      index === 1 ? { ...entry, prevHash: GENESIS_PREV_HASH } : entry
    )
    expect(verifyLedger(broken, sha256EntryHashFn)).toEqual({ ok: false, brokenIndex: 1 })
  })

  it('detects a wrong first row (genesis linkage broken)', () => {
    const entries = buildChain([event()])
    const broken = entries.map((entry) => ({ ...entry, prevHash: '1'.repeat(64) }))
    expect(verifyLedger(broken, sha256EntryHashFn)).toEqual({ ok: false, brokenIndex: 0 })
  })
})
