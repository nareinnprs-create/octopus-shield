import type { Permission } from '@shield/access'
import {
  SUCKER_CAPABILITY_RESOURCE_KIND,
  type SuckerManifest,
  type SuckerPermissionRequest
} from './sucker-manifest'

/**
 * Grant approval resolution (contract §3.3): approvals write exact allow
 * rows on the Sucker-scoped role, and operator-authored deny rows land as
 * explicit deny facts for @shield/access deny-wins evaluation. Anything not
 * requested/declared by the manifest rejects, so approval can only narrow,
 * never widen, authority.
 */

export type SuckerCapabilityGrant = {
  capability: string
  effect: 'allow' | 'deny'
}

export type SuckerGrantSelection = {
  /** Subset of the manifest's requested rows; omitted approves every request. */
  permissions?: readonly SuckerPermissionRequest[]
  /**
   * Subset of the manifest's declared egress capabilities — plain names
   * approve, `{ capability, effect: 'deny' }` writes an explicit deny row;
   * omitted approves all declared.
   */
  capabilities?: readonly (string | SuckerCapabilityGrant)[]
}

const sameRow = (a: SuckerPermissionRequest, b: SuckerPermissionRequest): boolean =>
  a.resourceKind.toLowerCase() === b.resourceKind.toLowerCase() &&
  a.action.toLowerCase() === b.action.toLowerCase()

const declaredCapability = (
  manifest: SuckerManifest,
  capability: string
): SuckerManifest['egress'][number] | undefined =>
  manifest.egress.find((entry) => entry.capability.toLowerCase() === capability.toLowerCase())

export type SuckerGrantResolution =
  | { ok: true; rows: readonly Permission[] }
  | { ok: false; reason: string }

/** Pure resolver: manifest request ∩ admin approval → role_permissions-shaped rows. */
export function resolveGrantRows(
  manifest: SuckerManifest,
  selection: SuckerGrantSelection
): SuckerGrantResolution {
  const rows: Permission[] = []
  for (const row of selection.permissions ?? manifest.permissions) {
    if (!manifest.permissions.some((candidate) => sameRow(candidate, row))) {
      return {
        ok: false,
        reason: `grant row was not requested by ${manifest.id}: ${row.resourceKind}/${row.action}`
      }
    }
    rows.push({ resourceKind: row.resourceKind, action: row.action, effect: 'allow' })
  }
  for (const entry of selection.capabilities ?? manifest.egress.map((item) => item.capability)) {
    const capability = typeof entry === 'string' ? entry : entry.capability
    const effect = typeof entry === 'string' ? 'allow' : entry.effect
    if (declaredCapability(manifest, capability) === undefined) {
      return { ok: false, reason: `capability was not declared in egress: ${capability}` }
    }
    rows.push({ resourceKind: SUCKER_CAPABILITY_RESOURCE_KIND, action: capability, effect })
  }
  return { ok: true, rows }
}

export { declaredCapability }
