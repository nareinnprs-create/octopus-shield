import { ipcMain } from 'electron'
import type {
  ShieldOrgRole,
  ShieldProfileOrgInviteRevokeArgs,
  ShieldProfileOrgMemberChangeRoleArgs,
  ShieldProfileOrgMemberInviteArgs,
  ShieldProfileOrgMemberMutationResult,
  ShieldProfileOrgMemberRemoveArgs,
  ShieldProfileOrgMembersListArgs,
  ShieldProfileOrgMembersListResult
} from '../../shared/shield-profiles'
import { getProfileUserDataPath } from '../shield-profiles/profile-storage-paths'
import {
  changeShieldProfileOrgMemberRole,
  inviteShieldProfileOrgMember,
  listShieldProfileOrgMembers,
  removeShieldProfileOrgMember,
  revokeShieldProfileOrgInvite
} from '../shield-profiles/profile-cloud-org-members-service'

function orgMembersScopedArgs(args: unknown): { orgId: string; record: Record<string, unknown> } {
  if (!args || typeof args !== 'object') {
    throw new Error('invalid_shield_profile_org_selection')
  }
  const record = args as Record<string, unknown>
  const orgId = typeof record.orgId === 'string' ? record.orgId.trim() : ''
  if (!orgId) {
    throw new Error('invalid_shield_profile_org_selection')
  }
  return { orgId, record }
}

function orgRoleFromUnknown(value: unknown): ShieldOrgRole {
  if (value === 'owner' || value === 'admin' || value === 'member') {
    return value
  }
  throw new Error('invalid_shield_org_role')
}

function orgEmailFromUnknown(value: unknown): string {
  const email = typeof value === 'string' ? value.trim() : ''
  if (!email) {
    throw new Error('invalid_shield_org_member_email')
  }
  return email
}

function orgUserIdFromUnknown(value: unknown): string {
  const userId = typeof value === 'string' ? value.trim() : ''
  if (!userId) {
    throw new Error('invalid_shield_org_member_user')
  }
  return userId
}

function orgMemberInviteArgsFromUnknown(args: unknown): ShieldProfileOrgMemberInviteArgs {
  const { orgId, record } = orgMembersScopedArgs(args)
  return { orgId, email: orgEmailFromUnknown(record.email), role: orgRoleFromUnknown(record.role) }
}

function orgInviteRevokeArgsFromUnknown(args: unknown): ShieldProfileOrgInviteRevokeArgs {
  const { orgId, record } = orgMembersScopedArgs(args)
  return { orgId, email: orgEmailFromUnknown(record.email) }
}

function orgMemberChangeRoleArgsFromUnknown(args: unknown): ShieldProfileOrgMemberChangeRoleArgs {
  const { orgId, record } = orgMembersScopedArgs(args)
  return {
    orgId,
    userId: orgUserIdFromUnknown(record.userId),
    role: orgRoleFromUnknown(record.role)
  }
}

function orgMemberRemoveArgsFromUnknown(args: unknown): ShieldProfileOrgMemberRemoveArgs {
  const { orgId, record } = orgMembersScopedArgs(args)
  return { orgId, userId: orgUserIdFromUnknown(record.userId) }
}

export function registerShieldProfileOrgMemberHandlers(): void {
  ipcMain.handle(
    'shieldProfiles:orgMembersList',
    async (
      _event,
      rawArgs: ShieldProfileOrgMembersListArgs
    ): Promise<ShieldProfileOrgMembersListResult> =>
      listShieldProfileOrgMembers(getProfileUserDataPath(), orgMembersScopedArgs(rawArgs).orgId)
  )

  ipcMain.handle(
    'shieldProfiles:orgMemberInvite',
    async (
      _event,
      rawArgs: ShieldProfileOrgMemberInviteArgs
    ): Promise<ShieldProfileOrgMemberMutationResult> =>
      inviteShieldProfileOrgMember(getProfileUserDataPath(), orgMemberInviteArgsFromUnknown(rawArgs))
  )

  ipcMain.handle(
    'shieldProfiles:orgInviteRevoke',
    async (
      _event,
      rawArgs: ShieldProfileOrgInviteRevokeArgs
    ): Promise<ShieldProfileOrgMemberMutationResult> =>
      revokeShieldProfileOrgInvite(getProfileUserDataPath(), orgInviteRevokeArgsFromUnknown(rawArgs))
  )

  ipcMain.handle(
    'shieldProfiles:orgMemberChangeRole',
    async (
      _event,
      rawArgs: ShieldProfileOrgMemberChangeRoleArgs
    ): Promise<ShieldProfileOrgMemberMutationResult> =>
      changeShieldProfileOrgMemberRole(
        getProfileUserDataPath(),
        orgMemberChangeRoleArgsFromUnknown(rawArgs)
      )
  )

  ipcMain.handle(
    'shieldProfiles:orgMemberRemove',
    async (
      _event,
      rawArgs: ShieldProfileOrgMemberRemoveArgs
    ): Promise<ShieldProfileOrgMemberMutationResult> =>
      removeShieldProfileOrgMember(getProfileUserDataPath(), orgMemberRemoveArgsFromUnknown(rawArgs))
  )
}
