import { encodePairingOffer } from '../../../shared/pairing'
import {
  getPreferredPairingOffer,
  type KnownRuntimeEnvironment
} from '../../../shared/runtime-environments'
import { disconnectRegisteredSshTarget } from '../../ipc/ssh/ssh-session-teardown'
import type { OctopodMigrationDestinationCatalog } from '../../ssh/octopod-migration-cutover-coordinator'
import {
  abortRemoteOctopodMigrationCatalog,
  commitRemoteOctopodMigrationCatalog,
  listRemoteOctopodRepositories,
  readRemoteOctopodMigrationCatalogState,
  stageRemoteOctopodMigrationCatalog,
  stageRemoteOctopodMigrationSnapshotChunk
} from '../../ssh/octopod-migration-catalog-client'
import { abortRemoteOctopodMigrationCatalogByReference } from '../../ssh/octopod-migration-catalog-reference-client'
import {
  enableRemoteOctopodAutomation,
  type EnableServerAutomation
} from '../../ssh/octopod-migration-moved-automations'
import { censusHostRelayTerminalsFor } from '../../ssh/legacy-relay/ssh-host-relay-census-for-target'
import { isBridgeableLease } from '../../ssh/legacy-relay/legacy-relay-bridge-leases'
import type { OctopodManagedConversionArgs } from './octopod-runtime-conversion'
import type { OctopodServerRepository } from '../../ssh/octopod-migration-repository-link'
import {
  listRemoteOctopodFolderCatalog,
  type OctopodServerFolderCatalog
} from '../../ssh/octopod-server-folder-workspaces'

export function octopodMigrationDestinationFor(
  environment: KnownRuntimeEnvironment
): OctopodMigrationDestinationCatalog {
  const pairingCode = encodePairingOffer(getPreferredPairingOffer(environment))
  const options = environment.runtimeId ? { expectedRuntimeId: environment.runtimeId } : {}
  return {
    readState: (manifest) => readRemoteOctopodMigrationCatalogState(pairingCode, manifest, options),
    stage: (manifest) => stageRemoteOctopodMigrationCatalog(pairingCode, manifest, options),
    commit: (manifest) => commitRemoteOctopodMigrationCatalog(pairingCode, manifest, options),
    abort: (manifest) => abortRemoteOctopodMigrationCatalog(pairingCode, manifest, options),
    abortByReference: (manifest) =>
      abortRemoteOctopodMigrationCatalogByReference(pairingCode, manifest, options),
    stageChunk: (request) => stageRemoteOctopodMigrationSnapshotChunk(pairingCode, request, options)
  }
}

export function octopodServerRepositoriesFor(
  environment: KnownRuntimeEnvironment
): Promise<OctopodServerRepository[]> {
  const pairingCode = encodePairingOffer(getPreferredPairingOffer(environment))
  return listRemoteOctopodRepositories(
    pairingCode,
    environment.runtimeId ? { expectedRuntimeId: environment.runtimeId } : {}
  )
}

export function octopodServerFolderCatalogFor(
  environment: KnownRuntimeEnvironment
): Promise<OctopodServerFolderCatalog> {
  const pairingCode = encodePairingOffer(getPreferredPairingOffer(environment))
  return listRemoteOctopodFolderCatalog(
    pairingCode,
    environment.runtimeId ? { expectedRuntimeId: environment.runtimeId } : {}
  )
}

export function octopodServerAutomationEnablerFor(
  environment: KnownRuntimeEnvironment
): EnableServerAutomation {
  const pairingCode = encodePairingOffer(getPreferredPairingOffer(environment))
  const options = environment.runtimeId ? { expectedRuntimeId: environment.runtimeId } : {}
  return (automation) => enableRemoteOctopodAutomation(pairingCode, automation, options)
}

export function conversionCollaborators(): Pick<
  OctopodManagedConversionArgs,
  | 'destinationFor'
  | 'serverRepositoriesFor'
  | 'serverFolderCatalogFor'
  | 'serverAutomationEnablerFor'
  | 'censusHost'
  | 'isBridgedPaneLease'
  | 'releaseDirectSession'
> {
  return {
    destinationFor: octopodMigrationDestinationFor,
    serverRepositoriesFor: octopodServerRepositoriesFor,
    serverFolderCatalogFor: octopodServerFolderCatalogFor,
    serverAutomationEnablerFor: octopodServerAutomationEnablerFor,
    censusHost: (target) => censusHostRelayTerminalsFor(target)(),
    isBridgedPaneLease: isBridgeableLease,
    releaseDirectSession: disconnectRegisteredSshTarget
  }
}
