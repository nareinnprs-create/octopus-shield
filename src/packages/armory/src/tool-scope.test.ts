import { describe, expect, it } from 'vitest'

import { parseArmoryScope, scopeFromEnv, targetInScope, targetsInScope } from './tool-scope'

describe('parseArmoryScope', () => {
  it('parses CIDRs into masked networks plus exact names (lowercased)', () => {
    const scope = parseArmoryScope('192.168.1.0/24,Host.Example.COM,10.0.0.5')
    expect(scope.cidrs).toEqual([{ network: 0xc0a80100, prefix: 24 }])
    expect([...scope.exact]).toEqual(['host.example.com', '10.0.0.5'])
  })

  it('masks the network to the prefix (host bits dropped)', () => {
    const scope = parseArmoryScope('10.1.2.3/8')
    expect(scope.cidrs).toEqual([{ network: 0x0a000000, prefix: 8 }])
  })

  it('accepts the /8..32 prefix bounds and skips outside ones', () => {
    expect(parseArmoryScope('10.0.0.0/8').cidrs).toEqual([{ network: 0x0a000000, prefix: 8 }])
    expect(parseArmoryScope('10.0.0.0/32').cidrs).toEqual([{ network: 0x0a000000, prefix: 32 }])
    expect(parseArmoryScope('10.0.0.0/7').cidrs).toEqual([])
    expect(parseArmoryScope('10.0.0.0/33').cidrs).toEqual([])
    expect(parseArmoryScope('10.0.0.0/0').cidrs).toEqual([])
  })

  it('skips malformed CIDRs without throwing', () => {
    for (const bad of ['256.0.0.0/24', '1.2.3/24', 'abc/24', '1.2.3.4/', '10.0.0.0/abc']) {
      expect(parseArmoryScope(bad).cidrs).toEqual([])
    }
  })

  it('empty or whitespace-only input yields the empty (deny-all) scope', () => {
    for (const raw of [undefined, '', '   ', ',,,']) {
      const scope = parseArmoryScope(raw)
      expect(scope.exact.size).toBe(0)
      expect(scope.cidrs).toHaveLength(0)
    }
  })

  it('scopeFromEnv reads OSHIELD_ARMORY_SCOPE', () => {
    expect(scopeFromEnv({ OSHIELD_ARMORY_SCOPE: '10.0.0.0/24' }).cidrs).toHaveLength(1)
    expect(scopeFromEnv({}).cidrs).toHaveLength(0)
  })
})

describe('targetInScope', () => {
  const scope = parseArmoryScope('192.168.1.0/24,host.example.com,10.0.0.5')

  it('matches exact hostnames case-insensitively', () => {
    expect(targetInScope(scope, 'host.example.com')).toBe(true)
    expect(targetInScope(scope, '  HOST.Example.COM ')).toBe(true)
  })

  it('matches exact IP targets', () => {
    expect(targetInScope(scope, '10.0.0.5')).toBe(true)
  })

  it('applies CIDR v4 math: in-range true, out-of-range false', () => {
    expect(targetInScope(scope, '192.168.1.0')).toBe(true)
    expect(targetInScope(scope, '192.168.1.255')).toBe(true)
    expect(targetInScope(scope, '192.168.1.77')).toBe(true)
    expect(targetInScope(scope, '192.168.0.255')).toBe(false)
    expect(targetInScope(scope, '192.168.2.1')).toBe(false)
    expect(targetInScope(scope, '10.0.0.6')).toBe(false)
  })

  it('denies unknown hostnames, empty input, and non-IP strings', () => {
    expect(targetInScope(scope, 'other.example.com')).toBe(false)
    expect(targetInScope(scope, '')).toBe(false)
    expect(targetInScope(scope, '  ')).toBe(false)
  })
})

describe('targetsInScope', () => {
  const scope = parseArmoryScope('192.168.1.0/24')

  it('is false for an empty target list (deny-by-default: no targets, no run)', () => {
    expect(targetsInScope(scope, [])).toBe(false)
  })

  it('is true only when every target is inside the scope', () => {
    expect(targetsInScope(scope, ['192.168.1.10'])).toBe(true)
    expect(targetsInScope(scope, ['192.168.1.10', '192.168.1.11'])).toBe(true)
    expect(targetsInScope(scope, ['192.168.1.10', '10.0.0.1'])).toBe(false)
  })
})
