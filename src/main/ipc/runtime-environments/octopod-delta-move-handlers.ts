/** IPC for a host an older build changed after conversion: move its newer projects, or keep the server's. */
import { ipcMain } from 'electron'
import type {
  OctopodDeltaMovePreview,
  OctopodDeltaMoveResult
} from '../../../shared/octopod-managed-runtime'
import { listEnvironments } from '../../../shared/runtime-environment-store'
import { requireManagedOctopodInfrastructure } from '../../managed-server/lifecycle/octopod-managed-runtime-context'
import { ensureOctopodManagedTunnel } from '../../managed-server/lifecycle/octopod-managed-tunnel'
import { keepOctopodServerVersion, runOctopodDeltaMove } from '../../ssh/octopod-migration-delta-move'
import { planOctopodDeltaMove } from '../../ssh/octopod-migration-delta-plan'
import { censusHostRelayTerminalsFor } from '../../ssh/legacy-relay/ssh-host-relay-census-for-target'
import {
  octopodMigrationDestinationFor,
  octopodServerAutomationEnablerFor
} from '../../managed-server/lifecycle/octopod-runtime-conversion-wiring'
import { enableMovedOctopodAutomationsForTarget } from '../../ssh/octopod-migration-moved-automations'
import { requiredString } from './octopod-runtime-lifecycle-handlers'
import { publishResolvedChangedHostStatus } from './runtime-environment-managed-tunnel'
import { runTargetLifecycle } from '../ssh/ssh-target-lifecycle-queue'

export function registerOctopodDeltaMoveHandlers(getUserDataPath: () => string): void {
  ipcMain.handle(
    'runtimeEnvironments:previewOctopodDeltaMove',
    (_event, args: { sshTargetId: string }): OctopodDeltaMovePreview => {
      const { store, target } = requireChangedHost(args)
      const plan = planOctopodDeltaMove(getUserDataPath(), store, target)
      const { sshTargetId, environmentId, added, notReflected, blockers } = plan
      return { sshTargetId, environmentId, added, notReflected, blockers }
    }
  )
  ipcMain.handle(
    'runtimeEnvironments:moveOctopodDelta',
    async (_event, args: { sshTargetId: string }): Promise<OctopodDeltaMoveResult> => {
      const userDataPath = getUserDataPath()
      const { store, claims, target } = requireChangedHost(args)
      const environment = listEnvironments(userDataPath).find(
        (entry) => entry.id === target.octopodFence?.environmentId
      )
      if (!environment) {
        throw new Error('This host’s Shield server is no longer registered.')
      }
      const result = await runOctopodDeltaMove({
        userDataPath,
        store,
        claims,
        target,
        environment,
        connectDestination: async () =>
          octopodMigrationDestinationFor(
            await ensureOctopodManagedTunnel(userDataPath, environment.id)
          ),
        censusHost: censusHostRelayTerminalsFor(target),
        runTargetLifecycle
      })
      if (result.outcome === 'moved') {
        // Tunnel repair may have re-paired the server; read its current credentials.
        const paired = listEnvironments(userDataPath).find((entry) => entry.id === environment.id)
        const automationsLeftDisabled = await enableMovedOctopodAutomationsForTarget(
          userDataPath,
          target.id,
          octopodServerAutomationEnablerFor(paired ?? environment)
        ).catch((error: unknown) => {
          console.warn('[ssh] Could not re-enable moved automations:', error)
          return 0
        })
        publishResolvedChangedHostStatus(target, environment.id, automationsLeftDisabled)
      }
      return result
    }
  )
  ipcMain.handle(
    'runtimeEnvironments:keepOctopodServerVersion',
    async (_event, args: { sshTargetId: string }): Promise<void> => {
      const { store, claims, target, environmentId } = requireChangedHost(args)
      await runTargetLifecycle(target.id, () =>
        keepOctopodServerVersion({ userDataPath: getUserDataPath(), store, claims, target })
      )
      publishResolvedChangedHostStatus(target, environmentId)
    }
  )
}

function requireChangedHost(args: { sshTargetId: string } | undefined) {
  const sshTargetId = requiredString(args?.sshTargetId, 'SSH target')
  const { targetStore, claims } = requireManagedOctopodInfrastructure()
  const store = targetStore.getOctopodMigrationSource()
  const target = store.getSshTarget(sshTargetId)
  if (!target?.octopodFence?.sourceChangedAt) {
    throw new Error('This SSH host has no changes from an older Shield to resolve.')
  }
  return { store, claims, target, environmentId: target.octopodFence.environmentId }
}
