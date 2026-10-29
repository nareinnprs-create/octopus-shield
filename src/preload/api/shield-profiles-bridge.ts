import { ipcRenderer } from 'electron'
import type { PreloadApi } from '../api-types'
import {
  OSHIELD_PROFILE_AUTH_STATUS_CHANGED_CHANNEL,
  OSHIELD_PROFILE_SIGN_IN_PROGRESS_CHANGED_CHANNEL,
  type ShieldCloudSignInProgress,
  type ShieldProfileListResult,
  type SwitchShieldProfileResult,
  type TransferShieldProfileProjectResult
} from '../../shared/shield-profiles'
import { prepareAndInvokeAppRestart } from '../renderer-restart-wiring'
import { awaitBeforeUnloadCheckpoint } from '../preload-runtime-support'

export const shieldProfilesApi = {
  list: () => ipcRenderer.invoke('shieldProfiles:list'),
  authStatus: () => ipcRenderer.invoke('shieldProfiles:authStatus'),
  onAuthStatusChanged: (callback: () => void): (() => void) => {
    const listener = (): void => callback()
    ipcRenderer.on(OSHIELD_PROFILE_AUTH_STATUS_CHANGED_CHANNEL, listener)
    return () => ipcRenderer.removeListener(OSHIELD_PROFILE_AUTH_STATUS_CHANGED_CHANNEL, listener)
  },
  onSignInProgressChanged: (
    callback: (progress: ShieldCloudSignInProgress | null) => void
  ): (() => void) => {
    const listener = (_event: unknown, progress: ShieldCloudSignInProgress | null): void =>
      callback(progress)
    ipcRenderer.on(OSHIELD_PROFILE_SIGN_IN_PROGRESS_CHANGED_CHANNEL, listener)
    return () => ipcRenderer.removeListener(OSHIELD_PROFILE_SIGN_IN_PROGRESS_CHANGED_CHANNEL, listener)
  },
  createLocal: (args) => ipcRenderer.invoke('shieldProfiles:createLocal', args),
  createCloudLinked: (args) => ipcRenderer.invoke('shieldProfiles:createCloudLinked', args),
  switchProfile: (args) =>
    prepareAndInvokeAppRestart(
      window,
      (): Promise<SwitchShieldProfileResult> => ipcRenderer.invoke('shieldProfiles:switch', args),
      awaitBeforeUnloadCheckpoint,
      (result) => result.status === 'relaunching'
    ),
  transferProject: async (args) => {
    const invoke = (): Promise<TransferShieldProfileProjectResult> =>
      ipcRenderer.invoke('shieldProfiles:transferProject', args)
    if (args.mode !== 'move') {
      return invoke()
    }
    const current: ShieldProfileListResult = await ipcRenderer.invoke('shieldProfiles:list')
    if (args.sourceProfileId !== current.activeProfileId) {
      return invoke()
    }
    return prepareAndInvokeAppRestart(
      window,
      invoke,
      awaitBeforeUnloadCheckpoint,
      (result) => result.status === 'transferred' && result.willRelaunch === true
    )
  },
  findProjectProfiles: (args) => ipcRenderer.invoke('shieldProfiles:findProjectProfiles', args),
  connectCurrent: () => ipcRenderer.invoke('shieldProfiles:connectCurrent'),
  signInProgress: () => ipcRenderer.invoke('shieldProfiles:signInProgress'),
  cancelSignIn: () => ipcRenderer.invoke('shieldProfiles:cancelSignIn'),
  refreshAuth: () => ipcRenderer.invoke('shieldProfiles:refreshAuth'),
  signOutCurrent: () => ipcRenderer.invoke('shieldProfiles:signOutCurrent'),
  selectOrg: (args) => ipcRenderer.invoke('shieldProfiles:selectOrg', args),
  orgMembersList: (args) => ipcRenderer.invoke('shieldProfiles:orgMembersList', args),
  orgMemberInvite: (args) => ipcRenderer.invoke('shieldProfiles:orgMemberInvite', args),
  orgInviteRevoke: (args) => ipcRenderer.invoke('shieldProfiles:orgInviteRevoke', args),
  orgMemberChangeRole: (args) => ipcRenderer.invoke('shieldProfiles:orgMemberChangeRole', args),
  orgMemberRemove: (args) => ipcRenderer.invoke('shieldProfiles:orgMemberRemove', args)
} satisfies PreloadApi['shieldProfiles']
