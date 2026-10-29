/** Only positive host evidence proves slot exit. Unanswered probes stay unverifiable and never authorize starting a second slot. */
import type { ServeReadiness } from '../server/serve-readiness'
import type { OctopodActivationExpectation } from '../managed-server/activation/octopod-activation-gate'
import { OCTOPOD_INSTALL_MODEL } from '../managed-server/install/remote-install-model'
import { computeRemoteInstallDir } from '../managed-server/install/remote-versioned-install'
import { readRemoteOctopodBuildHash } from '../managed-server/install/octopod-remote-build-hash'
import {
  launchOctopodSlotAndAwaitReadiness,
  OctopodActiveReadinessError,
  probeActiveOctopodReadiness
} from './octopod-active-readiness'
import {
  octopodLivenessProbeCommand,
  octopodLivenessProvenExited,
  parseOctopodLiveness,
  type OctopodLiveness
} from '../managed-server/install/octopod-remote-launch'
import {
  parseOctopodStopOutcome,
  stopOctopodCommand,
  type OctopodStopOutcome
} from '../managed-server/install/octopod-remote-process-control'
import {
  execOctopodRemote,
  type OctopodRemoteExecTarget
} from '../managed-server/install/octopod-remote-runtime-control'
import { octopodActivationTransactionRoot } from '../managed-server/activation/octopod-activation-transaction'
import {
  initialOctopodActivationAdmissionCommand,
  parseInitialOctopodActivationAdmission
} from './octopod-initial-activation-admission'

export const OCTOPOD_SLOT_STOP_WAIT_SECONDS = 20

export type OctopodSlotOptions = OctopodRemoteExecTarget & {
  remoteHome: string
  /** Host Node for legacy slots only; a slot's own runtime marker wins. */
  nodePath: string
  userDataDir: string
  bindHost: string
  port: number
  readinessTimeoutMs?: number
  sleep?: (ms: number) => Promise<void>
}

export type OctopodSlotIdentity = { version: string; remoteDir: string; buildHash: string }

function expectation(identity: OctopodSlotIdentity): OctopodActivationExpectation {
  return { buildHash: identity.buildHash, fullVersion: identity.version }
}

export function octopodSlotDir(options: OctopodSlotOptions, version: string): string {
  return computeRemoteInstallDir(OCTOPOD_INSTALL_MODEL, options.remoteHome, version)
}

/** Hash installed bytes so readiness must prove the same build. */
export async function resolveOctopodSlotIdentity(
  options: OctopodSlotOptions,
  version: string
): Promise<OctopodSlotIdentity> {
  const remoteDir = octopodSlotDir(options, version)
  return { version, remoteDir, buildHash: await readRemoteOctopodBuildHash(options, remoteDir) }
}

export function launchOctopodSlot(
  options: OctopodSlotOptions,
  identity: OctopodSlotIdentity
): Promise<ServeReadiness> {
  return launchOctopodSlotAndAwaitReadiness(
    options,
    {
      remoteInstallDir: identity.remoteDir,
      nodePath: options.nodePath,
      fullVersion: identity.version,
      userDataDir: options.userDataDir,
      bindHost: options.bindHost,
      port: options.port,
      // Every SSH launch is client-managed, so every one may idle out and be woken on connect.
      activationRoot: octopodActivationTransactionRoot(options.host, options.remoteHome)
    },
    expectation(identity)
  )
}

/** Proves the slot serves, starting it only on proven exit. */
export async function ensureOctopodSlotServing(
  options: OctopodSlotOptions,
  identity: OctopodSlotIdentity
): Promise<ServeReadiness> {
  const liveness = parseOctopodLiveness(
    await execOctopodRemote(options, octopodLivenessProbeCommand(options.host, identity.remoteDir))
  )
  if (liveness === 'LIVE') {
    return probeActiveOctopodReadiness(
      { ...options, remoteInstallDir: identity.remoteDir },
      expectation(identity)
    )
  }
  if (!octopodLivenessProvenExited(liveness)) {
    throw new OctopodActiveReadinessError(
      'unverifiable',
      `octopod ${identity.version} process state is unverifiable.`
    )
  }
  return launchOctopodSlot(options, identity)
}

/** `justLaunched` only for a slot this run started; otherwise the readiness PID must agree. */
export async function stopOctopodSlot(
  options: OctopodSlotOptions,
  remoteDir: string,
  justLaunched: boolean
): Promise<OctopodStopOutcome> {
  return parseOctopodStopOutcome(
    await execOctopodRemote(
      options,
      stopOctopodCommand(
        options.host,
        remoteDir,
        justLaunched
          ? { waitSeconds: OCTOPOD_SLOT_STOP_WAIT_SECONDS, justLaunched: true }
          : { waitSeconds: OCTOPOD_SLOT_STOP_WAIT_SECONDS, nodePath: options.nodePath }
      )
    )
  )
}

type OctopodSlotQuiescence = 'exited' | 'other-slot-serving'

/** Prove candidate exit before replacing state and rule out another running slot, unless it already serves. Missing PID files prove nothing: SSH may drop after nohup but before $! is recorded, so inspect data-root ownership. */
export async function quiesceInterruptedOctopodSlot(
  options: OctopodSlotOptions,
  /** `null` when nothing was launched, so only `otherSlot` needs ruling out. */
  version: string | null,
  otherSlot: OctopodSlotIdentity | null
): Promise<OctopodSlotQuiescence> {
  const remoteDir = version === null ? null : octopodSlotDir(options, version)
  const stopped =
    remoteDir === null ? 'already-exited' : await stopOctopodSlot(options, remoteDir, false)
  let exited = stopped === 'stopped' || stopped === 'already-exited'
  if ((stopped === 'unknown' || stopped === 'unconfirmed') && remoteDir !== null) {
    // No verified answer, e.g. the slot died before readiness; liveness decides.
    exited = octopodLivenessProvenExited(await slotLiveness(options, remoteDir))
  }
  if (otherSlot) {
    const other = await slotLiveness(options, otherSlot.remoteDir)
    if (other === 'LIVE' && (exited || stopped === 'no-pid')) {
      // The serving slot holds the instance lock, so a PID-less launch cannot own the state.
      await probeActiveOctopodReadiness(
        { ...options, remoteInstallDir: otherSlot.remoteDir },
        expectation(otherSlot)
      )
      return 'other-slot-serving'
    }
    if (!octopodLivenessProvenExited(other)) {
      throw new OctopodActiveReadinessError(
        'unverifiable',
        `octopod ${version ?? 'candidate'} (${stopped}) and ${otherSlot.version} (${other}) cannot both be ` +
          'ruled out as owners of the shared state; it was not replaced.'
      )
    }
  }
  if (!exited && stopped === 'no-pid' && remoteDir !== null) {
    const admission = parseInitialOctopodActivationAdmission(
      await execOctopodRemote(
        options,
        initialOctopodActivationAdmissionCommand(
          options.host,
          options.userDataDir,
          remoteDir,
          options.nodePath
        )
      )
    )
    exited = admission.decision === 'proceed'
  }
  if (!exited) {
    throw new OctopodActiveReadinessError(
      'unverifiable',
      `octopod ${version ?? 'candidate'} could not be confirmed stopped (${stopped}); replacing its state would be unsafe.`
    )
  }
  return 'exited'
}

export async function slotLiveness(
  options: OctopodSlotOptions,
  remoteDir: string
): Promise<OctopodLiveness> {
  return parseOctopodLiveness(
    await execOctopodRemote(options, octopodLivenessProbeCommand(options.host, remoteDir))
  )
}
