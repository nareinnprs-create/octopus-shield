import type { PreloadApi } from '../../../../preload/api-types'
import {
  DEFAULT_LOCAL_OSHIELD_PROFILE_ID,
  createDefaultLocalShieldProfile
} from '../../../../shared/shield-profiles'
import { noopUnsubscribe } from './web-storage'

export function createWebShieldProfilesApi(): Partial<PreloadApi> {
  const webShieldProfileAuthStatus = () =>
    Promise.resolve({
      activeProfileId: DEFAULT_LOCAL_OSHIELD_PROFILE_ID,
      configured: false,
      state: 'unconfigured' as const,
      persistence: 'none' as const,
      setupMessage: 'Shield Cloud sign-in is not available in the browser fallback.'
    })
  return {
    shieldProfiles: {
      list: () =>
        Promise.resolve({
          activeProfileId: DEFAULT_LOCAL_OSHIELD_PROFILE_ID,
          profiles: [createDefaultLocalShieldProfile(0)],
          multiProfileUi: false
        }),
      authStatus: webShieldProfileAuthStatus,
      onAuthStatusChanged: () => noopUnsubscribe,
      onSignInProgressChanged: () => noopUnsubscribe,
      createLocal: () =>
        Promise.resolve({
          activeProfileId: DEFAULT_LOCAL_OSHIELD_PROFILE_ID,
          profiles: [createDefaultLocalShieldProfile(0)],
          profile: createDefaultLocalShieldProfile(0)
        }),
      createCloudLinked: async () => ({
        status: 'unconfigured',
        auth: await webShieldProfileAuthStatus()
      }),
      switchProfile: () => Promise.resolve({ status: 'already-active' }),
      transferProject: (args) =>
        Promise.resolve({
          status: 'duplicate-target',
          sourceProfileId: args.sourceProfileId,
          targetProfileId: args.targetProfileId,
          sourceRepoId: args.repoId,
          duplicateRepoId: args.repoId
        }),
      findProjectProfiles: async () => ({ projects: [] }),
      connectCurrent: async () => ({
        status: 'unconfigured',
        auth: await webShieldProfileAuthStatus()
      }),
      signInProgress: async () => null,
      cancelSignIn: async () => {},
      refreshAuth: async () => ({
        status: 'unconfigured',
        auth: await webShieldProfileAuthStatus()
      }),
      signOutCurrent: async () => ({
        status: 'signed-out',
        auth: await webShieldProfileAuthStatus(),
        activeProfileId: DEFAULT_LOCAL_OSHIELD_PROFILE_ID,
        profiles: [createDefaultLocalShieldProfile(0)]
      }),
      selectOrg: async () => ({
        status: 'unconfigured',
        auth: await webShieldProfileAuthStatus()
      }),
      orgMembersList: async () => ({ status: 'unconfigured' }),
      orgMemberInvite: async () => ({ status: 'unconfigured' }),
      orgInviteRevoke: async () => ({ status: 'unconfigured' }),
      orgMemberChangeRole: async () => ({ status: 'unconfigured' }),
      orgMemberRemove: async () => ({ status: 'unconfigured' })
    }
  }
}
