// Restart only proven-stopped slots; unverifiable serving state never proves terminal exit.
import type { KnownRuntimeEnvironment } from '../../../shared/runtime-environments'
import type { SshTarget } from '../../../shared/ssh-types'
import { octopodBoundPort } from './octopod-managed-bound-port'
import { managedOctopodSlot } from './octopod-managed-runtime-context'
import { wakeStoppedManagedOctopod } from './octopod-managed-wake'
import { resolveOctopodRemoteContext } from '../install/octopod-remote-context'
import type { OctopodHostTransport } from '../../ssh/octopod-host-transport'

export type OctopodManagedServing =
  | { state: 'serving' }
  /** Forwards must follow the restarted server's bound port. */
  | { state: 'started'; boundPort: number | null }
  | { state: 'unverifiable'; detail: string }

export type OctopodManagedServingInput = {
  environment: KnownRuntimeEnvironment
  target: SshTarget
  connection: OctopodHostTransport
  remotePort: number
  probe: (environment: KnownRuntimeEnvironment, timeoutMs: number) => Promise<boolean>
  answeredAt?: (environmentId: string) => number | null
}

export const MANAGED_OCTOPOD_FENCED_DETAIL =
  'An update, rollback or recovery holds this host; it was not started.'

export const MANAGED_OCTOPOD_NOT_ACTIVATED_DETAIL = 'This host has no activated Shield server to start.'

const PROBE_TIMEOUT_MS = 5_000
// Share connect/tunnel verdicts only for the same transport and port; reboots/rebinds need fresh checks.
const VERDICT_REUSE_MS = 5_000
// Recent control-socket pongs prove serving; stop/reboot/rebind closes that socket.
const LIVE_ANSWER_PROOF_MS = 20_000

type ServingTransport = { connection: OctopodHostTransport; generation: number; remotePort: number }
// Reconnected transports need fresh checks instead of inheriting dropped-connection failures.
type ServingCheck = ServingTransport & { check: Promise<OctopodManagedServing>; settledAt?: number }
const checks = new Map<string, ServingCheck>()

function sameTransport(a: ServingTransport, b: ServingTransport): boolean {
  return (
    a.connection === b.connection && a.generation === b.generation && a.remotePort === b.remotePort
  )
}
export type ManagedOctopodStartListener = {
  starting: (target: SshTarget) => void
  /** Unverifiable results include the reason and log tail. */
  settled: (target: SshTarget, environmentId: string, serving: OctopodManagedServing) => void
}

let startListener: ManagedOctopodStartListener | null = null

export function setManagedOctopodStartListener(listener: ManagedOctopodStartListener | null): void {
  startListener = listener
}

export function ensureManagedOctopodServing(
  input: OctopodManagedServingInput,
  now: () => number = Date.now
): Promise<OctopodManagedServing> {
  const id = input.environment.id
  const transport: ServingTransport = {
    connection: input.connection,
    generation: input.connection.getConnectGeneration(),
    remotePort: input.remotePort
  }
  const entry = checks.get(id)
  if (
    entry &&
    sameTransport(entry, transport) &&
    (entry.settledAt === undefined || now() - entry.settledAt < VERDICT_REUSE_MS)
  ) {
    return entry.check
  }
  const answeredAt = input.answeredAt?.(id) ?? null
  const answerAge = answeredAt === null ? null : now() - answeredAt
  // Clock rollback must not extend the proof window.
  if (answerAge !== null && answerAge >= 0 && answerAge < LIVE_ANSWER_PROOF_MS) {
    return Promise.resolve({ state: 'serving' })
  }
  const next: ServingCheck = { ...transport, check: checkAndStart(input) }
  checks.set(id, next)
  void next.check.then(
    () => {
      next.settledAt = now()
    },
    () => {
      next.settledAt = -Infinity
    }
  )
  return next.check
}

export function resetManagedOctopodServingForTests(): void {
  checks.clear()
}

async function checkAndStart(input: OctopodManagedServingInput): Promise<OctopodManagedServing> {
  if (await input.probe(input.environment, PROBE_TIMEOUT_MS)) {
    return { state: 'serving' }
  }
  let starting = false
  const serving = await wakeIfStopped(input, () => {
    starting = true
    startListener?.starting(input.target)
  })
  if (starting) {
    startListener?.settled(input.target, input.environment.id, serving)
  }
  return serving
}

async function wakeIfStopped(
  input: OctopodManagedServingInput,
  onStarting: () => void
): Promise<OctopodManagedServing> {
  const label = input.target.label
  try {
    const context = await resolveOctopodRemoteContext(input.target, input.connection)
    const wake = await wakeStoppedManagedOctopod(
      managedOctopodSlot(context, input.remotePort),
      onStarting
    )
    if (wake.outcome === 'started') {
      const idle = wake.readiness.health?.previousIdleStop
      const cause = idle
        ? `it had stopped after idling at ${idle.stoppedAt}`
        : 'it had stopped without an idle-stop record (crash, signal or host restart)'
      console.info(`[ssh] Started the managed Shield server on ${label}; ${cause}.`)
      return { state: 'started', boundPort: octopodBoundPort(wake.readiness) }
    }
    // A live unanswered process may still be starting; never restart it.
    if (wake.outcome === 'serving') {
      // A live PID alone does not prove the server answers.
      if (await input.probe(input.environment, PROBE_TIMEOUT_MS)) {
        return { state: 'serving' }
      }
      const detail = 'This host’s Shield server process is live but is not answering.'
      console.warn(`[ssh] The managed Shield server on ${label} is not answering: ${detail}`)
      return { state: 'unverifiable', detail }
    }
    const detail = wake.outcome === 'recovery-refused' ? wake.reason : wakeRefusal(wake.outcome)
    console.warn(`[ssh] The managed Shield server on ${label} is not answering: ${detail}`)
    return { state: 'unverifiable', detail }
  } catch (error) {
    console.warn(`[ssh] Could not start the managed Shield server on ${label}:`, error)
    return { state: 'unverifiable', detail: error instanceof Error ? error.message : String(error) }
  }
}

function wakeRefusal(outcome: 'not-activated' | 'unverifiable' | 'fenced'): string {
  switch (outcome) {
    case 'fenced':
      return MANAGED_OCTOPOD_FENCED_DETAIL
    case 'not-activated':
      return MANAGED_OCTOPOD_NOT_ACTIVATED_DETAIL
    case 'unverifiable':
      return 'Whether the server process is still running could not be proven, so it was not started.'
  }
}
