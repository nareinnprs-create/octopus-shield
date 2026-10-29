import { OSHIELD_BROWSER_PARTITION } from './constants'
import type { ExecutionHostId } from './execution-host'

export const OSHIELD_PROFILE_INDEX_SCHEMA_VERSION = 1
export const DEFAULT_LOCAL_OSHIELD_PROFILE_ID = 'local-default'
export const DEFAULT_LOCAL_OSHIELD_PROFILE_NAME = 'Personal'
/** Main -> renderer push when the stored auth status changed without the renderer asking. */
export const OSHIELD_PROFILE_AUTH_STATUS_CHANGED_CHANNEL = 'shieldProfiles:authStatusChanged'
export const OSHIELD_PROFILE_SIGN_IN_PROGRESS_CHANGED_CHANNEL = 'shieldProfiles:signInProgressChanged'
const LEGACY_OSHIELD_BROWSER_SESSION_PARTITION_PREFIX = 'persist:shield-browser-session-'

export type ShieldProfileAvatar = {
  kind: 'initials'
  initials: string
  color: 'neutral'
}

export type ShieldProfileKind = 'local' | 'cloud-linked'

export type ShieldProfileCloudSummary = {
  cloudProfileId: string
  userId: string
  email: string
  displayName?: string
  activeOrgId?: string
  activeOrgName?: string
  linkedAt: number
}

export type ShieldCloudOrgSummary = {
  orgId: string
  name: string
  role?: string
}

export type ShieldCloudCapabilityFlags = Record<string, boolean>

export type ShieldCloudCapabilities = {
  flags: ShieldCloudCapabilityFlags
  refreshedAt: number
}

export type ShieldCloudSessionPersistence = 'none' | 'encrypted' | 'memory-only' | 'dev-plaintext'

export type ShieldProfileAuthState = 'local' | 'unconfigured' | 'connected' | 'reconnect-required'

export type ShieldProfileAuthStatus = {
  activeProfileId: string
  configured: boolean
  state: ShieldProfileAuthState
  persistence: ShieldCloudSessionPersistence
  cloud?: ShieldProfileCloudSummary
  organizations?: ShieldCloudOrgSummary[]
  capabilities?: ShieldCloudCapabilities
  credentialError?: string
  setupMessage?: string
}

export type ShieldProfileSummary = {
  id: string
  name: string
  avatar: ShieldProfileAvatar
  kind: ShieldProfileKind
  createdAt: number
  updatedAt: number
  lastOpenedAt: number
  cloud?: ShieldProfileCloudSummary
}

export type ShieldProfileIndex = {
  schemaVersion: number
  activeProfileId: string
  profiles: ShieldProfileSummary[]
}

export type ShieldProfileListState = {
  activeProfileId: string
  profiles: ShieldProfileSummary[]
}

export type ShieldProfileListResult = ShieldProfileListState & {
  // Gate the multi-profile switcher; default builds use one-profile account menus.
  multiProfileUi: boolean
}

export type CreateLocalShieldProfileArgs = {
  name?: string
}

export type CreateLocalShieldProfileResult = ShieldProfileListState & {
  profile: ShieldProfileSummary
}

export type CreateCloudLinkedShieldProfileArgs = {
  orgId?: string
  name?: string
}

export type SwitchShieldProfileArgs = {
  profileId: string
}

export type SwitchShieldProfileResult = {
  status: 'already-active' | 'relaunching'
}

export type TransferShieldProfileProjectMode = 'move' | 'copy'

export type TransferShieldProfileProjectArgs = {
  sourceProfileId: string
  targetProfileId: string
  repoId: string
  mode: TransferShieldProfileProjectMode
}

export type FindShieldProfileProjectsByPathArgs = {
  path: string
  connectionId?: string | null
  executionHostId?: ExecutionHostId | null
  excludeProfileId?: string | null
}

export type ShieldProfileProjectPresence = {
  profileId: string
  profileName: string
  profileKind: ShieldProfileKind
  repoId: string
  repoName: string
}

export type FindShieldProfileProjectsByPathResult = {
  projects: ShieldProfileProjectPresence[]
}

export type TransferShieldProfileProjectResult =
  | {
      status: 'transferred'
      mode: TransferShieldProfileProjectMode
      sourceProfileId: string
      targetProfileId: string
      sourceRepoId: string
      targetRepoId: string
      targetProjectId: string | null
      willRelaunch?: boolean
    }
  | {
      status: 'duplicate-target'
      sourceProfileId: string
      targetProfileId: string
      sourceRepoId: string
      duplicateRepoId: string
    }

/** A sign-in in flight; `link` is set only while the browser has not answered yet. */
export type ShieldCloudSignInProgress = { link: string | null }

export type ConnectCurrentShieldProfileResult =
  | {
      status: 'connected'
      auth: ShieldProfileAuthStatus
      activeProfileId: string
      profiles: ShieldProfileSummary[]
    }
  | {
      status: 'unconfigured'
      auth: ShieldProfileAuthStatus
    }
  | {
      status: 'cancelled'
      auth: ShieldProfileAuthStatus
    }
  | {
      status: 'timed-out'
      auth: ShieldProfileAuthStatus
    }
  | {
      status: 'failed'
      auth: ShieldProfileAuthStatus
      error: string
    }

export type CreateCloudLinkedShieldProfileResult =
  | {
      status: 'created'
      auth: ShieldProfileAuthStatus
      activeProfileId: string
      profiles: ShieldProfileSummary[]
      profile: ShieldProfileSummary
    }
  | {
      status: 'unconfigured' | 'reconnect-required'
      auth: ShieldProfileAuthStatus
    }
  | {
      status: 'failed'
      auth: ShieldProfileAuthStatus
      error: string
    }

export type SignOutCurrentShieldProfileResult = {
  status: 'signed-out'
  auth: ShieldProfileAuthStatus
  activeProfileId: string
  profiles: ShieldProfileSummary[]
}

export type SelectShieldProfileOrgArgs = {
  orgId: string
}

export type SelectShieldProfileOrgResult =
  | {
      status: 'selected'
      auth: ShieldProfileAuthStatus
      activeProfileId: string
      profiles: ShieldProfileSummary[]
    }
  | {
      status: 'unconfigured' | 'reconnect-required'
      auth: ShieldProfileAuthStatus
    }
  | {
      status: 'failed'
      auth: ShieldProfileAuthStatus
      error: string
    }

export type RefreshCurrentShieldProfileAuthResult =
  | {
      status: 'refreshed'
      auth: ShieldProfileAuthStatus
      activeProfileId: string
      profiles: ShieldProfileSummary[]
    }
  | {
      status: 'local' | 'unconfigured' | 'reconnect-required'
      auth: ShieldProfileAuthStatus
    }
  | {
      status: 'failed'
      auth: ShieldProfileAuthStatus
      error: string
    }

// Mirror the server’s fixed role enum so UI options cannot drift from accepted API values.
export type ShieldOrgRole = 'owner' | 'admin' | 'member'

export type ShieldOrgMember = {
  // Provisioned teammates without sign-in have no userId; disable mutations requiring that key.
  userId: string | null
  email: string
  displayName?: string
  role: ShieldOrgRole
}

export type ShieldOrgPendingInvite = {
  email: string
  role: ShieldOrgRole
  createdAt: number
}

export type ShieldOrgMembersRoster = {
  members: ShieldOrgMember[]
  pendingInvites: ShieldOrgPendingInvite[]
  viewerRole: ShieldOrgRole
  canManageMembers: boolean
}

export type ShieldProfileOrgMembersListArgs = {
  orgId: string
}

export type ShieldProfileOrgMemberInviteArgs = {
  orgId: string
  email: string
  role: ShieldOrgRole
}

export type ShieldProfileOrgInviteRevokeArgs = {
  orgId: string
  email: string
}

export type ShieldProfileOrgMemberChangeRoleArgs = {
  orgId: string
  userId: string
  role: ShieldOrgRole
}

export type ShieldProfileOrgMemberRemoveArgs = {
  orgId: string
  userId: string
}

export type ShieldProfileOrgMembersListResult =
  | { status: 'ok'; roster: ShieldOrgMembersRoster }
  | { status: 'unconfigured' | 'reconnect-required' }
  | { status: 'failed'; error: string }

export type ShieldOrgInviteConflictReason = 'already_member' | 'already_invited'
export type ShieldOrgMutationInvalidReason = 'cannot_change_own_role' | 'cannot_remove_self'

export type ShieldProfileOrgMemberMutationResult =
  | { status: 'ok' }
  | { status: 'unconfigured' | 'reconnect-required' | 'forbidden' | 'not-found' }
  | { status: 'conflict'; reason: ShieldOrgInviteConflictReason }
  | { status: 'invalid'; reason: ShieldOrgMutationInvalidReason }
  | { status: 'failed'; error: string }

export function createDefaultLocalShieldProfile(now: number): ShieldProfileSummary {
  return {
    id: DEFAULT_LOCAL_OSHIELD_PROFILE_ID,
    name: DEFAULT_LOCAL_OSHIELD_PROFILE_NAME,
    avatar: { kind: 'initials', initials: 'P', color: 'neutral' },
    kind: 'local',
    createdAt: now,
    updatedAt: now,
    lastOpenedAt: now
  }
}

function profilePartitionHash(value: string): string {
  let hash = 2166136261
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

export function getShieldProfileBrowserPartitionSegment(profileId: string): string {
  const safe = profileId.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 48) || 'profile'
  return `${safe}-${profilePartitionHash(profileId)}`
}

export function getShieldProfileBrowserDefaultPartition(profileId: string): string {
  if (profileId === DEFAULT_LOCAL_OSHIELD_PROFILE_ID) {
    return OSHIELD_BROWSER_PARTITION
  }
  return `persist:shield-profile-${getShieldProfileBrowserPartitionSegment(profileId)}-browser-default`
}

export function getShieldProfileBrowserSessionPartition(
  profileId: string,
  browserSessionProfileId: string
): string {
  if (profileId === DEFAULT_LOCAL_OSHIELD_PROFILE_ID) {
    return `${LEGACY_OSHIELD_BROWSER_SESSION_PARTITION_PREFIX}${browserSessionProfileId}`
  }
  return `persist:shield-profile-${getShieldProfileBrowserPartitionSegment(
    profileId
  )}-browser-session-${browserSessionProfileId}`
}
