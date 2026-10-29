import type {
  CreateCloudLinkedShieldProfileArgs,
  ShieldProfileListState
} from '../../shared/shield-profiles'
import type { ActiveShieldProfileState } from './profile-index-store'
import { createCloudLinkedShieldProfileRecord, linkShieldProfileToCloud } from './profile-cloud-index'
import { readCloudSession, signInCloudSession } from './profile-cloud-session-owner'
import { createDevShieldCloudSession } from './profile-cloud-dev-auth'

type DevProfileListResult = ShieldProfileListState

type DevCreateProfileResult =
  | {
      status: 'created'
      list: ReturnType<typeof createCloudLinkedShieldProfileRecord>
    }
  | { status: 'reconnect-required' }

type DevMutationResult =
  | {
      status: 'updated'
      list: DevProfileListResult
    }
  | { status: 'reconnect-required' }

export function connectDevShieldCloudProfile(
  active: ActiveShieldProfileState,
  userDataPath: string
): DevProfileListResult {
  const session = createDevShieldCloudSession({ localProfileId: active.profile.id })
  signInCloudSession(active.profile.id, userDataPath, session)
  return linkShieldProfileToCloud(active.profile.id, session.cloud, userDataPath)
}

export function createDevCloudLinkedShieldProfile(
  active: ActiveShieldProfileState,
  userDataPath: string,
  args: CreateCloudLinkedShieldProfileArgs
): DevCreateProfileResult {
  if (readCloudSession(active.profile.id, userDataPath).status !== 'found') {
    return { status: 'reconnect-required' }
  }
  const session = createDevShieldCloudSession({ orgId: args.orgId })
  const list = createCloudLinkedShieldProfileRecord(session.cloud, { name: args.name }, userDataPath)
  signInCloudSession(list.profile.id, userDataPath, session)
  return { status: 'created', list }
}

export function refreshDevShieldCloudProfile(
  active: ActiveShieldProfileState,
  userDataPath: string
): DevMutationResult {
  if (
    !active.profile.cloud ||
    readCloudSession(active.profile.id, userDataPath).status !== 'found'
  ) {
    return { status: 'reconnect-required' }
  }
  const session = createDevShieldCloudSession({
    localProfileId: active.profile.id,
    cloudProfileId: active.profile.cloud.cloudProfileId,
    orgId: active.profile.cloud.activeOrgId
  })
  signInCloudSession(active.profile.id, userDataPath, session)
  return {
    status: 'updated',
    list: linkShieldProfileToCloud(active.profile.id, session.cloud, userDataPath)
  }
}

export function selectDevShieldCloudOrg(
  active: ActiveShieldProfileState,
  userDataPath: string,
  orgId: string
): DevMutationResult {
  if (
    !active.profile.cloud ||
    readCloudSession(active.profile.id, userDataPath).status !== 'found'
  ) {
    return { status: 'reconnect-required' }
  }
  const session = createDevShieldCloudSession({
    localProfileId: active.profile.id,
    cloudProfileId: active.profile.cloud.cloudProfileId,
    orgId
  })
  signInCloudSession(active.profile.id, userDataPath, session)
  return {
    status: 'updated',
    list: linkShieldProfileToCloud(active.profile.id, session.cloud, userDataPath)
  }
}
