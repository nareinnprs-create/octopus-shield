import { describe, expect, it } from 'vitest'

import { CALDERA_ROUTES } from './caldera-routes'

describe('CALDERA_ROUTES table invariants', () => {
  it('every record carries a valid api, method token, status, path, and source', () => {
    const apis = new Set(['v2', 'core-rest'])
    const statuses = new Set(['implemented', 'verified', 'unknown'])
    for (const route of CALDERA_ROUTES) {
      expect(apis.has(route.api), route.path).toBe(true)
      expect(route.method, route.path).toMatch(/^\*|[A-Z]+$/)
      expect(statuses.has(route.status), route.path).toBe(true)
      expect(route.path.length, route.path).toBeGreaterThan(0)
      expect(route.source.length, route.path).toBeGreaterThan(0)
    }
  })

  it('paths are unique per api+method', () => {
    const seen = new Set<string>()
    for (const route of CALDERA_ROUTES) {
      const key = `${route.api} ${route.method} ${route.path}`
      expect(seen.has(key), `duplicate route record: ${key}`).toBe(false)
      seen.add(key)
    }
  })

  it('implemented records cite real in-repo sources (line numbers, never "not found")', () => {
    for (const route of CALDERA_ROUTES.filter((item) => item.status === 'implemented')) {
      expect(route.source).not.toBe('not found')
      expect(route.source).toMatch(/:\d+$/)
    }
  })

  it('the live-verified health probe route is implemented on the v2 api', () => {
    const health = CALDERA_ROUTES.find((route) => route.path === '/api/v2/health')
    expect(health).toMatchObject({ api: 'v2', method: 'GET', status: 'implemented' })
  })

  it('the implemented set covers the v2 clients encoded in caldera.ts', () => {
    const implementedPaths = CALDERA_ROUTES.filter((route) => route.status === 'implemented').map(
      (route) => route.path
    )
    for (const path of ['/api/v2/health', '/api/v2/abilities', '/api/v2/adversaries']) {
      expect(implementedPaths).toContain(path)
    }
  })
})
