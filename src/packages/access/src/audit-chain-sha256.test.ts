import { createHash } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { GENESIS_PREV_HASH, AuditChain, canonicalEventJson, type AuditEvent } from './audit-chain'
import { sha256EntryHashFn } from './audit-chain-sha256'

// Known-vector composition: the doc'd ENTRY_HASH bytes are
//   sha256( 'osh-audit-v1' || 0x1F || previousHash || 0x1F || canonicalEventJson )
// computed here as ONE digest over the concatenated buffer so the multi-update
// writer cannot drift from the composition (infra/db/audit.sql).
const expectedEntryHash = (previousHash: string, canonicalEvent: string): string => {
  const composed = Buffer.concat([
    Buffer.from('osh-audit-v1', 'utf8'),
    Buffer.from([0x1f]),
    Buffer.from(previousHash, 'utf8'),
    Buffer.from([0x1f]),
    Buffer.from(canonicalEvent, 'utf8')
  ])
  return createHash('sha256').update(composed).digest('hex')
}

const event: AuditEvent = {
  tsEpochMs: 1_700_000_000_123,
  actorKind: 'human',
  actorId: 'operator-7',
  action: 'auth.login',
  resourceKind: 'session',
  resourceId: 'ses_42',
  traceId: 'trace-9',
  payload: { mfa: 'totp', nested: { b: 2, a: [1, 2] } }
}

describe('sha256EntryHashFn', () => {
  it('matches the single-buffer sha256 composition of domain || 0x1F || prev || 0x1F || canonical json', () => {
    const previousHash = 'a'.repeat(64)
    const canonical = canonicalEventJson(event)
    expect(sha256EntryHashFn(previousHash, canonical)).toBe(expectedEntryHash(previousHash, canonical))
  })

  it('produces 64 lowercase hex chars and diverges on a different previous hash', () => {
    const canonical = canonicalEventJson(event)
    const hashA = sha256EntryHashFn('a'.repeat(64), canonical)
    const hashB = sha256EntryHashFn('b'.repeat(64), canonical)
    expect(hashA).toMatch(/^[0-9a-f]{64}$/)
    expect(hashA).not.toBe(hashB)
  })

  it('pins the full genesis append: chain entryHash equals the known-vector digest', () => {
    const chain = AuditChain.genesis(sha256EntryHashFn)
    const entry = chain.append(event)
    expect(entry.prevHash).toBe(GENESIS_PREV_HASH)
    expect(entry.entryHash).toBe(expectedEntryHash(GENESIS_PREV_HASH, canonicalEventJson(event)))
  })

  it('is stable across repeated calls (pure digest of its inputs)', () => {
    const canonical = canonicalEventJson(event)
    expect(sha256EntryHashFn(GENESIS_PREV_HASH, canonical)).toBe(sha256EntryHashFn(GENESIS_PREV_HASH, canonical))
  })
})
