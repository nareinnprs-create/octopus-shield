import { getAppEnvironment } from '../../../shared/app-environment'
import {
  getManagedOctopodFenceEnvironmentId,
  managedOctopodServerName
} from '../../../shared/managed-octopod-ssh-owner'
import { listEnvironments } from '../../../shared/runtime-environment-store'
import { findOctopodMigrationSourceCutoverForTarget } from '../../ssh/octopod-migration-cutover-journal'
import { abandonOctopodConversion } from '../../ssh/octopod-conversion-abandon'
import { retainOctopodMigrationSource } from '../../ssh/octopod-migration-source-retention'
import { enableMovedOctopodAutomationsForTarget } from '../../ssh/octopod-migration-moved-automations'
import { hasOctopodTemplate } from '../../octopod/octopod-artifact-materializer'
import { isOctopodHostUnavailableFixableOnHost } from '../../octopod/octopod-host-unavailable'
import { managedServerUpdateDeps } from '../../ssh/managed-server-update-deps'
import { ensureOctopodManagedTunnel } from '../../managed-server/lifecycle/octopod-managed-tunnel'
import { verifyOctopodManagedServing } from '../../managed-server/lifecycle/octopod-managed-serving-verify'
import { convertSshTargetToManagedOctopod } from '../../managed-server/lifecycle/octopod-runtime-conversion'
import {
  octopodMigrationDestinationFor,
  octopodServerAutomationEnablerFor,
  octopodServerFolderCatalogFor,
  octopodServerRepositoriesFor
} from '../../managed-server/lifecycle/octopod-runtime-conversion-wiring'
import { createManagedOctopodEnvironment } from '../../managed-server/lifecycle/octopod-runtime-deployment'
import type { HostServerOnConnectDeps } from '../../ssh/ssh-host-server-on-connect'
import {
  censusSshHostRelaysBeforeSession,
  relayTerminalsOnConnect
} from '../../ssh/legacy-relay/ssh-host-relay-terminals-on-connect'
import { requireManagedOctopodInfrastructure } from '../../managed-server/lifecycle/octopod-managed-runtime-context'
import { censusHostRelayTerminalsFor } from '../../ssh/legacy-relay/ssh-host-relay-census-for-target'
import { setSshHostServerStatus } from '../../ssh/ssh-host-server-status'
import { trackSshHostServerEvent } from '../../ssh/ssh-host-server-telemetry'
import { knownSshHostPlatform } from '../../ssh/ssh-host-platform-memo'
import { knownOctopodTunnelTransport } from '../../ssh/octopod-tunnel-transport-memo'
import { getSshTargetRegistryStore } from '../../ssh/targets/ssh-target-registry'
import { releaseUnreachableOctopodSetup } from '../../ssh/octopod-unreachable-setup-release'
import { getCurrentMainWindow } from './ssh-ipc-context'
import { broadcastSshState } from './ssh-renderer-broadcast'
import { connectInFlight } from './ssh-connect-attempt-registry'
import { startLegacyRelayBridge } from '../../ssh/legacy-relay/legacy-relay-bridge-registry'
import { isBridgeableLease } from '../../ssh/legacy-relay/legacy-relay-bridge-leases'

export function hostServerOnConnectDeps(userDataPath: string): HostServerOnConnectDeps {
  const registry = getSshTargetRegistryStore()!
  const claims = registry.getOctopodRuntimeClaims()
  const store = registry.getOctopodMigrationSource()
  const appVersion = getAppEnvironment().getVersion()
  const isRegistered = (environmentId: string): boolean =>
    listEnvironments(userDataPath).some((entry) => entry.id === environmentId)
  return {
    // A fence alone may be unfinished setup; only registered servers count.
    managedEnvironmentId: (target) => {
      const environmentId = getManagedOctopodFenceEnvironmentId(target)
      return environmentId && isRegistered(environmentId) ? environmentId : null
    },
    ensureTunnel: async (environmentId) => {
      await ensureOctopodManagedTunnel(userDataPath, environmentId)
    },
    ensureServing: (environmentId) => verifyOctopodManagedServing(userDataPath, environmentId),
    retainCommittedSource: async (target) => {
      const head = findOctopodMigrationSourceCutoverForTarget(userDataPath, target.id)
      if (head?.phase !== 'destination-committed') {
        return 0
      }
      await retainOctopodMigrationSource(userDataPath, head.migrationId, store)
      // Retry what earlier connects could not reach the server to re-enable.
      const environment = listEnvironments(userDataPath).find(
        (entry) => entry.id === head.destinationEnvironmentId
      )
      return environment
        ? enableMovedOctopodAutomationsForTarget(
            userDataPath,
            target.id,
            octopodServerAutomationEnablerFor(environment)
          )
        : 0
    },
    hasTemplate: hasOctopodTemplate,
    recordedUnavailable: (target) =>
      target.managedServerUnavailable?.appVersion === appVersion
        ? target.managedServerUnavailable.reason
        : null,
    recordUnavailable: (target, reason) => {
      if (!isOctopodHostUnavailableFixableOnHost(reason)) {
        registry.updateTarget(target.id, { managedServerUnavailable: { reason, appVersion } })
      }
    },
    ...managedServerUpdateDeps(userDataPath),
    isEmptyHost: (target) => {
      // An interrupted empty-host deploy passes its own claim, recorded by its provisioning intent.
      const environmentId = getManagedOctopodFenceEnvironmentId(target)
      return claims.preflight(
        target.id,
        environmentId
          ? { environmentId, recorded: target.octopodProvisioning !== undefined }
          : undefined
      ).claimable
    },
    relayTerminals: (target) =>
      relayTerminalsOnConnect({
        store,
        targetId: target.id,
        censusHost: async () =>
          censusSshHostRelaysBeforeSession(
            await requireManagedOctopodInfrastructure().connectionManager.connect(target),
            target.id
          )
      }),
    deploy: (target) =>
      createManagedOctopodEnvironment(userDataPath, {
        name: target.octopodProvisioning?.name ?? managedOctopodServerName(target),
        sshTargetId: target.id
      }),
    convert: async (target, hostProof) => {
      // COMPAT(legacy-relay-bridge): find the panes old relays still run before the tabs remount.
      if (hostProof?.bridged) {
        await startLegacyRelayBridge(target.id)
      }
      const converted = await convertSshTargetToManagedOctopod(userDataPath, {
        sshTargetId: target.id,
        name: managedOctopodServerName(target),
        // The connect's own census already answered; a conversion before any session reuses it.
        censusHost: (host) =>
          hostProof ? Promise.resolve(hostProof) : censusHostRelayTerminalsFor(host)(),
        isBridgedPaneLease: isBridgeableLease,
        // Releasing the direct session here would cancel the connect that requested conversion.
        destinationFor: octopodMigrationDestinationFor,
        serverRepositoriesFor: octopodServerRepositoriesFor,
        serverFolderCatalogFor: octopodServerFolderCatalogFor,
        serverAutomationEnablerFor: octopodServerAutomationEnablerFor
      })
      if (converted.outcome === 'converted' || converted.outcome === 'refused') {
        // Move-anyway consent covers one attempt; retain it on failure so held-fence verification can resume.
        registry.updateTarget(target.id, { managedServerLeaveBehind: undefined })
      }
      return converted
    },
    abandonDeploy: async (target) => {
      const environmentId =
        getManagedOctopodFenceEnvironmentId(target) ??
        getManagedOctopodFenceEnvironmentId(registry.getTarget(target.id))
      if (environmentId && !isRegistered(environmentId)) {
        claims.release(target.id, environmentId)
        await claims.flush()
      }
    },
    hasUnfinishedConversion: (target) => {
      const head = findOctopodMigrationSourceCutoverForTarget(userDataPath, target.id)
      return (
        head !== null &&
        !head.supersedesMigrationId &&
        (head.phase === 'source-fenced' || head.phase === 'destination-staged')
      )
    },
    abandonConversion: async (target) => {
      await abandonOctopodConversion({
        userDataPath,
        store,
        claims,
        targetId: target.id,
        destinationFor: octopodMigrationDestinationFor
      })
    },
    isFencedBeforeStaging: (target) =>
      findOctopodMigrationSourceCutoverForTarget(userDataPath, target.id)?.phase === 'source-fenced',
    releaseUnreachableSetup: (target) =>
      releaseUnreachableOctopodSetup({ userDataPath, claims, targetId: target.id }),
    // Read at report time: a deploy or conversion learns the platform while the decision runs.
    report: (target, event) =>
      trackSshHostServerEvent(
        event,
        knownSshHostPlatform(target.id),
        knownOctopodTunnelTransport(target.id)
      ),
    progress: (target, phase) => {
      // Cancelled decisions keep running; their progress must not revive connection status.
      if (!connectInFlight.has(target.id)) {
        return
      }
      setSshHostServerStatus(target.id, { kind: 'setting-up', phase })
      broadcastSshState(getCurrentMainWindow, target.id, {
        targetId: target.id,
        status: 'connecting',
        error: null,
        reconnectAttempt: 0
      })
    }
  }
}
