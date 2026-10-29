/** Use the managed SSH repair gate for refused WSL enrollment: serialize, cap attempts and require the pinned host key. Read new offers inside the local distro. */
import { resolveEnvironment } from '../../shared/runtime-environment-store'
import {
  findWslHostDeployment,
  refreshWslHostPairing
} from '../../shared/runtime-environment-wsl-host-store'
import type { KnownRuntimeEnvironment } from '../../shared/runtime-environments'
import { readActiveManagedOctopodReadiness } from '../managed-server/lifecycle/octopod-managed-bound-port'
import {
  ManagedOctopodPairingRepairs,
  type ManagedOctopodPairingRepairDeps
} from '../managed-server/lifecycle/octopod-managed-pairing-repair'
import type { WslOctopodHostTransport } from './wsl-octopod-host-transport'
import { OctopodManagedPairingRepairFailedError } from '../managed-server/lifecycle/octopod-managed-pairing-repair-failure'
import { notifyManagedOctopodPairingRepaired } from '../managed-server/lifecycle/octopod-managed-pairing-repaired-listener'
import type { WslOctopodHostTarget } from './wsl-octopod-host-target'
import { createWslOctopodHostTransport } from './wsl-octopod-host-transport'
import type { WslOctopodPairingRecovery } from './wsl-octopod-pairing-identity'

type WslOctopodHostAccess = { target: WslOctopodHostTarget; connection: WslOctopodHostTransport }

export function liveWslOctopodPairingRepairDeps(
  userDataPath: string
): ManagedOctopodPairingRepairDeps<WslOctopodHostAccess> {
  const record = (environmentId: string) => {
    const found = findWslHostDeployment(userDataPath, environmentId)
    if (!found) {
      throw new OctopodManagedPairingRepairFailedError('this server is not a WSL host')
    }
    return found
  }
  return {
    resolve: (environmentId) => resolveEnvironment(userDataPath, environmentId),
    connect: async (environment: KnownRuntimeEnvironment) => {
      const target: WslOctopodHostTarget = {
        kind: 'wsl',
        id: environment.id,
        distro: record(environment.id).distro,
        label: environment.name
      }
      return { target, connection: createWslOctopodHostTransport({ target }) }
    },
    readReadiness: async (access) => {
      try {
        return await readActiveManagedOctopodReadiness(access)
      } finally {
        access.connection.dispose()
      }
    },
    ports: (environment) => {
      const found = findWslHostDeployment(userDataPath, environment.id)
      return found ? { localPort: found.localPort, remotePort: found.remotePort } : null
    },
    refresh: (environmentId, pairingCode) => {
      const { localPort, remotePort } = record(environmentId)
      return refreshWslHostPairing(userDataPath, environmentId, {
        pairingCode,
        localPort,
        remotePort
      }).environment
    },
    repaired: notifyManagedOctopodPairingRepaired,
    now: Date.now
  }
}

/** One gate per desktop, so the cap and a standing failure hold across every WSL connect. */
export function createWslOctopodPairingRecovery(
  userDataPath: string,
  deps: ManagedOctopodPairingRepairDeps<WslOctopodHostAccess> = liveWslOctopodPairingRepairDeps(
    userDataPath
  )
): Omit<WslOctopodPairingRecovery, 'environmentId'> {
  return { repairs: new ManagedOctopodPairingRepairs(deps), resolve: deps.resolve }
}
