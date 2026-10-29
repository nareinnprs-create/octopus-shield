import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  handlers,
  listShieldProfileOrgMembersMock,
  inviteShieldProfileOrgMemberMock,
  revokeShieldProfileOrgInviteMock,
  changeShieldProfileOrgMemberRoleMock,
  removeShieldProfileOrgMemberMock
} = vi.hoisted(() => ({
  handlers: new Map<string, (_event: unknown, args?: unknown) => unknown>(),
  listShieldProfileOrgMembersMock: vi.fn(),
  inviteShieldProfileOrgMemberMock: vi.fn(),
  revokeShieldProfileOrgInviteMock: vi.fn(),
  changeShieldProfileOrgMemberRoleMock: vi.fn(),
  removeShieldProfileOrgMemberMock: vi.fn()
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (_event: unknown, args?: unknown) => unknown) => {
      handlers.set(channel, handler)
    })
  }
}))

vi.mock('../shield-profiles/profile-storage-paths', () => ({
  getProfileUserDataPath: () => '/tmp/shield-user-data'
}))

vi.mock('../shield-profiles/profile-cloud-org-members-service', () => ({
  listShieldProfileOrgMembers: listShieldProfileOrgMembersMock,
  inviteShieldProfileOrgMember: inviteShieldProfileOrgMemberMock,
  revokeShieldProfileOrgInvite: revokeShieldProfileOrgInviteMock,
  changeShieldProfileOrgMemberRole: changeShieldProfileOrgMemberRoleMock,
  removeShieldProfileOrgMember: removeShieldProfileOrgMemberMock
}))

import { registerShieldProfileOrgMemberHandlers } from './shield-profile-org-members-handlers'

function invoke(channel: string, args?: unknown): unknown {
  const handler = handlers.get(channel)
  if (!handler) {
    throw new Error(`No handler for ${channel}`)
  }
  return handler({}, args)
}

describe('registerShieldProfileOrgMemberHandlers', () => {
  beforeEach(() => {
    handlers.clear()
    listShieldProfileOrgMembersMock.mockReset().mockResolvedValue({ status: 'ok', roster: {} })
    inviteShieldProfileOrgMemberMock.mockReset().mockResolvedValue({ status: 'ok' })
    revokeShieldProfileOrgInviteMock.mockReset().mockResolvedValue({ status: 'ok' })
    changeShieldProfileOrgMemberRoleMock.mockReset().mockResolvedValue({ status: 'ok' })
    removeShieldProfileOrgMemberMock.mockReset().mockResolvedValue({ status: 'ok' })
    registerShieldProfileOrgMemberHandlers()
  })

  it('registers all five org-member channels', () => {
    expect([...handlers.keys()].sort()).toEqual(
      [
        'shieldProfiles:orgInviteRevoke',
        'shieldProfiles:orgMemberChangeRole',
        'shieldProfiles:orgMemberInvite',
        'shieldProfiles:orgMemberRemove',
        'shieldProfiles:orgMembersList'
      ].sort()
    )
  })

  it('forwards a valid invite to the service with a trimmed email', async () => {
    await invoke('shieldProfiles:orgMemberInvite', {
      orgId: 'org-1',
      email: '  new@example.com  ',
      role: 'admin'
    })
    expect(inviteShieldProfileOrgMemberMock).toHaveBeenCalledWith('/tmp/shield-user-data', {
      orgId: 'org-1',
      email: 'new@example.com',
      role: 'admin'
    })
  })

  it('rejects an invite with a missing org id', async () => {
    await expect(
      invoke('shieldProfiles:orgMemberInvite', { email: 'a@b.com', role: 'member' })
    ).rejects.toThrow('invalid_shield_profile_org_selection')
    expect(inviteShieldProfileOrgMemberMock).not.toHaveBeenCalled()
  })

  it('rejects an invite with an unknown role', async () => {
    await expect(
      invoke('shieldProfiles:orgMemberInvite', { orgId: 'org-1', email: 'a@b.com', role: 'root' })
    ).rejects.toThrow('invalid_shield_org_role')
  })

  it('rejects a role change with a blank user id', async () => {
    await expect(
      invoke('shieldProfiles:orgMemberChangeRole', { orgId: 'org-1', userId: '  ', role: 'admin' })
    ).rejects.toThrow('invalid_shield_org_member_user')
  })

  it('forwards remove and revoke with validated args', async () => {
    await invoke('shieldProfiles:orgMemberRemove', { orgId: 'org-1', userId: 'user-2' })
    expect(removeShieldProfileOrgMemberMock).toHaveBeenCalledWith('/tmp/shield-user-data', {
      orgId: 'org-1',
      userId: 'user-2'
    })
    await invoke('shieldProfiles:orgInviteRevoke', { orgId: 'org-1', email: 'gone@b.com' })
    expect(revokeShieldProfileOrgInviteMock).toHaveBeenCalledWith('/tmp/shield-user-data', {
      orgId: 'org-1',
      email: 'gone@b.com'
    })
  })
})
