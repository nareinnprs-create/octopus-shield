import { createWslOctopodPairingRecovery } from './wsl-octopod-pairing-repair'
import { readConfirmedRunningWslDistros } from '../wsl-background-distro-gate'
import { parsePairingCode } from '../../shared/pairing'
import { pairedRuntimeConnectionFromOffer } from '../../shared/paired-runtime-connection'
import { verifyOctopodPairingIdentity } from '../managed-server/lifecycle/octopod-managed-tunnel-identity'
import { resolveEnvironmentPairingOffer } from '../../shared/runtime-environment-store'
import { findWslHostDeployment } from '../../shared/runtime-environment-wsl-host-store'
import { createWslDistroHolder, type WslDistroHolder } from './wsl-distro-holder'
import { listWslHostDistros } from './wsl-host-distro-list'
import { resolveWslDistroName } from './wsl-distro-registry-id'
import type { WslHostConnector, WslHostReachability } from './wsl-host-service'
import { readWslDistroOctopodPublicKey } from './wsl-host-ssh-octopod-conflict'
import {
  WslOctopodConnectionManager,
  type WslOctopodConnection,
  type WslOctopodConnectionDependencies
} from './wsl-octopod-connection'
import { defaultWslOctopodEnvironmentId, deployAndLaunchWslOctopod } from './wsl-octopod-deploy'
import { createWslOctopodHostTransport } from './wsl-octopod-host-transport'
import type { WslOctopodHostTarget } from './wsl-octopod-host-target'
import {
  decommissionWslHostOctopod,
  stopWslHostServer,
  wslHostRuntimeStopSteps,
  type WslHostRuntimeAccess
} from './wsl-host-server-stop'
import { createWslOctopodLivenessSupervisor } from './wsl-octopod-liveness-wiring'
import type { WslOctopodLivenessSupervisor } from './wsl-octopod-liveness-supervisor'
import { confirmsRunning } from './wsl-octopod-liveness-evidence'
import { wslDistroHolderKey } from './wsl-distro-holder-record'

function targetFor(distro: string): WslOctopodHostTarget {
  return { kind: 'wsl', id: defaultWslOctopodEnvironmentId(distro), distro, label: distro }
}

function transportFor(distro: string) {
  return createWslOctopodHostTransport({ target: targetFor(distro) })
}

type Reachability = WslHostReachability

export function createWslHostConnector(options: {
  userDataPath: string
  onChange: NonNullable<WslOctopodConnectionDependencies['onChange']>
  hasUserVisibleWork: (distro: string) => boolean
  /** False once a distro's host is gone: nothing may be spawned for it again. */
  isKnownDistro: (distro: string) => boolean
  runtime: WslHostRuntimeAccess
}): WslHostConnector {
  const refuseUnknown = (distro: string): Error =>
    new Error(`${distro} is no longer a WSL host; Shield will not start anything for it.`)
  // Assigned below; a holder exit cannot arrive before the first ensure.
  let supervisor: WslOctopodLivenessSupervisor | null = null
  const unguardedHolder = createWslDistroHolder({
    userDataPath: options.userDataPath,
    onHolderExit: (distro, exit) => supervisor?.noteHolderExit(distro, exit)
  })
  // Guard here because liveness recovery and deploy can bypass the service.
  const holder: WslDistroHolder = {
    ...unguardedHolder,
    ensureHeld: (distro) =>
      options.isKnownDistro(distro)
        ? unguardedHolder.ensureHeld(distro)
        : Promise.reject(refuseUnknown(distro))
  }
  const pairingRecovery = createWslOctopodPairingRecovery(options.userDataPath)
  const manager = new WslOctopodConnectionManager({
    holder,
    pairingRecovery,
    getPairingOffer: (environmentId) =>
      findWslHostDeployment(options.userDataPath, environmentId)
        ? resolveEnvironmentPairingOffer(options.userDataPath, environmentId)
        : null,
    recordedLocalPort: (environmentId) =>
      findWslHostDeployment(options.userDataPath, environmentId)?.localPort ?? null,
    onChange: options.onChange,
    deployAndLaunch: (distro, deployOptions) =>
      options.isKnownDistro(distro)
        ? deployAndLaunchWslOctopod(distro, deployOptions)
        : Promise.reject(refuseUnknown(distro))
  })
  const liveness = createWslOctopodLivenessSupervisor({
    manager,
    holder,
    hasUserVisibleWork: options.hasUserVisibleWork
  })
  supervisor = liveness
  // Read right before a no-boot reconnect spawns anything in the distro (E9).
  const requireRunning = async (distro: string): Promise<boolean> =>
    confirmsRunning(await readConfirmedRunningWslDistros(), wslDistroHolderKey(distro))
  const coldProbes = new Map<
    string,
    {
      connection: WslOctopodConnection | null
      pairingOffer: string | undefined
      result: Promise<Reachability>
    }
  >()
  const probe = async (
    distro: string,
    environmentId: string,
    connection: WslOctopodConnection | null
  ): Promise<Reachability> => {
    // Bridge dialing spawns wsl.exe; passive checks must first prove the distro runs.
    const running = await readConfirmedRunningWslDistros()
    if (running.status === 'unavailable') {
      return 'unavailable'
    }
    if (!confirmsRunning(running, wslDistroHolderKey(distro))) {
      return 'stopped'
    }
    if (!options.isKnownDistro(distro) || manager.get(distro) !== connection) {
      return 'unreachable'
    }
    if (options.runtime.isReady?.(environmentId)) {
      return 'available'
    }
    if (!connection) {
      return 'unreachable'
    }
    const offer = parsePairingCode(connection.pairingOffer)
    if (!offer) {
      return 'unreachable'
    }
    const identity = await verifyOctopodPairingIdentity(pairedRuntimeConnectionFromOffer(offer), {
      runtimeId: null
    })
    return identity.verdict === 'verified' && manager.get(distro) === connection
      ? 'available'
      : 'unreachable'
  }
  const coldReachability = (distro: string, environmentId: string): Promise<Reachability> => {
    const key = `${wslDistroHolderKey(distro)}\0${environmentId}`
    const connection = manager.get(distro)
    const pairingOffer = connection?.pairingOffer
    const pending = coldProbes.get(key)
    if (pending && pending.connection === connection && pending.pairingOffer === pairingOffer) {
      return pending.result
    }
    const result = probe(distro, environmentId, connection).finally(() => {
      if (coldProbes.get(key)?.result === result) {
        coldProbes.delete(key)
      }
    })
    coldProbes.set(key, { connection, pairingOffer, result })
    return result
  }
  return {
    listDistros: () => listWslHostDistros(),
    readOctopodPublicKey: (distro) => readWslDistroOctopodPublicKey(transportFor(distro)),
    connect: (distro, { noBoot, ...connectOptions } = {}) =>
      liveness.connect(distro, noBoot ? { ...connectOptions, requireRunning } : connectOptions),
    forgetPairingFailures: (environmentId) => pairingRecovery.repairs.forgetFailures(environmentId),
    get: (distro) => manager.get(distro),
    isReachable: async (distro, environmentId) =>
      options.runtime.isReady?.(environmentId) ||
      (await coldReachability(distro, environmentId)) === 'available',
    isSettling: (distro) => liveness.isSettling(distro),
    reachability: async (distro, environmentId) =>
      options.runtime.isReady?.(environmentId)
        ? 'available'
        : coldReachability(distro, environmentId),
    disconnect: (distro) => liveness.stop(distro),
    stopServer: async (distro, environmentId) => {
      const reachability = await coldReachability(distro, environmentId)
      if (reachability === 'unavailable') {
        return {
          stopped: false,
          reason: 'The WSL service did not confirm whether the distro runs.',
          verdict: 'unverifiable'
        }
      }
      if (reachability === 'stopped') {
        return { stopped: true }
      }
      if (reachability === 'unreachable') {
        await liveness.connect(distro)
      }
      const target = targetFor(distro)
      return stopWslHostServer({
        ...wslHostRuntimeStopSteps(options.runtime, environmentId),
        closeBridge: () => liveness.stop(distro),
        decommission: decommissionWslHostOctopod(target, createWslOctopodHostTransport({ target }))
      })
    },
    resolveDistroName: (distro, distroId) => resolveWslDistroName(distro, distroId),
    releaseHolder: async (distro) => {
      await holder.release(distro)
    },
    adoptHolders: async (isWanted) => {
      for (const { distro } of await holder.adoptHolders()) {
        if (!isWanted(distro)) {
          // Verified by pid, start time and command line; an unverifiable holder is kept.
          await holder.release(distro)
        }
      }
    },
    dispose: () => liveness.dispose()
  }
}
