import type {
  ShieldCloudSignInProgress,
  ConnectCurrentShieldProfileResult,
  CreateCloudLinkedShieldProfileArgs,
  CreateCloudLinkedShieldProfileResult,
  CreateLocalShieldProfileArgs,
  CreateLocalShieldProfileResult,
  FindShieldProfileProjectsByPathArgs,
  FindShieldProfileProjectsByPathResult,
  ShieldProfileAuthStatus,
  ShieldProfileListResult,
  ShieldProfileOrgInviteRevokeArgs,
  ShieldProfileOrgMemberChangeRoleArgs,
  ShieldProfileOrgMemberInviteArgs,
  ShieldProfileOrgMemberMutationResult,
  ShieldProfileOrgMemberRemoveArgs,
  ShieldProfileOrgMembersListArgs,
  ShieldProfileOrgMembersListResult,
  RefreshCurrentShieldProfileAuthResult,
  SelectShieldProfileOrgArgs,
  SelectShieldProfileOrgResult,
  SignOutCurrentShieldProfileResult,
  SwitchShieldProfileArgs,
  SwitchShieldProfileResult,
  TransferShieldProfileProjectArgs,
  TransferShieldProfileProjectResult
} from '../../shared/shield-profiles'

export type ShieldProfileApi = {
  list: () => Promise<ShieldProfileListResult>
  authStatus: () => Promise<ShieldProfileAuthStatus>
  /** Fires when main changed the stored auth status on its own (e.g. a revoked session). */
  onAuthStatusChanged: (callback: () => void) => () => void
  createLocal: (args?: CreateLocalShieldProfileArgs) => Promise<CreateLocalShieldProfileResult>
  createCloudLinked: (
    args?: CreateCloudLinkedShieldProfileArgs
  ) => Promise<CreateCloudLinkedShieldProfileResult>
  switchProfile: (args: SwitchShieldProfileArgs) => Promise<SwitchShieldProfileResult>
  transferProject: (
    args: TransferShieldProfileProjectArgs
  ) => Promise<TransferShieldProfileProjectResult>
  findProjectProfiles: (
    args: FindShieldProfileProjectsByPathArgs
  ) => Promise<FindShieldProfileProjectsByPathResult>
  connectCurrent: () => Promise<ConnectCurrentShieldProfileResult>
  signInProgress: () => Promise<ShieldCloudSignInProgress | null>
  onSignInProgressChanged: (
    callback: (progress: ShieldCloudSignInProgress | null) => void
  ) => () => void
  cancelSignIn: () => Promise<void>
  refreshAuth: () => Promise<RefreshCurrentShieldProfileAuthResult>
  signOutCurrent: () => Promise<SignOutCurrentShieldProfileResult>
  selectOrg: (args: SelectShieldProfileOrgArgs) => Promise<SelectShieldProfileOrgResult>
  orgMembersList: (args: ShieldProfileOrgMembersListArgs) => Promise<ShieldProfileOrgMembersListResult>
  orgMemberInvite: (
    args: ShieldProfileOrgMemberInviteArgs
  ) => Promise<ShieldProfileOrgMemberMutationResult>
  orgInviteRevoke: (
    args: ShieldProfileOrgInviteRevokeArgs
  ) => Promise<ShieldProfileOrgMemberMutationResult>
  orgMemberChangeRole: (
    args: ShieldProfileOrgMemberChangeRoleArgs
  ) => Promise<ShieldProfileOrgMemberMutationResult>
  orgMemberRemove: (
    args: ShieldProfileOrgMemberRemoveArgs
  ) => Promise<ShieldProfileOrgMemberMutationResult>
}
