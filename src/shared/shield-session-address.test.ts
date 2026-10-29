import { describe, expect, it } from 'vitest'
import {
  formatShieldSessionAddress,
  isShieldSessionId,
  parseShieldSessionAddress
} from './shield-session-address'
import { testShieldSessionId } from './shield-session-address-test-fixture'

const SESSION_ID = testShieldSessionId('0b7e4c2a-5f1d-4e8a-9c3b-2d6f8a1e4b70')
const ADDRESS = `shield_session_id:${SESSION_ID}`

describe('Shield session address', () => {
  it('addresses an Shield session id as shield_session_id:<id> and parses the bare id back', () => {
    expect(formatShieldSessionAddress(SESSION_ID)).toBe(ADDRESS)
    expect(parseShieldSessionAddress(ADDRESS)).toBe(SESSION_ID)
    const parsed = parseShieldSessionAddress(ADDRESS)
    expect(parsed && formatShieldSessionAddress(parsed)).toBe(ADDRESS)
  })

  it('reads only the addressed spelling when parsing an address', () => {
    // A bare id is what the columns store, not an address.
    expect(parseShieldSessionAddress(SESSION_ID)).toBeNull()
    expect(parseShieldSessionAddress(null)).toBeNull()
    expect(parseShieldSessionAddress(undefined)).toBeNull()
    expect(parseShieldSessionAddress('')).toBeNull()
  })

  it.each([
    ['an unknown prefix', `pane:${SESSION_ID}`],
    ['the Run mailbox namespace', 'run:run_123'],
    ['the Dispatch mailbox namespace', 'dispatch:ctx_123'],
    ['an empty prefix', `:${SESSION_ID}`],
    ['an empty id', 'shield_session_id:'],
    ['an id with a separator', `shield_session_id:${SESSION_ID}:extra`],
    ['an id the session predicate rejects', 'shield_session_id:short'],
    ['a terminal handle', 'term_4f2c9a']
  ])('refuses %s', (_label, value) => {
    expect(parseShieldSessionAddress(value)).toBeNull()
  })

  it('no longer reads the retired session:<id> spelling as a session, as an address or a bare id', () => {
    expect(parseShieldSessionAddress(`session:${SESSION_ID}`)).toBeNull()
    expect(isShieldSessionId(`session:${SESSION_ID}`)).toBe(false)
  })

  it.each([
    ['a PTY terminal handle', 'term_4f2c9a1b-7d3e-4a5f-8b6c-9d0e1f2a3b4c'],
    ['a short PTY terminal handle', 'term_4f2c9a'],
    ['a structured-worker handle', 'structworker_4f2c9a1b-7d3e-4a5f-8b6c-9d0e1f2a3b4c']
  ])('never treats %s as an Shield session id', (_label, handle) => {
    // Handles share the session-id charset, so the session-record predicate alone would accept them.
    expect(isShieldSessionId(handle)).toBe(false)
    expect(parseShieldSessionAddress(`shield_session_id:${handle}`)).toBeNull()
  })

  it('validates an Shield session id with the session-record predicate', () => {
    expect(isShieldSessionId(SESSION_ID)).toBe(true)
    expect(isShieldSessionId('has space in it')).toBe(false)
    expect(isShieldSessionId('x'.repeat(129))).toBe(false)
  })
})
