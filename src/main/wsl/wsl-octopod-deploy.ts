/** D1/D2b/D8 reuse SSH installation, activation journals/fences and admission over wsl.exe. C5 pairs through the reported loopback port. */
import { getAppEnvironment } from '../../shared/app-environment'
import type { PairingOffer } from '../../shared/pairing'
import { OCTOPOD_MANAGED_REMOTE_PORT } from '../../shared/octopod-managed-runtime'
import type { ServeReadiness } from '../server/serve-readiness'
import type { WslHostDeferredUpdate } from '../../shared/wsl-host-types'
import { recoverInterruptedOctopodActivation } from '../managed-server/activation/octopod-activation-recovery'
import { readOctopodActivationRecord } from '../managed-server/activation/octopod-activation-record-store'
import { readOctopodActivationTransaction } from '../managed-server/activation/octopod-activation-transaction-store'
import { materializeOctopodArtifact } from '../octopod/octopod-artifact-materializer'
import { OctopodHostUnsupportedError } from '../octopod/octopod-host-unavailable'
import type { OctopodHostTransport } from '../ssh/octopod-host-transport'
import { OCTOPOD_ACTIVATION_POLICY_REFUSED_CODE } from '../ssh/octopod-installed-activation'
import { octopodBoundPort } from '../managed-server/lifecycle/octopod-managed-bound-port'
import {
  isForceableOctopodDeferral,
  managedOctopodDeployPolicy,
  managedOctopodInstallDir,
  managedOctopodSlot,
  probeManagedOctopodReadiness
} from '../managed-server/lifecycle/octopod-managed-runtime-context'
import { isWaitingOctopodUpdateDeferral } from '../managed-server/lifecycle/octopod-managed-auto-update'
import { clearOctopodUpdateFailedThisLaunch } from '../managed-server/lifecycle/octopod-managed-update-failure-memory'
import type { OctopodUpdateIntent } from '../managed-server/lifecycle/octopod-managed-update-decision'
import type { OctopodActivationRecord } from '../managed-server/activation/octopod-activation-record'
import { errorMessage } from '../../shared/error-message'
import { pruneManagedOctopodVersions } from '../managed-server/lifecycle/octopod-managed-version-gc'
import { wakeAlreadyActiveOctopod } from '../ssh/octopod-already-active-wake'
import { OctopodActiveReadinessError } from '../ssh/octopod-active-readiness'
import { WslDistroNotRunningError } from './wsl-octopod-connection-errors'
import { resolveOctopodRemoteContext } from '../managed-server/install/octopod-remote-context'
import { deployOctopod } from '../ssh/octopod-remote-deploy'
import { OCTOPOD_PID_FILENAME } from '../managed-server/install/octopod-remote-host-support'
import { quotePosixShell } from '../../shared/shell-argument-quoting'
import { execCommand } from '../ssh/remote-exec/remote-exec-command'
import { joinRemotePath } from '../ssh/ssh-remote-platform'
import { readLocalFullVersion } from '../managed-server/install/remote-versioned-install'
import { createWslDistroHolder, type WslDistroHolder } from './wsl-distro-holder'
import { wslDistroHolderKey } from './wsl-distro-holder-record'
import { readWslDistroRegistryIdShared } from './wsl-distro-registry-id'
import type { WslOctopodHostTarget } from './wsl-octopod-host-target'
import { createWslOctopodHostTransport, type WslOctopodHostTransport } from './wsl-octopod-host-transport'
import { readWslOctopodIncumbent, type WslOctopodIncumbent } from './wsl-octopod-incumbent'
import { adoptUnrecordedWslOctopod } from './wsl-octopod-instance-adoption'
import {
  admitWslOctopodLaunch,
  recordWslOctopodUpdateFailure,
  wslOctopodDeferralCode,
  wslOctopodDeferralFailure
} from './wsl-octopod-update-admission'
import { withOwnBuildLaunchEnv } from './wsl-octopod-own-build-launch-env'

/** An update this app carries that the host may not take yet; the incumbent keeps serving. */
export type WslOctopodDeferredUpdate = WslHostDeferredUpdate

export type WslOctopodLaunch =
  | {
      outcome: 'ready'
      distro: string
      /** The Lxss registration GUID for the deployment record's `distroId`; null if unreadable. */
      distroId: string | null
      /** The loopback port octopod bound inside the distro (another one when the preferred was taken). */
      port: number
      fullVersion: string
      pid: number | null
      readiness: ServeReadiness
      holder: 'adopted' | 'spawned' | 'unverifiable'
      /** An octopod the record did not name (e.g. left by a failed Remove), now recorded. */
      adoptedInstance?: { version: string; pid: number }
      /** Set when `fullVersion` is the incumbent because the update must wait. */
      deferredUpdate?: WslOctopodDeferredUpdate
    }
  | ({ outcome: 'deferred'; distro: string } & WslOctopodDeferredUpdate)

export type WslOctopodDeployOptions = {
  /** The WSL environment's id; keys host-scoped state (wake dedupe). Defaults per distro. */
  environmentId?: string
  label?: string
  /** Defaults to a connect. */
  intent?: OctopodUpdateIntent
  signal?: AbortSignal
  /** Defaults to one created over `userData`; the app should pass its shared instance. */
  holder?: WslDistroHolder
  createTransport?: (target: WslOctopodHostTarget) => OctopodHostTransport & { dispose?(): void }
  readRegistryId?: (distro: string) => Promise<string | null>
  readIncumbent?: typeof readWslOctopodIncumbent
  /** This desktop's enrolled pairing, which the incumbent's terminal count authenticates with. */
  pairedOffer?: PairingOffer | null
  /** The octopod template to deploy from; defaults to the packaged one (the C10 lane swaps it). */
  templateDir?: string
  /** A no-boot connect's running check (E9), re-read before any further wake. */
  requireRunning?: () => Promise<boolean>
}

/** Until the persisted deployment record (C7) assigns one, the environment is keyed per distro. */
export function defaultWslOctopodEnvironmentId(distro: string): string {
  return `wsl:${wslDistroHolderKey(distro)}`
}

/** WSL 1 runs no Linux kernel, so the pinned Node and its pty cannot run there. */
export function isWsl1KernelRelease(release: string): boolean {
  return /^\d+\.\d+\.\d+-\d+-Microsoft$/.test(release.trim())
}

export async function deployAndLaunchWslOctopod(
  distro: string,
  options: WslOctopodDeployOptions = {}
): Promise<WslOctopodLaunch> {
  const name = distro.trim()
  if (!name) {
    throw new Error('A WSL distro name is required')
  }
  const target: WslOctopodHostTarget = {
    kind: 'wsl',
    id: options.environmentId ?? defaultWslOctopodEnvironmentId(name),
    distro: name,
    label: options.label ?? name
  }
  const conn = (options.createTransport ?? defaultTransport)(target)
  try {
    return await launchOverTransport(name, target, conn, options)
  } finally {
    conn.dispose?.()
  }
}

async function launchOverTransport(
  name: string,
  target: WslOctopodHostTarget,
  transport: OctopodHostTransport,
  options: WslOctopodDeployOptions
): Promise<WslOctopodLaunch> {
  const { signal } = options
  let ownBuildVersion: string | null = null
  const conn = withOwnBuildLaunchEnv(transport, () => ownBuildVersion)
  const kernel = await execCommand(conn, 'uname -r', { signal })
  if (isWsl1KernelRelease(kernel)) {
    throw new OctopodHostUnsupportedError(
      `The WSL 1 distro ${name} isn’t supported by Shield’s server. ` +
        `Convert it with: wsl --set-version ${name} 2`
    )
  }
  // Acquire a holder before launch or WSL can idle-stop octopod's distro.
  const holder = options.holder ?? createWslDistroHolder({ userDataPath: userDataPath() })
  const held = await holder.ensureHeld(name)
  // Read GUID alongside deploy; failure leaves the record without one.
  const distroId = (options.readRegistryId ?? readWslDistroRegistryIdShared)(name).catch(() => null)
  let context = await resolveOctopodRemoteContext(target, conn, signal)
  const slot = managedOctopodSlot(context, OCTOPOD_MANAGED_REMOTE_PORT, signal)
  const recovery = await recoverInterruptedOctopodActivation(slot)
  if (recovery.outcome === 'pending' || recovery.outcome === 'refused') {
    throw new Error(recovery.reason)
  }
  if (recovery.outcome === 'recovered') {
    context = { ...context, activationRecord: await readOctopodActivationRecord(slot) }
  }
  // Adopt unrecorded octopod before deploy/wake or its instance lock blocks launch.
  const adoption = await adoptUnrecordedWslOctopod(slot, context.activationRecord)
  if (adoption.outcome === 'adopted') {
    context = { ...context, activationRecord: adoption.record }
  }
  const localOctopodDir = await materializeOctopodArtifact(context.serverTarget, {
    signal,
    trustVerificationRecord: true,
    ...(options.templateDir ? { templateDir: options.templateDir } : {})
  })
  const appVersion = getAppEnvironment().getVersion()
  const candidateVersion = readLocalFullVersion(localOctopodDir)
  ownBuildVersion = candidateVersion
  const failureHost = { kind: 'wsl', id: target.id } as const
  const intent = options.intent ?? 'connect'
  const admit = (record: OctopodActivationRecord, admitIntent: OctopodUpdateIntent) =>
    admitWslOctopodLaunch(
      { slot, record, candidateVersion, appVersion, host: failureHost, intent: admitIntent },
      name,
      readyLaunch
    )
  const admitted = await admit(context.activationRecord, intent)
  if ('outcome' in admitted) {
    return admitted
  }
  context = { ...context, activationRecord: admitted }
  const incumbentVersion = context.activationRecord.active
  // Only version changes need incumbent census; same-version connects deploy as no-ops.
  const incumbent: WslOctopodIncumbent | null =
    incumbentVersion && incumbentVersion !== candidateVersion
      ? await (options.readIncumbent ?? readWslOctopodIncumbent)({
          context,
          slot,
          paired: options.pairedOffer ?? null
        })
      : null
  const deployed = await deployOctopod({
    ...slot,
    conn,
    localOctopodDir,
    target: context.serverTarget,
    ...managedOctopodDeployPolicy(context, appVersion, intent),
    ...(incumbent
      ? {
          census: incumbent.census,
          recountCensus: incumbent.recount,
          releaseIncumbentAdmission: incumbent.releaseAdmission
        }
      : {}),
    force: intent === 'force',
    appVersion,
    recordedNodeRuntimeProbe: true
  }).catch((error: unknown) => {
    if (!signal?.aborted) {
      recordWslOctopodUpdateFailure(failureHost, incumbentVersion, {
        code: 'octopod_update_failed',
        reason: errorMessage(error)
      })
    }
    throw error
  })
  if (deployed.outcome === 'installed-not-activated') {
    const failure = wslOctopodDeferralFailure(deployed)
    recordWslOctopodUpdateFailure(failureHost, incumbentVersion, failure)
    const restored = incumbentVersion && failure ? await readRestoredRecord(incumbentVersion) : null
    if (restored) {
      // After rollback proof, serve the restored incumbent on this connect too.
      const retried = await admit(restored, 'connect')
      if ('outcome' in retried) {
        return retried
      }
    }
    const deferredUpdate: WslOctopodDeferredUpdate = {
      candidateVersion: deployed.fullVersion,
      code: await wslOctopodDeferralCode(slot, deployed, appVersion),
      reason: deployed.reason,
      forceable:
        isForceableOctopodDeferral(deployed.code) ||
        deployed.code === OCTOPOD_ACTIVATION_POLICY_REFUSED_CODE
    }
    // Live-terminal deferrals keep the incumbent serving until Update/Force.
    if (
      incumbentVersion &&
      incumbent?.readiness &&
      isWaitingOctopodUpdateDeferral(deployed.code) &&
      // Another client may have activated since census; refuse stale incumbent assumptions.
      (await readOctopodActivationRecord(slot)).active === incumbentVersion
    ) {
      const serving = {
        fullVersion: incumbentVersion,
        readiness: incumbent.readiness
      }
      return { ...(await readyLaunch(serving)), deferredUpdate }
    }
    return { outcome: 'deferred', distro: name, ...deferredUpdate }
  }
  clearOctopodUpdateFailedThisLaunch(failureHost)
  const probe = () =>
    probeManagedOctopodReadiness(context, localOctopodDir, deployed.fullVersion, signal)
  let readiness: ServeReadiness
  if (deployed.outcome === 'already-active') {
    // A stopped distro ended the active slot with it.
    await wakeAlreadyActiveOctopod(slot)
    // Why once more: on a distro still booting, the octopod the wake saw serving can exit before
    // the probe; that is a stopped slot to start, not a failed connect.
    readiness = await probe().catch(async (error: unknown) => {
      if (!(error instanceof OctopodActiveReadinessError) || error.verdict !== 'exited') {
        throw error
      }
      // A `wsl --shutdown` during a no-boot connect must not be undone by this second wake.
      if (options.requireRunning && !(await options.requireRunning())) {
        throw new WslDistroNotRunningError(name)
      }
      await wakeAlreadyActiveOctopod(slot)
      return probe()
    })
  } else {
    readiness = await probe()
  }
  await pruneManagedOctopodVersions({
    slot,
    serverTarget: context.serverTarget,
    activeVersion: deployed.fullVersion,
    readiness
  })
  return readyLaunch({ fullVersion: deployed.fullVersion, readiness })

  /** The record only once the incumbent is back and no journal awaits recovery; else null. */
  async function readRestoredRecord(incumbent: string): Promise<OctopodActivationRecord | null> {
    // Unreadable transaction state proves no restoration; preserve the rejection.
    if (await readOctopodActivationTransaction(slot).catch(() => true)) {
      return null
    }
    const record = await readOctopodActivationRecord(slot).catch(() => null)
    return record?.active === incumbent ? record : null
  }

  async function readyLaunch(serving: {
    fullVersion: string
    readiness: ServeReadiness
  }): Promise<Extract<WslOctopodLaunch, { outcome: 'ready' }>> {
    const pidFile = joinRemotePath(
      context.host,
      managedOctopodInstallDir(context, serving.fullVersion),
      OCTOPOD_PID_FILENAME
    )
    const pid = Number.parseInt(
      await execCommand(conn, `cat ${quotePosixShell(pidFile)} 2>/dev/null || true`, { signal }),
      10
    )
    return {
      outcome: 'ready',
      distro: name,
      distroId: await distroId,
      port: octopodBoundPort(serving.readiness) ?? OCTOPOD_MANAGED_REMOTE_PORT,
      fullVersion: serving.fullVersion,
      pid: Number.isSafeInteger(pid) && pid > 0 ? pid : null,
      readiness: serving.readiness,
      holder: held.outcome,
      ...(adoption.outcome === 'adopted'
        ? { adoptedInstance: { version: adoption.version, pid: adoption.pid } }
        : {})
    }
  }
}

function defaultTransport(target: WslOctopodHostTarget): WslOctopodHostTransport {
  return createWslOctopodHostTransport({ target })
}

function userDataPath(): string {
  return getAppEnvironment().getPath('userData')
}
