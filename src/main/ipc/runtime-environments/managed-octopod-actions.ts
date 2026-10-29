import {
  cancelManagedOctopodStop,
  forgetManagedOctopodEnvironment,
  stopManagedOctopodEnvironment
} from '../../managed-server/lifecycle/octopod-runtime-decommission'
import { getManagedOctopodRuntimeStatus } from '../../managed-server/lifecycle/octopod-runtime-status'
import {
  recoverManagedOctopodEnvironment,
  rollbackManagedOctopodEnvironment,
  updateManagedOctopodEnvironment
} from '../../ssh/octopod-runtime-maintenance'
import { getOctopodSshDeployment } from '../../../shared/runtime-environments'
import { resolveEnvironment } from '../../../shared/runtime-environment-store'
import type {
  OctopodManagedRestartResult,
  OctopodManagedStaleLockReclaimRequest,
  OctopodManagedStaleLockReclaimResult
} from '../../../shared/octopod-managed-runtime'
import { restartManagedOctopodEnvironment } from '../../managed-server/lifecycle/octopod-managed-launch-session'
import { runManagedOctopodStaleLockReclaim } from '../../managed-server/lifecycle/octopod-managed-stale-lock-reclaim'
import { clearLaunchSessionNote } from './runtime-environment-managed-tunnel'
import { forgetLaunchSessionVerdict } from '../ssh/ssh-host-launch-session-note'
import type { ManagedServerActions } from '../../runtime/managed-server-actions-registry'
import {
  retireRemovedRuntimeEnvironment,
  type RemovedServerStore
} from './runtime-environment-removal-cleanup'

export type ManagedOctopodActionOptions = {
  getUserDataPath: () => string
  getActiveEnvironmentId: () => string | null | undefined
  invalidateTransport: (environmentId: string) => Promise<void> | void
  clearHostServerNotes: (sshTargetId: string, environmentId: string) => void
  clearHostServerStatus: (sshTargetId: string) => void
  store: RemovedServerStore
}

export function createManagedOctopodActions(
  options: ManagedOctopodActionOptions
): ManagedServerActions {
  const userDataPath = options.getUserDataPath
  const unlinkPolicy = {
    isActiveEnvironment: (environmentId: string) =>
      options.getActiveEnvironmentId() === environmentId,
    retireLocalState: (environmentId: string) =>
      retireRemovedRuntimeEnvironment(
        environmentId,
        options.invalidateTransport,
        options.store,
        userDataPath()
      )
  }
  return {
    status: (selector) => getManagedOctopodRuntimeStatus(userDataPath(), selector),
    update: async (selector, force, pastLiveTerminals) => {
      const result = await updateManagedOctopodEnvironment(userDataPath(), {
        selector,
        force,
        ...(pastLiveTerminals ? { pastLiveTerminals } : {})
      })
      if (result.outcome === 'updated') {
        await options.invalidateTransport(result.environment.id)
      }
      if (result.outcome !== 'deferred') {
        const targetId = getOctopodSshDeployment(result.environment)?.sshTargetId
        if (targetId) {
          options.clearHostServerNotes(targetId, result.environment.id)
        }
      }
      return result
    },
    rollback: async (selector) => {
      const result = await rollbackManagedOctopodEnvironment(userDataPath(), { selector })
      if (result.outcome === 'rolled-back') {
        await options.invalidateTransport(result.environment.id)
      }
      return result
    },
    recover: async (selector, acceptChangedState) => {
      const result = await recoverManagedOctopodEnvironment(userDataPath(), {
        selector,
        acceptChangedState: acceptChangedState === true
      })
      if (result.outcome === 'recovered' && result.activeVersion) {
        await options.invalidateTransport(result.environment.id)
      }
      return result
    },
    stop: async (selector) => {
      const result = await stopManagedOctopodEnvironment(userDataPath(), { selector }, unlinkPolicy)
      if (result.outcome === 'unlinked') {
        options.clearHostServerStatus(result.sshTargetId)
      }
      return result
    },
    cancelStop: (selector) => cancelManagedOctopodStop(userDataPath(), { selector }),
    forget: async (selector) => {
      const result = await forgetManagedOctopodEnvironment(userDataPath(), { selector }, unlinkPolicy)
      if (result.outcome === 'forgotten') {
        options.clearHostServerStatus(result.sshTargetId)
      }
      return result
    }
  }
}

export async function restartManagedOctopod(
  options: ManagedOctopodActionOptions,
  selector: string
): Promise<OctopodManagedRestartResult> {
  const result = await restartManagedOctopodEnvironment(options.getUserDataPath(), selector)
  if (result.outcome === 'restarted') {
    await reconnectRestartedManagedOctopod(options, result.environmentId)
  }
  return result
}

export async function reclaimManagedOctopodStaleLock(
  options: ManagedOctopodActionOptions,
  selector: string,
  request: OctopodManagedStaleLockReclaimRequest
): Promise<OctopodManagedStaleLockReclaimResult> {
  const result = await runManagedOctopodStaleLockReclaim(options.getUserDataPath(), selector, request)
  // Reconnect also replaces stale-lock feedback when no process had started.
  if (result.status === 'reclaimed') {
    await reconnectRestartedManagedOctopod(options, result.environmentId)
  }
  return result
}

async function reconnectRestartedManagedOctopod(
  options: ManagedOctopodActionOptions,
  environmentId: string
): Promise<void> {
  await options.invalidateTransport(environmentId)
  const environment = resolveEnvironment(options.getUserDataPath(), environmentId)
  const targetId = getOctopodSshDeployment(environment)?.sshTargetId
  if (targetId) {
    options.clearHostServerNotes(targetId, environmentId)
    forgetLaunchSessionVerdict(targetId)
    clearLaunchSessionNote(targetId, environmentId)
  }
}
