/** Shield access domain: principals, roles, permissions, sessions, MFA factors. */

export const PRINCIPAL_KINDS = ['human', 'tentacle', 'sucker', 'engine'] as const
export type PrincipalKind = (typeof PRINCIPAL_KINDS)[number]

export const ROLE_KINDS = ['owner', 'admin', 'operator', 'auditor', 'viewer', 'tentacle'] as const
export type RoleKind = (typeof ROLE_KINDS)[number]

export const MFA_METHODS = ['totp', 'webauthn'] as const
export type MfaMethod = (typeof MFA_METHODS)[number]

export type PermissionEffect = 'allow' | 'deny'

export const AUDIT_ACTOR_KINDS = PRINCIPAL_KINDS
/** Actor of an audit_events row (infra/db/audit.sql actor_kind CHECK). */
export type AuditActorKind = PrincipalKind

/**
 * One role_permissions fact: exact (resourceKind, action) pair. No wildcard
 * matching in v0 — see permission-evaluate.ts.
 */
export type Permission = {
  resourceKind: string
  action: string
  effect: PermissionEffect
}

export type Role = {
  name: string
  kind: RoleKind
  permissions: readonly Permission[]
}

export type Principal = {
  kind: PrincipalKind
  id: string
  roles: readonly Role[]
}

/** Epoch-millisecond clock contract so evaluation stays a pure function. */
export type Session = {
  sessionId: string
  principal: Principal
  mfaSatisfied: boolean
  mfaMethod: MfaMethod | null
  expiresAtEpochMs: number
  /** False once the underlying user row is deactivated/revoked — issued tokens lose authority with it. */
  isRevoked: boolean
}

/** Inkout-sealed enrollment secret (mfa_factors.secret_ciphertext). */
export type MfaFactor = {
  factorId: string
  principalId: string
  type: MfaMethod
  secretCiphertext: Uint8Array
}

export function isSessionExpired(session: Session, nowEpochMs: number): boolean {
  return session.expiresAtEpochMs <= nowEpochMs
}

/** A session is usable only while unexpired AND unrevoked — deactivating a user invalidates live sessions. */
export function isSessionUsable(session: Session, nowEpochMs: number): boolean {
  return !session.isRevoked && !isSessionExpired(session, nowEpochMs)
}

/**
 * MFA policy stub: owner/admin sessions must show a satisfied factor.
 * TODO(verify): confirm whether operator/viewer/tentacle sessions are
 * exempt before the first UI lands.
 */
export function sessionRequiresMfa(session: Session): boolean {
  if (session.mfaSatisfied && session.mfaMethod !== null) {
    return false
  }
  return session.principal.roles.some((role) => role.kind === 'owner' || role.kind === 'admin')
}
