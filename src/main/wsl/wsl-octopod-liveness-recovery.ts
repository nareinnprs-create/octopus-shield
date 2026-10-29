/** C4 recovery uses bounded relaunch backoff, then census before publishing terminal verdicts. Recovery is never a user action, so it needs a confirmed-running distro and never boots one (E9). */
import type { OctopodTerminalCensus } from '../../shared/octopod-terminal-census'
import type { WslRunningDistrosRead } from '../wsl-background-distro-gate'
import { wslDistroHolderKey } from './wsl-distro-holder-record'
import type { WslOctopodConnection, WslOctopodConnectOptions } from './wsl-octopod-connection'
import type { WslOctopodConnectionStatus } from './wsl-octopod-connection-status'
import type { WslLivenessVerdict } from './wsl-octopod-liveness-verdict'
import type { WslOctopodReconnectBackoff } from './wsl-octopod-reconnect-backoff'

export type WslOctopodRecoveryReason = 'octopod-exited' | 'distro-restarted' | 'distro-stopped'

export type WslOctopodRecoveryContext = {
  distro: string
  backoff: WslOctopodReconnectBackoff
  now: () => number
  /** False once the distro stopped being supervised or a newer recovery took over. */
  current: () => boolean
  wait: (delayMs: number) => Promise<void>
  publish: (status: WslOctopodConnectionStatus) => void
  ensure: (options: WslOctopodConnectOptions) => Promise<WslOctopodConnection>
  collectCensus: (connection: WslOctopodConnection) => Promise<OctopodTerminalCensus>
  /** Records the new octopod's identity and holds a fresh watch. */
  arm: (connection: WslOctopodConnection) => Promise<void>
  readRunning: () => Promise<WslRunningDistrosRead>
}

/** Ends ready, failed, or with the verdict the background gate found instead (returned). */
export async function recoverWslOctopod(
  context: WslOctopodRecoveryContext,
  reason: WslOctopodRecoveryReason
): Promise<WslLivenessVerdict | null> {
  const terminals = reason === 'octopod-exited' ? 'unverifiable' : 'exited'
  for (;;) {
    const decision = context.backoff.next(context.now())
    if (decision.kind === 'give-up') {
      context.publish({
        state: 'failed',
        reason: `Could not restart the Shield server in ${context.distro} after ${decision.attempts} attempts`,
        terminals
      })
      return null
    }
    const reconnecting = {
      state: 'reconnecting',
      reason,
      attempt: decision.attempt,
      terminals
    } as const
    context.publish({ ...reconnecting, retryInMs: decision.delayMs })
    await context.wait(decision.delayMs)
    if (!context.current()) {
      return null
    }
    const gate = backgroundRecoveryGate(await context.readRunning(), context.distro)
    if (gate || !context.current()) {
      return gate
    }
    try {
      const connection = await context.ensure({
        status: {
          pending: { ...reconnecting, retryInMs: null },
          ready: { ...reconnecting, reason: 'census', retryInMs: null }
        }
      })
      if (!context.current()) {
        return null
      }
      // Recount before marking terminals; the daemon may have preserved all sessions across octopod loss.
      const census = await context.collectCensus(connection)
      await context.arm(connection)
      if (context.current()) {
        context.publish({ state: 'ready', census })
      }
      return null
    } catch (error) {
      console.warn(
        `[wsl] reconnect to ${context.distro} failed:`,
        error instanceof Error ? error.message : error
      )
      if (!context.current()) {
        return null
      }
    }
  }
}

/** null lets a background recovery go ahead: the distro is confirmed running. */
export function backgroundRecoveryGate(
  running: WslRunningDistrosRead,
  distro: string
): WslLivenessVerdict | null {
  if (running.status !== 'confirmed') {
    return { kind: 'unverifiable', reason: 'running-list-unavailable' }
  }
  const key = wslDistroHolderKey(distro)
  return running.distros.some((candidate) => wslDistroHolderKey(candidate) === key)
    ? null
    : { kind: 'distro-stopped', corroborated: false }
}
