import type { StateCreator } from 'zustand'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import type {
  ShieldCloudSignInProgress,
  ShieldProfileAuthStatus,
  ShieldProfileSummary,
  SwitchShieldProfileResult,
  TransferShieldProfileProjectArgs,
  TransferShieldProfileProjectResult
} from '../../../../shared/shield-profiles'
import type { AppState } from '../types'
import {
  createShieldProfilesAuthActions,
  type ShieldProfilesAuthActions
} from './shield-profiles-auth-actions'

export type ShieldProfilesSlice = ShieldProfilesAuthActions & {
  shieldProfiles: ShieldProfileSummary[]
  activeShieldProfileId: string | null
  shieldProfileAuthStatus: ShieldProfileAuthStatus | null
  shieldProfileSignInProgress: ShieldCloudSignInProgress | null
  shieldProfilesMultiProfileUi: boolean
  shieldProfilesLoading: boolean
  shieldProfileSwitching: boolean
  fetchShieldProfiles: () => Promise<void>
  fetchShieldProfileAuthStatus: () => Promise<ShieldProfileAuthStatus | null>
  createLocalShieldProfile: (name?: string) => Promise<ShieldProfileSummary | null>
  switchShieldProfile: (profileId: string) => Promise<SwitchShieldProfileResult | null>
  transferShieldProfileProject: (
    args: TransferShieldProfileProjectArgs
  ) => Promise<TransferShieldProfileProjectResult | null>
}

export const createShieldProfilesSlice: StateCreator<AppState, [], [], ShieldProfilesSlice> = (
  set,
  get,
  api
) => ({
  shieldProfiles: [],
  activeShieldProfileId: null,
  shieldProfileAuthStatus: null,
  shieldProfileSignInProgress: null,
  shieldProfilesMultiProfileUi: false,
  shieldProfilesLoading: false,
  shieldProfileSwitching: false,

  fetchShieldProfiles: async () => {
    set({ shieldProfilesLoading: true })
    try {
      const [state, authStatus] = await Promise.all([
        window.api.shieldProfiles.list(),
        window.api.shieldProfiles.authStatus()
      ])
      set({
        activeShieldProfileId: state.activeProfileId,
        shieldProfiles: state.profiles,
        shieldProfilesMultiProfileUi: state.multiProfileUi,
        shieldProfileAuthStatus: authStatus,
        shieldProfilesLoading: false
      })
    } catch (err) {
      console.error('Failed to fetch Shield profiles:', err)
      set({ shieldProfilesLoading: false })
    }
  },

  fetchShieldProfileAuthStatus: async () => {
    try {
      const authStatus = await window.api.shieldProfiles.authStatus()
      set({ shieldProfileAuthStatus: authStatus })
      return authStatus
    } catch (err) {
      console.error('Failed to fetch Shield profile auth status:', err)
      return null
    }
  },

  createLocalShieldProfile: async (name) => {
    try {
      const state = await window.api.shieldProfiles.createLocal({ name })
      set({
        activeShieldProfileId: state.activeProfileId,
        shieldProfiles: state.profiles
      })
      void get().fetchShieldProfileAuthStatus()
      return state.profile
    } catch (err) {
      console.error('Failed to create Shield profile:', err)
      toast.error(
        translate('auto.store.slices.shield.profiles.612f7f6861', 'Failed to create profile'),
        {
          description: err instanceof Error ? err.message : String(err)
        }
      )
      return null
    }
  },

  ...createShieldProfilesAuthActions(set, get, api),

  switchShieldProfile: async (profileId) => {
    if (!profileId || profileId === get().activeShieldProfileId) {
      return { status: 'already-active' }
    }
    set({ shieldProfileSwitching: true })
    try {
      const result = await window.api.shieldProfiles.switchProfile({ profileId })
      if (result?.status !== 'relaunching') {
        // Only actual relaunch locks switcher; stale already-active answers must unlock it.
        set({ shieldProfileSwitching: false })
      }
      return result
    } catch (err) {
      console.error('Failed to switch Shield profile:', err)
      set({ shieldProfileSwitching: false })
      toast.error(
        translate('auto.store.slices.shield.profiles.7d4bc516ee', 'Failed to switch profile'),
        {
          description: err instanceof Error ? err.message : String(err)
        }
      )
      return null
    }
  },

  transferShieldProfileProject: async (args) => {
    try {
      const result = await window.api.shieldProfiles.transferProject(args)
      if (result.status === 'duplicate-target') {
        toast.error(
          translate(
            'auto.store.slices.shield.profiles.f518e89aa5',
            'Project already exists in that profile'
          )
        )
      }
      if (result.status === 'transferred' && result.willRelaunch) {
        set({ shieldProfileSwitching: true })
      }
      return result
    } catch (err) {
      console.error('Failed to transfer Shield profile project:', err)
      toast.error(
        translate('auto.store.slices.shield.profiles.f03ae7f27b', 'Failed to transfer project'),
        {
          description: err instanceof Error ? err.message : String(err)
        }
      )
      return null
    }
  }
})
