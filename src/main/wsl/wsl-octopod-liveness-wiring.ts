/** C7 supplies visible demand; these production probes serve the WSL liveness supervisor. */
import { pairedRuntimeConnectionFromOffer } from '../../shared/paired-runtime-connection'
import { parsePairingCode } from '../../shared/pairing'
import {
  type OctopodTerminalCensus,
  UNVERIFIABLE_OCTOPOD_TERMINAL_CENSUS
} from '../../shared/octopod-terminal-census'
import { requestOctopodTerminalCensus } from '../ssh/octopod-terminal-census-client'
import { subscribeSystemPowerLifecycle } from '../system-power-lifecycle'
import {
  deferUntilWslDistroRunning,
  readConfirmedRunningWslDistros,
  readSettledConfirmedRunningWslDistros
} from '../wsl-background-distro-gate'
import type { WslDistroHolder } from './wsl-distro-holder'
import { wslDistroHolderKey } from './wsl-distro-holder-record'
import { readWslGuestIdentity } from './wsl-guest-process-identity'
import type { WslOctopodConnection, WslOctopodConnectionManager } from './wsl-octopod-connection'
import { defaultWslOctopodEnvironmentId } from './wsl-octopod-deploy'
import { confirmsRunning, EXIT_SETTLE_MS } from './wsl-octopod-liveness-evidence'
import { WslOctopodLivenessSupervisor } from './wsl-octopod-liveness-supervisor'
import { createWslOctopodHostTransport } from './wsl-octopod-host-transport'
import { openWslOctopodWatch } from './wsl-octopod-watch'

function transportFor(distro: string, environmentId = defaultWslOctopodEnvironmentId(distro)) {
  return createWslOctopodHostTransport({
    target: { kind: 'wsl', id: environmentId, distro, label: distro }
  })
}

/** Every session counts (activation time 0): liveness asks how many survived, not how new. */
function collectWslOctopodCensus(connection: WslOctopodConnection): Promise<OctopodTerminalCensus> {
  const offer = parsePairingCode(connection.pairingOffer)
  return offer
    ? requestOctopodTerminalCensus(pairedRuntimeConnectionFromOffer(offer), 0)
    : Promise.resolve(UNVERIFIABLE_OCTOPOD_TERMINAL_CENSUS)
}

export function createWslOctopodLivenessSupervisor(options: {
  manager: WslOctopodConnectionManager
  holder: WslDistroHolder
  hasUserVisibleWork: (distro: string) => boolean
}): WslOctopodLivenessSupervisor {
  return new WslOctopodLivenessSupervisor({
    manager: options.manager,
    readRunning: (afterExit) =>
      afterExit
        ? readSettledConfirmedRunningWslDistros(
            afterExit.distro,
            afterExit.exitedAt === null ? undefined : afterExit.exitedAt + EXIT_SETTLE_MS
          )
        : readConfirmedRunningWslDistros(),
    readIdentity: (distro, octopodPid) => readWslGuestIdentity(transportFor(distro), octopodPid),
    openWatch: (connection) =>
      openWslOctopodWatch(
        transportFor(connection.distro, connection.environmentId),
        connection.remotePort
      ),
    collectCensus: collectWslOctopodCensus,
    hasUserVisibleWork: options.hasUserVisibleWork,
    deferUntilRunning: deferUntilWslDistroRunning,
    requireRunning: async (distro) =>
      confirmsRunning(await readConfirmedRunningWslDistros(), wslDistroHolderKey(distro)),
    ensureHolder: (distro) => options.holder.ensureHeld(distro),
    subscribePower: subscribeSystemPowerLifecycle
  })
}
