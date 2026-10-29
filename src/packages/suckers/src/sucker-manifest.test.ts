import { describe, expect, it } from 'vitest'

import {
  MAX_MANIFEST_JSON_BYTES,
  parseSuckerManifest,
  parseSuckerManifestJson,
  SUCKER_CAPABILITY_RESOURCE_KIND
} from './sucker-manifest'

const validManifest = {
  id: 'threat-intel-generic',
  version: '0.1.0',
  kind: 'threat-intel',
  permissions: [
    { resourceKind: 'ioc-record', action: 'query' },
    { resourceKind: 'audit-events', action: 'consult' }
  ],
  isolation: { tier: 'shed-isolated' },
  egress: [{ capability: 'external.ioc-reputation', purpose: 'file/ip/domain reputation lookups' }],
  publisher: { id: 'example-publisher', signingKeyId: 'key-123' }
}

describe('parseSuckerManifest', () => {
  it('accepts the contract §1 example shape', () => {
    const result = parseSuckerManifest(validManifest)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.manifest.id).toBe('threat-intel-generic')
      expect(result.manifest.permissions).toHaveLength(2)
      expect(result.manifest.isolation.tier).toBe('shed-isolated')
    }
  })

  it('rejects ids that are not slugs', () => {
    for (const id of [
      'Threat-Intel',
      'threat_intel',
      '-leading',
      'trailing-',
      'double--dash',
      '',
      'has space',
      'dot.name'
    ]) {
      const result = parseSuckerManifest({ ...validManifest, id })
      expect(result.ok).toBe(false)
    }
  })

  it('rejects unknown kinds including the contract TODO custom kind', () => {
    for (const kind of ['custom', 'threat-intel ', '', 'scanner']) {
      const result = parseSuckerManifest({ ...validManifest, kind })
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.reason).toContain('kind must be one of')
      }
    }
  })

  it('rejects unknown and retired Shed tier labels', () => {
    for (const tier of ['shed-t0', 'shed-t1', 'shed-t2', 'isolated', 'SHED-ISOLATED', '']) {
      const result = parseSuckerManifest({ ...validManifest, isolation: { tier } })
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.reason).toContain('isolation.tier must be one of')
      }
    }
  })

  it('rejects unknown fields at every level', () => {
    expect(parseSuckerManifest({ ...validManifest, extra: 1 }).ok).toBe(false)
    expect(
      parseSuckerManifest({ ...validManifest, isolation: { tier: 'shed-trusted', fs: true } }).ok
    ).toBe(false)
    expect(
      parseSuckerManifest({
        ...validManifest,
        permissions: [{ resourceKind: 'x', action: 'y', effect: 'allow' }]
      }).ok
    ).toBe(false)
    expect(
      parseSuckerManifest({
        ...validManifest,
        publisher: { id: 'p', signingKeyId: 'k', key: 'raw' }
      }).ok
    ).toBe(false)
  })

  it('rejects malformed permission and egress rows', () => {
    expect(parseSuckerManifest({ ...validManifest, permissions: [] }).ok).toBe(false)
    expect(parseSuckerManifest({ ...validManifest, permissions: 'query' }).ok).toBe(false)
    expect(
      parseSuckerManifest({
        ...validManifest,
        permissions: [{ resourceKind: '', action: 'query' }]
      }).ok
    ).toBe(false)
    expect(
      parseSuckerManifest({
        ...validManifest,
        egress: [{ capability: 'External.Rep', purpose: 'p' }]
      }).ok
    ).toBe(false)
    expect(
      parseSuckerManifest({ ...validManifest, egress: [{ capability: 'external.rep' }] }).ok
    ).toBe(false)
  })

  it('rejects malformed versions and publishers', () => {
    for (const version of ['1', '1.0', 'v1.0.0', '01.0.0', '']) {
      expect(parseSuckerManifest({ ...validManifest, version }).ok).toBe(false)
    }
    expect(
      parseSuckerManifest({ ...validManifest, publisher: { id: '', signingKeyId: 'k' } }).ok
    ).toBe(false)
    expect(parseSuckerManifest({ ...validManifest, publisher: 'example' }).ok).toBe(false)
  })

  it('rejects non-object manifests and primitives', () => {
    for (const input of [null, undefined, 42, 'manifest', [validManifest]]) {
      expect(parseSuckerManifest(input).ok).toBe(false)
    }
  })

  it('enforces the resource-kind registry when one is provided', () => {
    const options = { resourceKinds: new Set(['ioc-record']) }
    const filtered = {
      ...validManifest,
      permissions: [{ resourceKind: 'ioc-record', action: 'query' }]
    }
    expect(parseSuckerManifest(filtered, options).ok).toBe(true)
    expect(parseSuckerManifest(validManifest, options).ok).toBe(false)
  })

  it('keeps the capability resource-kind constant in the broker namespace', () => {
    expect(SUCKER_CAPABILITY_RESOURCE_KIND).toBe('sucker.capability')
  })
})

describe('parseSuckerManifestJson', () => {
  it('round-trips a valid manifest', () => {
    const result = parseSuckerManifestJson(JSON.stringify(validManifest))
    expect(result.ok).toBe(true)
  })

  it('rejects oversized manifests before parsing', () => {
    const bloated = JSON.stringify({
      ...validManifest,
      publisher: { id: 'x'.repeat(MAX_MANIFEST_JSON_BYTES), signingKeyId: 'k' }
    })
    const result = parseSuckerManifestJson(bloated)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toContain('exceeds')
    }
  })

  it('rejects oversized permission arrays', () => {
    const many = Array.from({ length: 129 }, (_, index) => ({
      resourceKind: `r${index}`,
      action: 'query'
    }))
    expect(parseSuckerManifest({ ...validManifest, permissions: many }).ok).toBe(false)
  })

  it('rejects invalid JSON', () => {
    const result = parseSuckerManifestJson('{id: nope}')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toContain('not valid JSON')
    }
  })
})
