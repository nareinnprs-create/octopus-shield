import { describe, expect, it } from 'vitest'

import { collectRoleGrants, evaluate } from './permission-evaluate'
import type { Permission } from './permission-domain'

const grant = (resourceKind: string, action: string, effect: 'allow' | 'deny'): Permission => ({
  resourceKind,
  action,
  effect
})

describe('evaluate', () => {
  it('default-denies with empty grants (no-grant)', () => {
    expect(evaluate([], { resourceKind: 'engine', action: 'restart' })).toEqual({
      granted: false,
      because: 'no-grant'
    })
  })

  it('default-denies when no grant row matches the query', () => {
    const grants = [grant('targets', 'scan', 'allow'), grant('engine', 'stop', 'deny')]
    expect(evaluate(grants, { resourceKind: 'engine', action: 'restart' })).toEqual({
      granted: false,
      because: 'no-grant'
    })
  })

  it('deny wins over allow regardless of row order', () => {
    const grants = [grant('engine', 'restart', 'allow'), grant('engine', 'restart', 'deny')]
    expect(evaluate(grants, { resourceKind: 'engine', action: 'restart' })).toEqual({
      granted: false,
      because: 'explicit-deny'
    })
    expect(evaluate([...grants].reverse(), { resourceKind: 'engine', action: 'restart' })).toEqual({
      granted: false,
      because: 'explicit-deny'
    })
  })

  it('explicit allow grants when only allow rows match', () => {
    const grants = [grant('targets', 'scan', 'allow'), grant('targets', 'destroy', 'deny')]
    expect(evaluate(grants, { resourceKind: 'targets', action: 'scan' })).toEqual({
      granted: true,
      because: 'explicit-allow'
    })
  })

  it('matches resourceKind/action case-insensitively on both sides', () => {
    const mixedCase = [grant('ENGINE', 'Restart', 'allow')]
    expect(evaluate(mixedCase, { resourceKind: 'engine', action: 'RESTART' })).toEqual({
      granted: true,
      because: 'explicit-allow'
    })

    const denyMixedCase = [grant('Engine', 'restart', 'deny'), grant('engine', 'RESTART', 'allow')]
    expect(evaluate(denyMixedCase, { resourceKind: 'ENGINE', action: 'Restart' })).toEqual({
      granted: false,
      because: 'explicit-deny'
    })
  })

  it('rows for a different resource or action never influence the decision', () => {
    const grants = [grant('engine', 'stop', 'deny'), grant('targets', 'restart', 'deny')]
    expect(evaluate(grants, { resourceKind: 'engine', action: 'restart' }).because).toBe('no-grant')
  })
})

describe('collectRoleGrants', () => {
  it('merges role permissions into one list, copying each row', () => {
    const roleA = { name: 'operator', kind: 'operator' as const, permissions: [grant('targets', 'scan', 'allow')] }
    const roleB = { name: 'auditor', kind: 'auditor' as const, permissions: [grant('audit', 'read', 'allow')] }
    const principal = { kind: 'human' as const, id: 'p1', roles: [roleA, roleB] }

    const grants = collectRoleGrants(principal)
    expect(grants).toHaveLength(2)
    expect(grants[0]).toEqual({ resourceKind: 'targets', action: 'scan', effect: 'allow' })
    expect(grants[1]).toEqual({ resourceKind: 'audit', action: 'read', effect: 'allow' })

    grants.push(grant('engine', 'restart', 'deny'))
    expect(roleA.permissions).toHaveLength(1)
    expect(collectRoleGrants(principal)).toHaveLength(2)
  })
})
