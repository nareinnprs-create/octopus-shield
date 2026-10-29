import type { StateCreator } from 'zustand'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import type {
  ConnectCurrentShieldProfileResult,
  CreateCloudLinkedShieldProfileResult,
  RefreshCurrentShieldProfileAuthResult,
  SelectShieldProfileOrgResult,
  SignOutCurrentShieldProfileResult
} from '../../../../shared/shield-profiles'
import type { AppState } from '../types'

export type ShieldProfilesAuthActions = {
  createCloudLinkedShieldProfile: (args: {
    orgId?: string
    name?: string
  }) => Promise<CreateCloudLinkedShieldProfileResult | null>
  connectCurrentShieldProfile: () => Promise<ConnectCurrentShieldProfileResult | null>
  refreshCurrentShieldProfileAuth: () => Promise<RefreshCurrentShieldProfileAuthResult | null>
  signOutCurrentShieldProfile: () => Promise<SignOutCurrentShieldProfileResult | null>
  selectShieldProfileOrg: (orgId: string) => Promise<SelectShieldProfileOrgResult | null>
}

export const createShieldProfilesAuthActions: StateCreator<
  AppState,
  [],
  [],
  ShieldProfilesAuthActions
> = (set, get) => {
  let nextConnectAttempt = 0
  let appliedConnectAttempt = 0

  return {
    createCloudLinkedShieldProfile: async (args) => {
      try {
        const result = await window.api.shieldProfiles.createCloudLinked(args)
        set({
          shieldProfileAuthStatus: result.auth,
          ...(result.status === 'created'
            ? {
                activeShieldProfileId: result.activeProfileId,
                shieldProfiles: result.profiles
              }
            : {})
        })
        if (result.status === 'created') {
          toast.success(
            translate('auto.store.slices.shield.profiles.319d7cf39b', 'Cloud profile created')
          )
        } else if (result.status === 'reconnect-required') {
          toast.error(
            translate('auto.store.slices.shield.profiles.d6e764e7db', 'Reconnect this profile')
          )
        } else if (result.status === 'failed') {
          toast.error(
            translate(
              'auto.store.slices.shield.profiles.f0c9e11a6d',
              'Failed to create cloud profile'
            ),
            { description: result.error }
          )
        }
        return result
      } catch (err) {
        console.error('Failed to create Shield cloud profile:', err)
        toast.error(
          translate('auto.store.slices.shield.profiles.f0c9e11a6d', 'Failed to create cloud profile'),
          {
            description: err instanceof Error ? err.message : String(err)
          }
        )
        return null
      }
    },

    connectCurrentShieldProfile: async () => {
      const attempt = ++nextConnectAttempt
      try {
        // Pending PKCE must not block retry; newer linked waits supersede older callbacks.
        const result = await window.api.shieldProfiles.connectCurrent()
        if (attempt < appliedConnectAttempt) {
          return result
        }
        const alreadyConnected = get().shieldProfileAuthStatus?.state === 'connected'
        set({
          shieldProfileAuthStatus: result.auth,
          ...(result.status === 'connected'
            ? {
                activeShieldProfileId: result.activeProfileId,
                shieldProfiles: result.profiles
              }
            : {})
        })
        if (result.status === 'connected') {
          appliedConnectAttempt = attempt
          if (!alreadyConnected) {
            toast.success(
              translate('auto.store.slices.shield.profiles.9fcb07a796', 'Profile connected')
            )
          }
        } else if (result.status === 'unconfigured') {
          toast.error(
            translate(
              'auto.store.slices.shield.profiles.8b8fa73174',
              'Shield Cloud sign-in is not configured'
            ),
            {
              description: result.auth.setupMessage
            }
          )
        } else if (result.status === 'timed-out' && !alreadyConnected) {
          toast.error(
            translate('auto.store.slices.shield.profiles.signInTimedOut', 'Sign-in timed out')
          )
        } else if (
          result.status === 'failed' &&
          !alreadyConnected &&
          result.auth.state !== 'connected'
        ) {
          toast.error(
            translate('auto.store.slices.shield.profiles.33290e88ed', 'Failed to connect profile'),
            { description: result.error }
          )
        }
        return result
      } catch (err) {
        console.error('Failed to connect Shield profile:', err)
        if (
          attempt >= appliedConnectAttempt &&
          get().shieldProfileAuthStatus?.state !== 'connected'
        ) {
          toast.error(
            translate('auto.store.slices.shield.profiles.33290e88ed', 'Failed to connect profile'),
            {
              description: err instanceof Error ? err.message : String(err)
            }
          )
        }
        return null
      }
    },

    refreshCurrentShieldProfileAuth: async () => {
      try {
        const result = await window.api.shieldProfiles.refreshAuth()
        set({
          shieldProfileAuthStatus: result.auth,
          ...(result.status === 'refreshed'
            ? {
                activeShieldProfileId: result.activeProfileId,
                shieldProfiles: result.profiles
              }
            : {})
        })
        if (result.status === 'reconnect-required') {
          toast.error(
            translate('auto.store.slices.shield.profiles.d6e764e7db', 'Reconnect this profile')
          )
        } else if (result.status === 'failed') {
          toast.error(
            translate(
              'auto.store.slices.shield.profiles.2f6c78a039',
              'Failed to refresh profile auth'
            ),
            { description: result.error }
          )
        }
        return result
      } catch (err) {
        console.error('Failed to refresh Shield profile auth:', err)
        toast.error(
          translate('auto.store.slices.shield.profiles.2f6c78a039', 'Failed to refresh profile auth'),
          {
            description: err instanceof Error ? err.message : String(err)
          }
        )
        return null
      }
    },

    signOutCurrentShieldProfile: async () => {
      nextConnectAttempt += 1
      appliedConnectAttempt = nextConnectAttempt
      try {
        const result = await window.api.shieldProfiles.signOutCurrent()
        set({
          activeShieldProfileId: result.activeProfileId,
          shieldProfiles: result.profiles,
          shieldProfileAuthStatus: result.auth
        })
        if (result.auth.state !== 'connected') {
          toast.success(
            translate('auto.store.slices.shield.profiles.a37b5e6d37', 'Signed out of profile')
          )
        }
        return result
      } catch (err) {
        console.error('Failed to sign out of Shield profile:', err)
        toast.error(translate('auto.store.slices.shield.profiles.83600521e7', 'Failed to sign out'), {
          description: err instanceof Error ? err.message : String(err)
        })
        return null
      }
    },

    selectShieldProfileOrg: async (orgId) => {
      try {
        const result = await window.api.shieldProfiles.selectOrg({ orgId })
        set({
          shieldProfileAuthStatus: result.auth,
          ...(result.status === 'selected'
            ? {
                activeShieldProfileId: result.activeProfileId,
                shieldProfiles: result.profiles
              }
            : {})
        })
        if (result.status === 'reconnect-required') {
          toast.error(
            translate('auto.store.slices.shield.profiles.d6e764e7db', 'Reconnect this profile')
          )
        } else if (result.status === 'failed') {
          toast.error(
            translate(
              'auto.store.slices.shield.profiles.76deec8f58',
              'Failed to switch organization'
            ),
            { description: result.error }
          )
        }
        return result
      } catch (err) {
        console.error('Failed to switch Shield profile org:', err)
        toast.error(
          translate('auto.store.slices.shield.profiles.76deec8f58', 'Failed to switch organization'),
          {
            description: err instanceof Error ? err.message : String(err)
          }
        )
        return null
      }
    }
  }
}
