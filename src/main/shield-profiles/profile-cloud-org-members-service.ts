import type {
  ShieldProfileOrgInviteRevokeArgs,
  ShieldProfileOrgMemberChangeRoleArgs,
  ShieldProfileOrgMemberInviteArgs,
  ShieldProfileOrgMemberMutationResult,
  ShieldProfileOrgMemberRemoveArgs,
  ShieldProfileOrgMembersListResult
} from '../../shared/shield-profiles'
import type { ActiveShieldProfileState } from './profile-index-store'
import { ensureActiveShieldProfile } from './profile-index-store'
import type { ShieldCloudAuthConfig } from './profile-cloud-auth-config'
import { getShieldCloudAuthConfig, isShieldCloudDevAuthEnabled } from './profile-cloud-auth-config'
import type { ShieldCloudSession } from './profile-cloud-session-store'
import { ShieldCloudRequestError } from './profile-cloud-client'
import { runWithFreshShieldCloudSession } from './profile-cloud-session-refresh'
import {
  changeShieldCloudOrgMemberRole,
  inviteShieldCloudOrgMember,
  listShieldCloudOrgMembers,
  removeShieldCloudOrgMember,
  revokeShieldCloudOrgInvite
} from './profile-cloud-org-members-client'
import {
  changeDevShieldCloudOrgMemberRole,
  inviteDevShieldCloudOrgMember,
  listDevShieldCloudOrgMembers,
  removeDevShieldCloudOrgMember,
  revokeDevShieldCloudOrgInvite
} from './profile-cloud-dev-org-members'

type OrgCallResult<T> =
  | { status: 'ok'; value: T }
  | { status: 'reconnect-required' }
  | { status: 'request-error'; error: ShieldCloudRequestError }
  | { status: 'failed'; error: string }

// Only 401 should trigger session refresh; return business/permission failures as values.
async function runOrgMemberCall<T>(
  config: ShieldCloudAuthConfig,
  active: ActiveShieldProfileState,
  userDataPath: string,
  call: (session: ShieldCloudSession) => Promise<T>
): Promise<OrgCallResult<T>> {
  try {
    const operation = await runWithFreshShieldCloudSession(
      config,
      active,
      userDataPath,
      async (session) => {
        try {
          return { ok: true as const, value: await call(session) }
        } catch (error) {
          if (error instanceof ShieldCloudRequestError && error.statusCode !== 401) {
            return { ok: false as const, error }
          }
          throw error
        }
      }
    )
    if (operation.status !== 'ok') {
      return { status: 'reconnect-required' }
    }
    const outcome = operation.value
    return outcome.ok
      ? { status: 'ok', value: outcome.value }
      : { status: 'request-error', error: outcome.error }
  } catch (error) {
    return { status: 'failed', error: error instanceof Error ? error.message : String(error) }
  }
}

function mapMutationRequestError(error: ShieldCloudRequestError): ShieldProfileOrgMemberMutationResult {
  switch (error.statusCode) {
    case 403:
      return { status: 'forbidden' }
    case 404:
      return { status: 'not-found' }
    case 409:
      return {
        status: 'conflict',
        reason: error.errorCode === 'already_member' ? 'already_member' : 'already_invited'
      }
    case 400:
      return {
        status: 'invalid',
        reason:
          error.errorCode === 'cannot_remove_self' ? 'cannot_remove_self' : 'cannot_change_own_role'
      }
    default:
      return { status: 'failed', error: error.message }
  }
}

function mapMutationResult(result: OrgCallResult<void>): ShieldProfileOrgMemberMutationResult {
  switch (result.status) {
    case 'ok':
      return { status: 'ok' }
    case 'reconnect-required':
      return { status: 'reconnect-required' }
    case 'request-error':
      return mapMutationRequestError(result.error)
    case 'failed':
      return { status: 'failed', error: result.error }
  }
}

export async function listShieldProfileOrgMembers(
  userDataPath: string,
  orgId: string
): Promise<ShieldProfileOrgMembersListResult> {
  const active = ensureActiveShieldProfile(userDataPath)
  if (isShieldCloudDevAuthEnabled()) {
    return { status: 'ok', roster: listDevShieldCloudOrgMembers(orgId) }
  }
  const configState = getShieldCloudAuthConfig()
  if (!configState.configured) {
    return { status: 'unconfigured' }
  }
  const result = await runOrgMemberCall(configState.config, active, userDataPath, (session) =>
    listShieldCloudOrgMembers(configState.config, session, orgId)
  )
  switch (result.status) {
    case 'ok':
      return { status: 'ok', roster: result.value }
    case 'reconnect-required':
      return { status: 'reconnect-required' }
    case 'request-error':
      return { status: 'failed', error: result.error.message }
    case 'failed':
      return { status: 'failed', error: result.error }
  }
}

export async function inviteShieldProfileOrgMember(
  userDataPath: string,
  args: ShieldProfileOrgMemberInviteArgs
): Promise<ShieldProfileOrgMemberMutationResult> {
  const active = ensureActiveShieldProfile(userDataPath)
  if (isShieldCloudDevAuthEnabled()) {
    return inviteDevShieldCloudOrgMember(args)
  }
  const configState = getShieldCloudAuthConfig()
  if (!configState.configured) {
    return { status: 'unconfigured' }
  }
  return mapMutationResult(
    await runOrgMemberCall(configState.config, active, userDataPath, (session) =>
      inviteShieldCloudOrgMember(configState.config, session, args)
    )
  )
}

export async function revokeShieldProfileOrgInvite(
  userDataPath: string,
  args: ShieldProfileOrgInviteRevokeArgs
): Promise<ShieldProfileOrgMemberMutationResult> {
  const active = ensureActiveShieldProfile(userDataPath)
  if (isShieldCloudDevAuthEnabled()) {
    return revokeDevShieldCloudOrgInvite(args)
  }
  const configState = getShieldCloudAuthConfig()
  if (!configState.configured) {
    return { status: 'unconfigured' }
  }
  return mapMutationResult(
    await runOrgMemberCall(configState.config, active, userDataPath, (session) =>
      revokeShieldCloudOrgInvite(configState.config, session, args)
    )
  )
}

export async function changeShieldProfileOrgMemberRole(
  userDataPath: string,
  args: ShieldProfileOrgMemberChangeRoleArgs
): Promise<ShieldProfileOrgMemberMutationResult> {
  const active = ensureActiveShieldProfile(userDataPath)
  if (isShieldCloudDevAuthEnabled()) {
    return changeDevShieldCloudOrgMemberRole(args)
  }
  const configState = getShieldCloudAuthConfig()
  if (!configState.configured) {
    return { status: 'unconfigured' }
  }
  return mapMutationResult(
    await runOrgMemberCall(configState.config, active, userDataPath, (session) =>
      changeShieldCloudOrgMemberRole(configState.config, session, args)
    )
  )
}

export async function removeShieldProfileOrgMember(
  userDataPath: string,
  args: ShieldProfileOrgMemberRemoveArgs
): Promise<ShieldProfileOrgMemberMutationResult> {
  const active = ensureActiveShieldProfile(userDataPath)
  if (isShieldCloudDevAuthEnabled()) {
    return removeDevShieldCloudOrgMember(args)
  }
  const configState = getShieldCloudAuthConfig()
  if (!configState.configured) {
    return { status: 'unconfigured' }
  }
  return mapMutationResult(
    await runOrgMemberCall(configState.config, active, userDataPath, (session) =>
      removeShieldCloudOrgMember(configState.config, session, args)
    )
  )
}
