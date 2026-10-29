import type {
  ConnectCurrentShieldProfileResult,
  CreateCloudLinkedShieldProfileArgs,
  CreateCloudLinkedShieldProfileResult,
  ShieldProfileAuthStatus,
  SelectShieldProfileOrgResult,
  SignOutCurrentShieldProfileResult
} from '../../shared/shield-profiles'
import { ensureActiveShieldProfile } from './profile-index-store'
import { getShieldCloudAuthConfig, isShieldCloudDevAuthEnabled } from './profile-cloud-auth-config'
import {
  invalidateCloudSessionChanges,
  readCloudSession,
  signInCloudSession,
  signOutCloudSession
} from './profile-cloud-session-owner'
import {
  createShieldCloudProfile,
  exchangeShieldCloudAuthCode,
  revokeShieldCloudSession
} from './profile-cloud-client'
import { beginShieldCloudPkceFlow } from './profile-cloud-pkce'
import {
  createCloudLinkedShieldProfileRecord,
  linkShieldProfileToCloud,
  unlinkShieldProfileFromCloud
} from './profile-cloud-index'
import { runWithFreshShieldCloudSession } from './profile-cloud-session-refresh'
import {
  connectDevShieldCloudProfile,
  createDevCloudLinkedShieldProfile,
  selectDevShieldCloudOrg
} from './profile-cloud-dev-service'
import { getShieldProfileAuthStatusFromProfile } from './profile-cloud-auth-status'
import { selectCloudOrg } from './profile-cloud-org-selection'
import {
  endShieldCloudSignInProgress,
  setShieldCloudSignInLink,
  startShieldCloudSignInProgress
} from './profile-cloud-sign-in-progress'
import { clearRelayRegionPreferenceCache } from '../runtime/mobile-cloud-relay/relay-region-preference'

export { refreshCurrentShieldProfileAuth } from './profile-cloud-capability-refresh'

let nextCloudConnectAttempt = 0
let linkedCloudConnectAttempt = 0

function invalidateOutstandingCloudConnectAttempts(): void {
  nextCloudConnectAttempt += 1
  linkedCloudConnectAttempt = nextCloudConnectAttempt
  endShieldCloudSignInProgress()
}

function activeAuth(
  active: ReturnType<typeof ensureActiveShieldProfile>,
  userDataPath: string
): ShieldProfileAuthStatus {
  return getShieldProfileAuthStatusFromProfile(active, userDataPath)
}

export function getCurrentShieldProfileAuthStatus(userDataPath: string): ShieldProfileAuthStatus {
  return getShieldProfileAuthStatusFromProfile(ensureActiveShieldProfile(userDataPath), userDataPath)
}

export async function connectCurrentShieldProfile(
  userDataPath: string
): Promise<ConnectCurrentShieldProfileResult> {
  const active = ensureActiveShieldProfile(userDataPath)
  if (isShieldCloudDevAuthEnabled()) {
    const list = connectDevShieldCloudProfile(active, userDataPath)
    return {
      status: 'connected',
      auth: getCurrentShieldProfileAuthStatus(userDataPath),
      activeProfileId: list.activeProfileId,
      profiles: list.profiles
    }
  }

  const configState = getShieldCloudAuthConfig()
  if (!configState.configured) {
    return {
      status: 'unconfigured',
      auth: activeAuth(active, userDataPath)
    }
  }

  const attempt = ++nextCloudConnectAttempt
  const browserWait = new AbortController()
  startShieldCloudSignInProgress(attempt, () => browserWait.abort())
  try {
    const code = await beginShieldCloudPkceFlow(configState.config, active.profile.id, {
      signal: browserWait.signal,
      onAuthorizeUrl: (link) => setShieldCloudSignInLink(attempt, link)
    })
    // The callback listener has closed, so its browser link is dead.
    setShieldCloudSignInLink(attempt, null)
    if (attempt < linkedCloudConnectAttempt) {
      return {
        status: 'cancelled',
        auth: getCurrentShieldProfileAuthStatus(userDataPath)
      }
    }
    const exchange = await exchangeShieldCloudAuthCode(configState.config, {
      ...code,
      localProfileId: active.profile.id
    })
    if (attempt < linkedCloudConnectAttempt) {
      return {
        status: 'cancelled',
        auth: getCurrentShieldProfileAuthStatus(userDataPath)
      }
    }
    signInCloudSession(active.profile.id, userDataPath, exchange)
    const list = linkShieldProfileToCloud(active.profile.id, exchange.cloud, userDataPath)
    linkedCloudConnectAttempt = attempt
    return {
      status: 'connected',
      auth: getCurrentShieldProfileAuthStatus(userDataPath),
      activeProfileId: list.activeProfileId,
      profiles: list.profiles
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message === 'shield_cloud_auth_timeout' && attempt === nextCloudConnectAttempt) {
      return {
        status: 'timed-out',
        auth: getCurrentShieldProfileAuthStatus(userDataPath)
      }
    }
    if (
      message === 'shield_cloud_auth_timeout' ||
      message === 'shield_cloud_auth_denied' ||
      message === 'shield_cloud_auth_cancelled'
    ) {
      return {
        status: 'cancelled',
        auth: getCurrentShieldProfileAuthStatus(userDataPath)
      }
    }
    return {
      status: 'failed',
      auth: getCurrentShieldProfileAuthStatus(userDataPath),
      error: message
    }
  } finally {
    endShieldCloudSignInProgress(attempt)
  }
}

export async function signOutCurrentShieldProfile(
  userDataPath: string
): Promise<SignOutCurrentShieldProfileResult> {
  // Pending browser sign-ins must not relink after explicit sign-out.
  invalidateOutstandingCloudConnectAttempts()
  const signOutEpoch = linkedCloudConnectAttempt
  const active = ensureActiveShieldProfile(userDataPath)
  const configState = getShieldCloudAuthConfig()
  const session = readCloudSession(active.profile.id, userDataPath)
  // Fence before network I/O so in-flight refreshes cannot save after sign-out.
  invalidateCloudSessionChanges(active.profile.id, userDataPath)
  if (!isShieldCloudDevAuthEnabled() && configState.configured && session.status === 'found') {
    await revokeShieldCloudSession(configState.config, session.session).catch(() => undefined)
  }
  if (linkedCloudConnectAttempt > signOutEpoch) {
    const current = ensureActiveShieldProfile(userDataPath)
    return {
      status: 'signed-out',
      auth: getCurrentShieldProfileAuthStatus(userDataPath),
      activeProfileId: current.index.activeProfileId,
      profiles: current.index.profiles
    }
  }
  signOutCloudSession(active.profile.id, userDataPath)
  const list = unlinkShieldProfileFromCloud(active.profile.id, userDataPath)
  try {
    clearRelayRegionPreferenceCache(userDataPath)
  } catch {
    // A leftover latency cache must not fail the sign-out itself.
  }
  return {
    status: 'signed-out',
    auth: getCurrentShieldProfileAuthStatus(userDataPath),
    activeProfileId: list.activeProfileId,
    profiles: list.profiles
  }
}

export async function createCloudLinkedShieldProfile(
  userDataPath: string,
  args: CreateCloudLinkedShieldProfileArgs
): Promise<CreateCloudLinkedShieldProfileResult> {
  const active = ensureActiveShieldProfile(userDataPath)
  if (isShieldCloudDevAuthEnabled()) {
    const result = createDevCloudLinkedShieldProfile(active, userDataPath, args)
    if (result.status !== 'created') {
      return { status: 'reconnect-required', auth: activeAuth(active, userDataPath) }
    }
    return {
      status: 'created',
      auth: getCurrentShieldProfileAuthStatus(userDataPath),
      activeProfileId: result.list.activeProfileId,
      profiles: result.list.profiles,
      profile: result.list.profile
    }
  }

  const configState = getShieldCloudAuthConfig()
  if (!configState.configured) {
    return { status: 'unconfigured', auth: activeAuth(active, userDataPath) }
  }
  try {
    const operation = await runWithFreshShieldCloudSession(
      configState.config,
      active,
      userDataPath,
      (session) => createShieldCloudProfile(configState.config, session, args)
    )
    if (operation.status !== 'ok') {
      return { status: 'reconnect-required', auth: activeAuth(active, userDataPath) }
    }
    const created = operation.value
    const list = createCloudLinkedShieldProfileRecord(
      created.cloud,
      { name: args.name },
      userDataPath
    )
    signInCloudSession(list.profile.id, userDataPath, created)
    return {
      status: 'created',
      auth: getCurrentShieldProfileAuthStatus(userDataPath),
      activeProfileId: list.activeProfileId,
      profiles: list.profiles,
      profile: list.profile
    }
  } catch (error) {
    return {
      status: 'failed',
      auth: getCurrentShieldProfileAuthStatus(userDataPath),
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

export async function selectCurrentShieldProfileOrg(
  userDataPath: string,
  orgId: string
): Promise<SelectShieldProfileOrgResult> {
  const active = ensureActiveShieldProfile(userDataPath)
  if (isShieldCloudDevAuthEnabled()) {
    const result = selectDevShieldCloudOrg(active, userDataPath, orgId)
    if (result.status !== 'updated') {
      return { status: 'reconnect-required', auth: activeAuth(active, userDataPath) }
    }
    return {
      status: 'selected',
      auth: getCurrentShieldProfileAuthStatus(userDataPath),
      activeProfileId: result.list.activeProfileId,
      profiles: result.list.profiles
    }
  }

  const configState = getShieldCloudAuthConfig()
  if (!configState.configured) {
    return { status: 'unconfigured', auth: activeAuth(active, userDataPath) }
  }
  try {
    const list = await selectCloudOrg({
      config: configState.config,
      active,
      userDataPath,
      orgId
    })
    if (!list) {
      return { status: 'reconnect-required', auth: activeAuth(active, userDataPath) }
    }
    return {
      status: 'selected',
      auth: getCurrentShieldProfileAuthStatus(userDataPath),
      activeProfileId: list.activeProfileId,
      profiles: list.profiles
    }
  } catch (error) {
    return {
      status: 'failed',
      auth: getCurrentShieldProfileAuthStatus(userDataPath),
      error: error instanceof Error ? error.message : String(error)
    }
  }
}
