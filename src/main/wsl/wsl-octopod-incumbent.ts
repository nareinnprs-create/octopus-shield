/** E1: open a temporary bridge for incumbent census before activation. Unproven state is unverifiable, never zero; WSL has no standing deploy tunnel. */
import { pairedRuntimeConnectionFromOffer } from '../../shared/paired-runtime-connection'
import { parsePairingCode, type PairingOffer } from '../../shared/pairing'
import { OCTOPOD_MANAGED_REMOTE_PORT } from '../../shared/octopod-managed-runtime'
import {
  type OctopodTerminalCensus,
  UNVERIFIABLE_OCTOPOD_TERMINAL_CENSUS
} from '../../shared/octopod-terminal-census'
import type { ServeReadiness } from '../server/serve-readiness'
import { probeActiveOctopodReadiness } from '../ssh/octopod-active-readiness'
import { octopodBoundPort } from '../managed-server/lifecycle/octopod-managed-bound-port'
import { managedOctopodInstallDir } from '../managed-server/lifecycle/octopod-managed-runtime-context'
import { wakeStoppedManagedOctopod } from '../managed-server/lifecycle/octopod-managed-wake'
import type { OctopodRemoteContext } from '../managed-server/install/octopod-remote-context'
import type { OctopodSlotOptions } from '../ssh/octopod-recovery-slot'
import { readRemoteOctopodBuildHash } from '../managed-server/install/octopod-remote-build-hash'
import {
  requestOctopodTerminalCensus,
  type OctopodTerminalCensusRequestOptions
} from '../ssh/octopod-terminal-census-client'
import { updateTerminalCounts } from '../ssh/octopod-fenced-stop'
import { tunneledOctopodPairingCode } from '../ssh/octopod-tunneled-pairing'
import type { StartedPortForward } from '../ssh/port-forwarding/ssh-port-forward-provider'
import type { OctopodHostTransport } from '../ssh/octopod-host-transport'
import type { WslOctopodHostTarget } from './wsl-octopod-host-target'
import { listenWslOctopodStdioBridge } from './wsl-octopod-stdio-bridge'

export type WslOctopodIncumbent = {
  census: OctopodTerminalCensus
  /** The incumbent's proven readiness; null when it could not be started or proven. */
  readiness: ServeReadiness | null
  /** Recount without wake and close terminal admission before activation stops the incumbent; unreadable never means zero. */
  recount: () => Promise<OctopodTerminalCensus>
  /** Reopens the admission `recount` closed, when the incumbent keeps running. */
  releaseAdmission: () => Promise<void>
}

type IncumbentArgs = {
  context: OctopodRemoteContext<WslOctopodHostTarget>
  slot: OctopodSlotOptions
  /** This desktop's enrolled pairing; null before its first pairing. */
  paired?: PairingOffer | null
}

const UNREADABLE: WslOctopodIncumbent = {
  census: UNVERIFIABLE_OCTOPOD_TERMINAL_CENSUS,
  readiness: null,
  recount: async () => UNVERIFIABLE_OCTOPOD_TERMINAL_CENSUS,
  releaseAdmission: async () => {}
}

export type WslOctopodIncumbentDependencies = {
  wake: typeof wakeStoppedManagedOctopod
  probe: typeof probeActiveOctopodReadiness
  readBuildHash: typeof readRemoteOctopodBuildHash
  listen: (
    transport: OctopodHostTransport,
    remotePort: number,
    target: WslOctopodHostTarget
  ) => Promise<StartedPortForward>
  census: typeof requestOctopodTerminalCensus
}

const DEFAULT_DEPENDENCIES: WslOctopodIncumbentDependencies = {
  wake: wakeStoppedManagedOctopod,
  probe: probeActiveOctopodReadiness,
  readBuildHash: readRemoteOctopodBuildHash,
  listen: (transport, remotePort, target) =>
    listenWslOctopodStdioBridge(transport, {
      environmentId: target.id,
      remotePort,
      localPort: 0,
      label: `Shield server in WSL: ${target.label} (update check)`
    }),
  census: requestOctopodTerminalCensus
}

/** Wake reboot/idle-stopped incumbent, census its daemon, then close the temporary bridge before returning. */
export async function readWslOctopodIncumbent(
  args: IncumbentArgs,
  dependencies: WslOctopodIncumbentDependencies = DEFAULT_DEPENDENCIES
): Promise<WslOctopodIncumbent> {
  const record = args.context.activationRecord
  const activatedAt = record.activatedAt ? Date.parse(record.activatedAt) : Number.NaN
  if (!record.active || !Number.isFinite(activatedAt) || activatedAt < 0) {
    return UNREADABLE
  }
  let readiness: ServeReadiness
  try {
    const wake = await dependencies.wake(args.slot)
    if (wake.outcome === 'started') {
      readiness = wake.readiness
    } else if (wake.outcome === 'serving') {
      const remoteInstallDir = managedOctopodInstallDir(args.context, record.active)
      readiness = await dependencies.probe(
        { ...args.slot, remoteInstallDir },
        {
          buildHash: await dependencies.readBuildHash(args.slot, remoteInstallDir),
          fullVersion: record.active
        }
      )
    } else {
      return UNREADABLE
    }
  } catch {
    return UNREADABLE
  }
  const counts = updateTerminalCounts((options) =>
    countIncumbentTerminals(args, readiness, activatedAt, dependencies, options)
  )
  return {
    census: await counts.countFirst(),
    readiness,
    recount: counts.recountCensus,
    releaseAdmission: counts.releaseIncumbentAdmission
  }
}

async function countIncumbentTerminals(
  args: IncumbentArgs,
  readiness: ServeReadiness,
  activatedAt: number,
  dependencies: WslOctopodIncumbentDependencies,
  options: OctopodTerminalCensusRequestOptions
): Promise<OctopodTerminalCensus> {
  let forward: StartedPortForward | null = null
  try {
    forward = await dependencies.listen(
      args.slot.conn,
      octopodBoundPort(readiness) ?? OCTOPOD_MANAGED_REMOTE_PORT,
      args.context.target
    )
    // Use enrolled grants; startup offers would enroll a fresh device on every census.
    const offer = parsePairingCode(
      tunneledOctopodPairingCode(readiness, forward.entry.localPort, args.paired)
    )
    if (!offer) {
      return UNVERIFIABLE_OCTOPOD_TERMINAL_CENSUS
    }
    return await dependencies.census(
      pairedRuntimeConnectionFromOffer(offer),
      activatedAt,
      undefined,
      options
    )
  } catch {
    return UNVERIFIABLE_OCTOPOD_TERMINAL_CENSUS
  } finally {
    await forward?.close().catch(() => {})
  }
}
