import type {
  ShieldCloudCapabilities,
  ShieldCloudOrgSummary,
  ShieldProfileCloudSummary,
  ShieldProfileListState
} from '../../shared/shield-profiles'
import { linkShieldProfileToCloud } from './profile-cloud-index'
import { getShieldProfileListState, loadOrCreateProfileIndex } from './profile-index-store'
import type { ShieldCloudSessionExchangeResponse } from './profile-cloud-session-exchange'
import {
  clearShieldCloudSession,
  flushUnsavedShieldCloudSessions,
  shieldCloudSessionKey,
  readShieldCloudSession,
  saveShieldCloudSession,
  type ShieldCloudSession,
  type ShieldCloudSessionReadResult
} from './profile-cloud-session-store'

// All session reads/writes pass through this owner; callers request changes instead of replacing state.

type SessionOwnerState = {
  // Sign-in/out fences older in-flight changes.
  generation: number
  // Org changes invalidate old metadata replies, but their rotated tokens must still land.
  linkVersion: number
  // Ignore disk after sign-out even if deletion failed.
  signedOut: boolean
}

export type CloudSessionTicket = { generation: number; linkVersion: number }

export type CloudSessionServerReply = {
  cloud?: ShieldProfileCloudSummary
  organizations?: ShieldCloudOrgSummary[]
  capabilities: ShieldCloudCapabilities
}

const owners = new Map<string, SessionOwnerState>()

function ownerOf(profileId: string, userDataPath: string): SessionOwnerState {
  const key = shieldCloudSessionKey(profileId, userDataPath)
  let owner = owners.get(key)
  if (!owner) {
    owner = { generation: 0, linkVersion: 0, signedOut: false }
    owners.set(key, owner)
  }
  return owner
}

function isSameOrgAsLink(
  profileId: string,
  userDataPath: string,
  cloud: ShieldProfileCloudSummary
): boolean {
  const linked = loadOrCreateProfileIndex(userDataPath).profiles.find(
    (profile) => profile.id === profileId
  )?.cloud
  return (linked?.activeOrgId ?? '') === (cloud.activeOrgId ?? '')
}

function relink(
  owner: SessionOwnerState,
  profileId: string,
  userDataPath: string,
  cloud: ShieldProfileCloudSummary
): ShieldProfileListState {
  const orgChanged = !isSameOrgAsLink(profileId, userDataPath, cloud)
  const list = linkShieldProfileToCloud(profileId, cloud, userDataPath)
  if (orgChanged) {
    owner.linkVersion++
  }
  return list
}

export function readCloudSession(
  profileId: string,
  userDataPath: string
): ShieldCloudSessionReadResult {
  if (ownerOf(profileId, userDataPath).signedOut) {
    return { status: 'missing', persistence: 'none' }
  }
  return readShieldCloudSession(profileId, userDataPath)
}

/** Take before requests whose replies mutate the session. */
export function takeCloudSessionTicket(
  profileId: string,
  userDataPath: string
): CloudSessionTicket {
  const owner = ownerOf(profileId, userDataPath)
  return { generation: owner.generation, linkVersion: owner.linkVersion }
}

export function signInCloudSession(
  profileId: string,
  userDataPath: string,
  exchange: ShieldCloudSessionExchangeResponse
): void {
  saveShieldCloudSession(profileId, userDataPath, {
    accessToken: exchange.accessToken,
    refreshToken: exchange.refreshToken,
    expiresAt: exchange.expiresAt,
    organizations: exchange.organizations,
    capabilities: exchange.capabilities
  })
  invalidateCloudSessionChanges(profileId, userDataPath)
  ownerOf(profileId, userDataPath).signedOut = false
}

export function invalidateCloudSessionChanges(profileId: string, userDataPath: string): void {
  const owner = ownerOf(profileId, userDataPath)
  owner.generation++
  owner.linkVersion++
}

export function signOutCloudSession(profileId: string, userDataPath: string): void {
  invalidateCloudSessionChanges(profileId, userDataPath)
  ownerOf(profileId, userDataPath).signedOut = true
  try {
    clearShieldCloudSession(profileId, userDataPath)
  } catch {
    // `signedOut` already hides the file, so a revoked token is never read back.
  }
}

// Clear only the token that failed; losing refresh racers must not erase the winner’s session.
export function signOutRevokedCloudSession(
  profileId: string,
  userDataPath: string,
  failed: ShieldCloudSession
): boolean {
  const current = readCloudSession(profileId, userDataPath)
  if (current.status === 'found' && current.session.refreshToken !== failed.refreshToken) {
    return false
  }
  // An unreadable token may differ from the failed one, so deletion is unsafe.
  if (current.status === 'unreadable') {
    return false
  }
  signOutCloudSession(profileId, userDataPath)
  return true
}

/** Save rotated tokens unless signed out/replaced: retaining spent tokens can revoke the family.
 * Apply org metadata only if the link has not moved; persist tokens before the best-effort link. */
export function commitCloudSessionRotation(
  profileId: string,
  userDataPath: string,
  ticket: CloudSessionTicket,
  spent: ShieldCloudSession,
  rotated: ShieldCloudSessionExchangeResponse
): ShieldCloudSession | null {
  const owner = ownerOf(profileId, userDataPath)
  const current = readCloudSession(profileId, userDataPath)
  if (
    owner.generation !== ticket.generation ||
    current.status !== 'found' ||
    current.session.refreshToken !== spent.refreshToken
  ) {
    return null
  }
  const tokens = {
    accessToken: rotated.accessToken,
    refreshToken: rotated.refreshToken,
    expiresAt: rotated.expiresAt
  }
  const linkUnmoved = owner.linkVersion === ticket.linkVersion
  const next = linkUnmoved
    ? { ...tokens, organizations: rotated.organizations, capabilities: rotated.capabilities }
    : { ...current.session, ...tokens }
  saveShieldCloudSession(profileId, userDataPath, next, { spentOnFailure: true })
  if (linkUnmoved) {
    try {
      relink(owner, profileId, userDataPath, rotated.cloud)
    } catch {
      // The tokens are saved; the link is retried by the next refresh or org change.
    }
  }
  return next
}

// Move the org link before requesting so in-flight refreshes cannot restore the old org.
export function beginCloudSessionRelink(
  profileId: string,
  userDataPath: string
): CloudSessionTicket {
  ownerOf(profileId, userDataPath).linkVersion++
  return takeCloudSessionTicket(profileId, userDataPath)
}

function commitServerReply(
  profileId: string,
  userDataPath: string,
  ticket: CloudSessionTicket,
  reply: CloudSessionServerReply,
  acceptsSameOrg: boolean
): ShieldProfileListState | null {
  const owner = ownerOf(profileId, userDataPath)
  const current = readCloudSession(profileId, userDataPath)
  const linkMoved =
    owner.linkVersion !== ticket.linkVersion &&
    !(acceptsSameOrg && reply.cloud && isSameOrgAsLink(profileId, userDataPath, reply.cloud))
  if (owner.generation !== ticket.generation || current.status !== 'found' || linkMoved) {
    return null
  }
  saveShieldCloudSession(profileId, userDataPath, {
    ...current.session,
    organizations: reply.organizations ?? current.session.organizations,
    capabilities: reply.capabilities
  })
  return reply.cloud
    ? relink(owner, profileId, userDataPath, reply.cloud)
    : getShieldProfileListState(userDataPath)
}

/** Leave tokens untouched; an already-selected org still counts as committed. */
export function commitCloudSessionRelink(
  profileId: string,
  userDataPath: string,
  ticket: CloudSessionTicket,
  reply: CloudSessionServerReply
): ShieldProfileListState | null {
  return commitServerReply(profileId, userDataPath, ticket, reply, true)
}

/** Refuse capability replies if the org link moved after the ticket. */
export function commitCloudSessionCapabilities(
  profileId: string,
  userDataPath: string,
  ticket: CloudSessionTicket,
  reply: CloudSessionServerReply
): ShieldProfileListState | null {
  return commitServerReply(profileId, userDataPath, ticket, reply, false)
}

export function flushUnsavedCloudSessions(): void {
  flushUnsavedShieldCloudSessions()
}
