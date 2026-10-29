import type { RefreshCurrentShieldProfileAuthResult } from '../../shared/shield-profiles'
import { getShieldCloudAuthConfig, isShieldCloudDevAuthEnabled } from './profile-cloud-auth-config'
import { getShieldProfileAuthStatusFromProfile } from './profile-cloud-auth-status'
import { refreshShieldCloudCapabilities } from './profile-cloud-client'
import { ensureActiveShieldProfile } from './profile-index-store'
import { refreshDevShieldCloudProfile } from './profile-cloud-dev-service'
import {
  commitCloudSessionCapabilities,
  takeCloudSessionTicket,
  type CloudSessionTicket
} from './profile-cloud-session-owner'
import { runWithFreshShieldCloudSession } from './profile-cloud-session-refresh'

export async function refreshCurrentShieldProfileAuth(
  userDataPath: string
): Promise<RefreshCurrentShieldProfileAuthResult> {
  const active = ensureActiveShieldProfile(userDataPath)
  const auth = () => getShieldProfileAuthStatusFromProfile(active, userDataPath)
  if (!active.profile.cloud) {
    return { status: 'local', auth: auth() }
  }
  if (isShieldCloudDevAuthEnabled()) {
    const result = refreshDevShieldCloudProfile(active, userDataPath)
    if (result.status !== 'updated') {
      return { status: 'reconnect-required', auth: auth() }
    }
    return {
      status: 'refreshed',
      auth: auth(),
      activeProfileId: result.list.activeProfileId,
      profiles: result.list.profiles
    }
  }
  const configState = getShieldCloudAuthConfig()
  if (!configState.configured) {
    return { status: 'unconfigured', auth: auth() }
  }
  try {
    const cloud = active.profile.cloud
    let ticket: CloudSessionTicket | undefined
    const operation = await runWithFreshShieldCloudSession(
      configState.config,
      active,
      userDataPath,
      (session) => {
        // Take the ticket after refresh because refreshing may relink the session.
        ticket = takeCloudSessionTicket(active.profile.id, userDataPath)
        return refreshShieldCloudCapabilities(configState.config, session)
      }
    )
    if (operation.status !== 'ok' || !ticket) {
      return { status: 'reconnect-required', auth: auth() }
    }
    const refresh = operation.value
    if (
      refresh.cloud &&
      (refresh.cloud.userId !== cloud.userId ||
        refresh.cloud.cloudProfileId !== cloud.cloudProfileId)
    ) {
      throw new Error('shield_cloud_identity_changed_during_capability_refresh')
    }
    const list = commitCloudSessionCapabilities(active.profile.id, userDataPath, ticket, refresh)
    if (!list) {
      return { status: 'reconnect-required', auth: auth() }
    }
    return {
      status: 'refreshed',
      auth: getShieldProfileAuthStatusFromProfile(
        ensureActiveShieldProfile(userDataPath),
        userDataPath
      ),
      activeProfileId: list.activeProfileId,
      profiles: list.profiles
    }
  } catch (error) {
    return {
      status: 'failed',
      auth: auth(),
      error: error instanceof Error ? error.message : String(error)
    }
  }
}
