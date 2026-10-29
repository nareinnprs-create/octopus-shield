/** One in-memory connection per distro: C4 launch, C5 stdio bridge and loopback-rewritten pairing. Rebind when octopod moves ports; C7 persists onChange results. */
import type {
  WslOctopodConnection,
  WslOctopodConnectionDependencies
} from './wsl-octopod-connection-types'
import {
  assertWslDistroMayStart,
  isQuietConnectFailure,
  WslOctopodConnectionSupersededError,
  WslOctopodLaunchDeferredError
} from './wsl-octopod-connection-errors'
import type { WslHostConnectIntent } from '../../shared/wsl-host-types'
import { errorMessage } from '../../shared/error-message'
import { parsePairingCode, type PairingOffer } from '../../shared/pairing'
import type { OctopodHostTransport } from '../ssh/octopod-host-transport'
import type { StartedPortForward } from '../ssh/port-forwarding/ssh-port-forward-provider'
import {
  wslConnectFailedStatus,
  type WslOctopodConnectionStatus
} from './wsl-octopod-connection-status'
import { wslDistroHolderKey } from './wsl-distro-holder-record'
import {
  defaultWslOctopodEnvironmentId,
  deployAndLaunchWslOctopod,
  type WslOctopodLaunch
} from './wsl-octopod-deploy'
import type { WslOctopodHostTarget } from './wsl-octopod-host-target'
import { createWslOctopodHostTransport } from './wsl-octopod-host-transport'
import { resolveWslOctopodPairing } from './wsl-octopod-pairing-identity'
import { trackWslOctopodHostEnvironment } from './wsl-octopod-host-environments'
import { listenWslOctopodStdioBridgeOnPreferredPort } from './wsl-octopod-stdio-bridge'

export type {
  WslOctopodConnection,
  WslOctopodConnectionDependencies
} from './wsl-octopod-connection-types'

export type WslOctopodConnectOptions = {
  environmentId?: string
  label?: string
  /** Rebinds a port a persisted pairing offer already names; 0 or absent picks a free one. */
  localPort?: number
  intent?: WslHostConnectIntent
  signal?: AbortSignal
  /** What `onChange` reports while this connect runs and once it is ready (liveness recovery). */
  status?: WslOctopodConnectStatus
  /** E9 no-boot reconnect: refuse unless this confirms the distro runs, right before any spawn. */
  requireRunning?: (distro: string) => Promise<boolean>
}

type WslOctopodConnectStatus = { pending: WslOctopodConnectionStatus; ready: WslOctopodConnectionStatus }

const CONNECTING: WslOctopodConnectionStatus = { state: 'connecting' }
const READY: WslOctopodConnectionStatus = { state: 'ready', census: null }

type ActiveWslOctopodConnection = {
  connection: WslOctopodConnection
  forward: StartedPortForward
}

export class WslOctopodConnectionManager {
  private readonly active = new Map<string, ActiveWslOctopodConnection>()
  private readonly inFlight = new Map<
    string,
    { promise: Promise<WslOctopodConnection>; noBoot: boolean }
  >()
  private readonly generations = new Map<string, number>()

  constructor(private readonly dependencies: WslOctopodConnectionDependencies = {}) {}

  /** Joins a connect already running for this distro rather than racing a second bridge. */
  ensure(distro: string, options: WslOctopodConnectOptions = {}): Promise<WslOctopodConnection> {
    const name = distro.trim()
    if (!name) {
      return Promise.reject(new Error('A WSL distro name is required'))
    }
    const key = wslDistroHolderKey(name)
    const pending = this.inFlight.get(key)
    if (pending) {
      if (!options.intent && (!pending.noBoot || options.requireRunning)) {
        return pending.promise
      }
      // Update/Force needs its own deploy, and a connect that may boot can't ride on one that may
      // not (it would refuse a stopped distro the user asked for); run after it instead.
      const generation = this.generation(key)
      return pending.promise
        .catch(() => {})
        .then(() => {
          if (this.generation(key) !== generation) {
            throw new WslOctopodConnectionSupersededError(name)
          }
          return this.ensure(distro, options)
        })
    }
    const status = options.status ?? { pending: CONNECTING, ready: READY }
    // Unchanged live refresh stays quiet; liveness recovery must publish.
    // A no-boot connect may be refused quietly, so it must not leave the row on "Connecting";
    // an explicit status (liveness recovery) is still published.
    if (options.status || (!this.active.has(key) && !options.requireRunning)) {
      this.dependencies.onChange?.(name, this.get(name), status.pending)
    }
    const operation = this.connect(name, key, options, status).catch((error: unknown) => {
      // Liveness owns reconnect status; superseded and no-boot-refused connects publish nothing.
      if (!options.status && !isQuietConnectFailure(error)) {
        const deferral = error instanceof WslOctopodLaunchDeferredError ? error.launch : null
        const failed = wslConnectFailedStatus(errorMessage(error), deferral)
        this.dependencies.onChange?.(name, this.get(name), failed)
      }
      throw error
    })
    const tracked: Promise<WslOctopodConnection> = operation.finally(() => {
      if (this.inFlight.get(key)?.promise === tracked) {
        this.inFlight.delete(key)
      }
    })
    this.inFlight.set(key, { promise: tracked, noBoot: Boolean(options.requireRunning) })
    return tracked
  }

  /** Prefer persisted enrollment; only unrecorded hosts fall back to their live connection offer. */
  private enrolledOffer(key: string, environmentId: string): PairingOffer | null {
    const current = this.active.get(key)?.connection
    return (
      this.dependencies.getPairingOffer?.(environmentId) ??
      (current?.environmentId === environmentId ? parsePairingCode(current.pairingOffer) : null)
    )
  }

  get(distro: string): WslOctopodConnection | null {
    return this.active.get(wslDistroHolderKey(distro))?.connection ?? null
  }

  /** Liveness reports a status change for a distro, with whatever connection it has now. */
  publish(distro: string, status: WslOctopodConnectionStatus): void {
    this.dependencies.onChange?.(distro, this.get(distro), status)
  }

  list(): WslOctopodConnection[] {
    return [...this.active.values()].map((entry) => entry.connection)
  }

  async close(distro: string): Promise<void> {
    const key = wslDistroHolderKey(distro)
    this.generations.set(key, this.generation(key) + 1)
    const entry = this.active.get(key)
    if (!entry) {
      return
    }
    await this.drop(key, entry)
    this.dependencies.onChange?.(entry.connection.distro, null, { state: 'closed' })
  }

  /**
   * Ends the loopback listener but keeps the published status: once octopod idled out or the distro
   * stopped, any dial to it would spawn wsl.exe and boot the distro again.
   */
  async retireListener(distro: string): Promise<void> {
    const key = wslDistroHolderKey(distro)
    const entry = this.active.get(key)
    // A user connect in flight owns the next entry; retiring it would undo that connect.
    if (entry && !this.inFlight.has(key)) {
      await this.drop(key, entry)
    }
  }

  /** Retires one bridge; unlike close, a connect queued behind it still runs. */
  private async drop(key: string, entry: ActiveWslOctopodConnection): Promise<void> {
    if (this.active.get(key) === entry) {
      this.active.delete(key)
    }
    await entry.forward.close()
    trackWslOctopodHostEnvironment(entry.connection, null)
  }

  async dispose(): Promise<void> {
    const keys = new Set([...this.active.keys(), ...this.inFlight.keys()])
    await Promise.all([...keys].map((key) => this.close(key)))
  }

  private generation(key: string): number {
    return this.generations.get(key) ?? 0
  }

  private async connect(
    distro: string,
    key: string,
    options: WslOctopodConnectOptions,
    status: WslOctopodConnectStatus
  ): Promise<WslOctopodConnection> {
    // Taken before any await, so a close during the running-list read still supersedes this.
    const generation = this.generation(key)
    const stillCurrent = (): boolean => this.generation(key) === generation
    const requireRunning = options.requireRunning
    await assertWslDistroMayStart(distro, requireRunning, stillCurrent)
    const environmentId = options.environmentId ?? defaultWslOctopodEnvironmentId(distro)
    const label = options.label ?? distro
    const target = { kind: 'wsl', id: environmentId, distro, label } as const
    const transport = (this.dependencies.createTransport ?? defaultTransport)(target)
    // Relaunch stopped octopod on each connect so distro restarts recover.
    const launch = await (this.dependencies.deployAndLaunch ?? deployAndLaunchWslOctopod)(distro, {
      environmentId,
      label,
      intent: options.intent,
      pairedOffer: this.enrolledOffer(key, environmentId),
      signal: options.signal,
      holder: this.dependencies.holder,
      createTransport: () => transport,
      ...(requireRunning ? { requireRunning: () => requireRunning(distro) } : {})
    })
    if (launch.outcome === 'deferred') {
      throw new WslOctopodLaunchDeferredError(launch)
    }
    if (this.generation(key) !== generation) {
      throw new WslOctopodConnectionSupersededError(distro)
    }
    const current = this.active.get(key)
    const persisted = this.dependencies.getPairingOffer?.(environmentId) ?? null
    const paired = persisted ?? this.enrolledOffer(key, environmentId)
    // Repair only persisted enrollment; an in-progress Add has no stored record to repair.
    const recovery =
      persisted && this.dependencies.pairingRecovery
        ? { ...this.dependencies.pairingRecovery, environmentId }
        : undefined
    if (
      current &&
      current.connection.remotePort === launch.port &&
      current.connection.environmentId === environmentId
    ) {
      const pairingOffer = await resolveWslOctopodPairing(
        launch,
        current.connection.localPort,
        paired,
        this.dependencies.verifyIdentity,
        recovery
      ).catch(async (error: unknown) => {
        // Retire the rejected bridge or publishing its stale token would overwrite pairing repaired by the gate.
        await this.drop(key, current)
        throw error
      })
      if (this.generation(key) !== generation) {
        throw new WslOctopodConnectionSupersededError(distro)
      }
      return this.refreshOffer(
        key,
        current,
        launch,
        pairingOffer,
        options.status ? status.ready : null
      )
    }
    // Port changes invalidate the old bridge; reuse its local port, else the recorded one, when possible.
    const preferredLocalPort =
      current?.connection.localPort ??
      options.localPort ??
      this.dependencies.recordedLocalPort?.(environmentId) ??
      0
    if (current) {
      await this.drop(key, current)
      this.dependencies.onChange?.(distro, null, status.pending)
    }
    const forward = await listenWslOctopodStdioBridgeOnPreferredPort(
      transport,
      {
        environmentId,
        remotePort: launch.port,
        localPort: preferredLocalPort,
        label: `Shield server in WSL: ${label}`
      },
      this.dependencies.listen
    )
    try {
      if (this.generation(key) !== generation) {
        throw new WslOctopodConnectionSupersededError(distro)
      }
      const pairingOffer = await resolveWslOctopodPairing(
        launch,
        forward.entry.localPort,
        paired,
        this.dependencies.verifyIdentity,
        recovery
      )
      if (this.generation(key) !== generation) {
        throw new WslOctopodConnectionSupersededError(distro)
      }
      const entry: ActiveWslOctopodConnection = {
        forward,
        connection: {
          distro,
          environmentId,
          localPort: forward.entry.localPort,
          remotePort: launch.port,
          fullVersion: launch.fullVersion,
          pid: launch.pid,
          pairingOffer,
          deferredUpdate: launch.deferredUpdate ?? null,
          close: () => this.closeEntry(key, entry)
        }
      }
      this.active.set(key, entry)
      trackWslOctopodHostEnvironment(entry.connection, entry.connection)
      this.dependencies.onChange?.(distro, entry.connection, status.ready)
      return entry.connection
    } catch (error) {
      await forward.close()
      throw error
    }
  }

  private refreshOffer(
    key: string,
    entry: ActiveWslOctopodConnection,
    launch: Extract<WslOctopodLaunch, { outcome: 'ready' }>,
    pairingOffer: string,
    /** Reported even when nothing changed; null stays quiet then. */
    announce: WslOctopodConnectionStatus | null
  ): WslOctopodConnection {
    const deferredUpdate = launch.deferredUpdate ?? null
    const changed =
      pairingOffer !== entry.connection.pairingOffer ||
      launch.fullVersion !== entry.connection.fullVersion ||
      launch.pid !== entry.connection.pid ||
      JSON.stringify(deferredUpdate) !== JSON.stringify(entry.connection.deferredUpdate)
    if (changed) {
      const { fullVersion, pid } = launch
      entry.connection = { ...entry.connection, pairingOffer, fullVersion, pid, deferredUpdate }
      this.active.set(key, entry)
    }
    trackWslOctopodHostEnvironment(entry.connection, entry.connection)
    if (changed || announce) {
      this.dependencies.onChange?.(entry.connection.distro, entry.connection, announce ?? READY)
    }
    return entry.connection
  }

  private async closeEntry(key: string, entry: ActiveWslOctopodConnection): Promise<void> {
    if (this.active.get(key) === entry) {
      await this.close(key)
    }
  }
}

function defaultTransport(target: WslOctopodHostTarget): OctopodHostTransport {
  return createWslOctopodHostTransport({ target })
}
