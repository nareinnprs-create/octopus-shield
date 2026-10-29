import type { Permission } from './permission-domain'

/** Exact (resourceKind, action) lookup against declarative grants. */
export type PermissionQuery = {
  resourceKind: string
  action: string
}

/**
 * `because` distinguishes the three outcomes so callers can report why:
 * 'explicit-deny' beats 'explicit-allow'; 'no-grant' is default-deny.
 */
export type PermissionDecision = {
  granted: boolean
  because: 'explicit-deny' | 'explicit-allow' | 'no-grant'
}

const DENY = 'deny'
const ALLOW = 'allow'

/**
 * Pure deny-wins evaluation over one merged grant list. Row order is
 * irrelevant: an effect only wins when it is the only kind present among
 * matching rows. resourceKind/action compare case-insensitively so a
 * mistyped-cased grant row cannot silently become a different resource.
 * Callers merge duplicate role rows before calling — same
 * (resourceKind, action, effect) rows dedupe cleanly, and conflicting rows
 * across roles are expected input, not an error.
 */
export function evaluate(
  grants: readonly Permission[],
  query: PermissionQuery
): PermissionDecision {
  const queryResource = query.resourceKind.toLowerCase()
  const queryAction = query.action.toLowerCase()
  let matchedAllow = false
  let matchedDeny = false
  for (const grant of grants) {
    if (grant.resourceKind.toLowerCase() !== queryResource || grant.action.toLowerCase() !== queryAction) {
      continue
    }
    if (grant.effect === DENY) {
      matchedDeny = true
    } else if (grant.effect === ALLOW) {
      matchedAllow = true
    }
  }
  if (matchedDeny) {
    return { granted: false, because: 'explicit-deny' }
  }
  if (matchedAllow) {
    return { granted: true, because: 'explicit-allow' }
  }
  return { granted: false, because: 'no-grant' }
}

/** Merge a principal's role permissions into one grant list (deny-wins caller input). Copies so callers holding the role cannot mutate shared state. */
export function collectRoleGrants(principal: {
  roles: ReadonlyArray<{ permissions: readonly Permission[] }>
}): Permission[] {
  const grants: Permission[] = []
  for (const role of principal.roles) {
    for (const permission of role.permissions) {
      grants.push({ ...permission })
    }
  }
  return grants
}
