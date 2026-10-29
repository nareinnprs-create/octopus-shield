import { ipcMain, type WebContents } from 'electron'
import type { Store } from '../persistence'
import { relaunchApp, type AppRelaunchReason } from '../app-relaunch'
import { quitProcess } from '../startup/process-quit-request'
import type {
  CreateLocalShieldProfileArgs,
  CreateLocalShieldProfileResult,
  CreateCloudLinkedShieldProfileArgs,
  CreateCloudLinkedShieldProfileResult,
  FindShieldProfileProjectsByPathArgs,
  FindShieldProfileProjectsByPathResult,
  ShieldProfileListResult,
  RefreshCurrentShieldProfileAuthResult,
  SwitchShieldProfileArgs,
  SwitchShieldProfileResult,
  TransferShieldProfileProjectArgs,
  TransferShieldProfileProjectResult,
  ConnectCurrentShieldProfileResult,
  ShieldProfileAuthStatus,
  ShieldCloudSignInProgress,
  SelectShieldProfileOrgArgs,
  SelectShieldProfileOrgResult,
  SignOutCurrentShieldProfileResult
} from '../../shared/shield-profiles'
import {
  createLocalShieldProfile,
  getShieldProfileListState,
  seedNewShieldProfileTelemetryConsent,
  setActiveShieldProfile
} from '../shield-profiles/profile-index-store'
import { getProfileUserDataPath } from '../shield-profiles/profile-storage-paths'
import { isMultiProfileUiEnabled } from '../shield-profiles/profile-ui-scope'
import { transferShieldProfileProject } from '../shield-profiles/profile-project-transfer'
import { transferActiveProfileProject } from '../shield-profiles/profile-active-transfer'
import { findShieldProfileProjectsByPath } from '../shield-profiles/profile-project-presence'
import {
  flushActiveProfileBeforeFileMutation,
  flushActiveProfileBeforeRelaunch
} from '../shield-profiles/profile-persistence-deadline'
import { normalizeExecutionHostId } from '../../shared/execution-host'
import {
  createCloudLinkedShieldProfile,
  connectCurrentShieldProfile,
  getCurrentShieldProfileAuthStatus,
  refreshCurrentShieldProfileAuth,
  selectCurrentShieldProfileOrg,
  signOutCurrentShieldProfile
} from '../shield-profiles/profile-cloud-service'
import { registerShieldProfileOrgMemberHandlers } from './shield-profile-org-members-handlers'
import { onShieldCloudSessionInvalidated } from '../shield-profiles/profile-cloud-session-invalidation'
import {
  broadcastShieldProfileAuthStatusChanged,
  broadcastShieldProfileSignInProgressChanged
} from './shield-profile-auth-status-broadcast'
import {
  cancelShieldCloudSignIn,
  getShieldCloudSignInProgress,
  onShieldCloudSignInProgressChanged
} from '../shield-profiles/profile-cloud-sign-in-progress'
import { profileIdFromArgs } from './shield-profile-id-arg'
import { transferProjectArgsFromUnknown } from './shield-profile-project-transfer-args'

type RegisterShieldProfileHandlersOptions = {
  onBeforeRelaunch?: () => void | Promise<void>
  onAuthMutation?: () => void
  onBeforeSignOut?: () => void
  onAfterSignOut?: () => void
}

function findProjectsByPathArgsFromUnknown(args: unknown): FindShieldProfileProjectsByPathArgs {
  if (!args || typeof args !== 'object') {
    throw new Error('invalid_shield_profile_project_path')
  }
  const candidate = args as FindShieldProfileProjectsByPathArgs
  const path = typeof candidate.path === 'string' ? candidate.path.trim() : ''
  if (!path) {
    throw new Error('invalid_shield_profile_project_path')
  }
  let executionHostId: FindShieldProfileProjectsByPathArgs['executionHostId'] = null
  if (candidate.executionHostId !== null && candidate.executionHostId !== undefined) {
    if (typeof candidate.executionHostId !== 'string') {
      throw new Error('invalid_shield_profile_project_path')
    }
    executionHostId = normalizeExecutionHostId(candidate.executionHostId)
    if (!executionHostId) {
      throw new Error('invalid_shield_profile_project_path')
    }
  }
  return {
    path,
    connectionId:
      typeof candidate.connectionId === 'string' ? candidate.connectionId.trim() || null : null,
    executionHostId,
    excludeProfileId:
      typeof candidate.excludeProfileId === 'string'
        ? candidate.excludeProfileId.trim() || null
        : null
  }
}

function orgIdFromUnknown(args: unknown): string {
  if (!args || typeof args !== 'object') {
    throw new Error('invalid_shield_profile_org_selection')
  }
  const orgId = (args as SelectShieldProfileOrgArgs).orgId?.trim()
  if (!orgId) {
    throw new Error('invalid_shield_profile_org_selection')
  }
  return orgId
}

function createCloudLinkedProfileArgsFromUnknown(args: unknown): CreateCloudLinkedShieldProfileArgs {
  if (!args || typeof args !== 'object') {
    return {}
  }
  const candidate = args as CreateCloudLinkedShieldProfileArgs
  const orgId = typeof candidate.orgId === 'string' ? candidate.orgId.trim() : undefined
  const name = typeof candidate.name === 'string' ? candidate.name.trim() : undefined
  return {
    ...(orgId ? { orgId } : {}),
    ...(name ? { name } : {})
  }
}

async function runBeforeProfileRelaunch(
  onBeforeRelaunch?: () => void | Promise<void>
): Promise<void> {
  try {
    await onBeforeRelaunch?.()
  } catch (error) {
    console.warn(
      '[shield-profiles] Pre-relaunch cleanup failed; continuing profile switch:',
      error instanceof Error ? error.name : typeof error
    )
  }
}

type ProfileRelaunchReason = Extract<AppRelaunchReason, `profile-${string}`>

function scheduleProfileRelaunch(reason: ProfileRelaunchReason, sender: WebContents): void {
  if (!sender.isDestroyed()) {
    sender.send('app:restart-committed')
  }
  setTimeout(() => {
    relaunchApp(reason)
    // Normal quit preserves renderer scrollback, PTY teardown, stats flush and final daemon checkpoints.
    quitProcess()
  }, 150)
}

export function registerShieldProfileHandlers(
  store: Store,
  options: RegisterShieldProfileHandlersOptions = {}
): void {
  ipcMain.handle('shieldProfiles:list', (): ShieldProfileListResult => ({
    ...getShieldProfileListState(),
    multiProfileUi: isMultiProfileUiEnabled()
  }))

  ipcMain.handle('shieldProfiles:authStatus', (): ShieldProfileAuthStatus =>
    getCurrentShieldProfileAuthStatus(getProfileUserDataPath())
  )

  // Push background invalidation; re-entering onAuthMutation would loop into the relay coordinator that just failed.
  onShieldCloudSessionInvalidated(broadcastShieldProfileAuthStatusChanged)
  onShieldCloudSignInProgressChanged(broadcastShieldProfileSignInProgressChanged)

  ipcMain.handle(
    'shieldProfiles:createLocal',
    (_event, args?: CreateLocalShieldProfileArgs): CreateLocalShieldProfileResult => {
      const result = createLocalShieldProfile(args)
      seedNewShieldProfileTelemetryConsent(result.profile.id, store.getSettings().telemetry)
      return result
    }
  )

  ipcMain.handle(
    'shieldProfiles:switch',
    async (event, args: SwitchShieldProfileArgs): Promise<SwitchShieldProfileResult> => {
      const profileId = profileIdFromArgs(args)
      const current = getShieldProfileListState()
      if (profileId === current.activeProfileId) {
        return { status: 'already-active' }
      }

      // Flush the source profile before switching the startup index; keep its writer alive through relaunch cleanup.
      await flushActiveProfileBeforeRelaunch(store)
      setActiveShieldProfile(profileId)
      await runBeforeProfileRelaunch(options.onBeforeRelaunch)

      scheduleProfileRelaunch('profile-switch', event.sender)

      return { status: 'relaunching' }
    }
  )

  ipcMain.handle(
    'shieldProfiles:transferProject',
    async (
      event,
      rawArgs: TransferShieldProfileProjectArgs
    ): Promise<TransferShieldProfileProjectResult> => {
      const args = transferProjectArgsFromUnknown(rawArgs)
      const current = getShieldProfileListState()
      if (args.targetProfileId === current.activeProfileId) {
        throw new Error('active_target_shield_profile_transfer_requires_relaunch')
      }
      if (args.mode === 'move' && args.sourceProfileId === current.activeProfileId) {
        // Finish transfer before relaunch side effects so validation failure cannot strand the app quitting.
        const result = await transferActiveProfileProject(
          args,
          getProfileUserDataPath(),
          store,
          async () => {
            await runBeforeProfileRelaunch(options.onBeforeRelaunch)
            scheduleProfileRelaunch('profile-transfer', event.sender)
          }
        )
        if (result.status === 'transferred') {
          await runBeforeProfileRelaunch(options.onBeforeRelaunch)
          try {
            setActiveShieldProfile(args.targetProfileId)
          } finally {
            // The source has already changed and its writer cannot resume.
            scheduleProfileRelaunch('profile-transfer', event.sender)
          }
          return { ...result, willRelaunch: true }
        }
        return result
      }
      if (args.sourceProfileId !== current.activeProfileId) {
        await store.flushPendingOrThrowAsync({ drainToStableGeneration: false })
        return transferShieldProfileProject(args, getProfileUserDataPath())
      }
      const maintenance = await flushActiveProfileBeforeFileMutation(store)
      try {
        return transferShieldProfileProject(args, getProfileUserDataPath())
      } finally {
        await maintenance.resume()
      }
    }
  )

  ipcMain.handle(
    'shieldProfiles:findProjectProfiles',
    (_event, rawArgs: FindShieldProfileProjectsByPathArgs): FindShieldProfileProjectsByPathResult =>
      findShieldProfileProjectsByPath(
        findProjectsByPathArgsFromUnknown(rawArgs),
        getProfileUserDataPath()
      )
  )

  ipcMain.handle(
    'shieldProfiles:connectCurrent',
    async (): Promise<ConnectCurrentShieldProfileResult> => {
      const result = await connectCurrentShieldProfile(getProfileUserDataPath())
      if (result.status === 'connected') {
        options.onAuthMutation?.()
      }
      return result
    }
  )

  ipcMain.handle('shieldProfiles:signInProgress', (): ShieldCloudSignInProgress | null =>
    getShieldCloudSignInProgress()
  )

  ipcMain.handle('shieldProfiles:cancelSignIn', (): void => cancelShieldCloudSignIn())

  ipcMain.handle(
    'shieldProfiles:createCloudLinked',
    async (
      _event,
      rawArgs?: CreateCloudLinkedShieldProfileArgs
    ): Promise<CreateCloudLinkedShieldProfileResult> => {
      const result = await createCloudLinkedShieldProfile(
        getProfileUserDataPath(),
        createCloudLinkedProfileArgsFromUnknown(rawArgs)
      )
      if (result.status === 'created') {
        seedNewShieldProfileTelemetryConsent(result.profile.id, store.getSettings().telemetry)
        options.onAuthMutation?.()
      }
      return result
    }
  )

  ipcMain.handle(
    'shieldProfiles:refreshAuth',
    async (): Promise<RefreshCurrentShieldProfileAuthResult> => {
      const result = await refreshCurrentShieldProfileAuth(getProfileUserDataPath())
      if (result.status === 'refreshed') {
        options.onAuthMutation?.()
      }
      return result
    }
  )

  ipcMain.handle(
    'shieldProfiles:signOutCurrent',
    async (): Promise<SignOutCurrentShieldProfileResult> => {
      options.onBeforeSignOut?.()
      return signOutCurrentShieldProfile(getProfileUserDataPath()).finally(options.onAfterSignOut)
    }
  )

  ipcMain.handle(
    'shieldProfiles:selectOrg',
    async (_event, rawArgs: SelectShieldProfileOrgArgs): Promise<SelectShieldProfileOrgResult> => {
      const result = await selectCurrentShieldProfileOrg(
        getProfileUserDataPath(),
        orgIdFromUnknown(rawArgs)
      )
      if (result.status === 'selected') {
        options.onAuthMutation?.()
      }
      return result
    }
  )

  registerShieldProfileOrgMemberHandlers()
}
