/** Activate under a durable host fence/journal only after candidate readiness. Recover the incumbent only with safe profile state; retain changed state/snapshot for explicit recovery. */
import { logOctopodActivationOutcome } from '../managed-server/activation/octopod-activation-outcome-log'
import { join } from 'node:path'
import type { OctopodHostTransport } from './octopod-host-transport'
import type { OctopodUpdateForce } from './octopod-update-plan'
import { OCTOPOD_INSTALL_MODEL } from '../managed-server/install/remote-install-model'
import {
  computeRemoteInstallDir,
  readLocalFullVersion
} from '../managed-server/install/remote-versioned-install'
import { readOctopodActivationRecord } from '../managed-server/activation/octopod-activation-record-store'
import type { OctopodActivationRecord } from '../managed-server/activation/octopod-activation-record'
import type { OctopodActivationVerdict } from '../managed-server/activation/octopod-activation-gate'
import type { OctopodTerminalCensus } from '../../shared/octopod-terminal-census'
import type { RemoteHostPlatform } from './ssh-remote-platform'
import { installOctopodBundle } from '../managed-server/install/octopod-remote-install'
import { getAppEnvironment } from '../../shared/app-environment'
import type { NodeRuntimeTarget } from '../../shared/node-runtime-pin'
import { OCTOPOD_STARTUP_READINESS_TIMEOUT_MS } from '../../shared/octopod-profile-preflight'
import { materializeOctopodArtifact } from '../octopod/octopod-artifact-materializer'
import { readOctopodBundleTarget } from './octopod-deployment-target'
import { resolveOctopodRuntimeTarget } from '../managed-server/lifecycle/octopod-runtime-target'
import {
  materializeNodeRuntimeArchive,
  nodeRuntimeArchiveCachePath
} from '../node-runtime/pinned-runtime-materializer'
import {
  octopodActivationFenceExists,
  resolveOctopodActivationReadinessTimeout,
  withOctopodActivationLock
} from '../managed-server/activation/octopod-activation-lock'
import { activateInstalledOctopod } from './octopod-installed-activation'
import { octopodActivationFenceRefusal } from '../managed-server/activation/octopod-activation-fence-hold'

export type OctopodDeployOptions = {
  conn: OctopodHostTransport
  host: RemoteHostPlatform
  remoteHome: string
  /** An already assembled bundle; otherwise materialize the packaged template for this host. */
  localOctopodDir?: string
  /** The bundle's runtime target; read from `localOctopodDir` or probed when absent. */
  target?: NodeRuntimeTarget
  /** Where the pinned runtime archive is cached; defaults beside the octopod artifact cache. */
  runtimeCacheRoot?: string
  nodePath: string
  userDataDir: string
  bindHost: string
  port: number
  /** Caller supplies a protocol-aware census; unanswered host evidence must never become zero live terminals. */
  census: OctopodTerminalCensus
  /** Bind census to its incumbent record; a changed locked record makes earlier counts unverifiable. */
  censusRecord?: OctopodActivationRecord
  /** Recount under fence just before stopping the same incumbent; uploads may outdate initial counts and failures stay unverifiable. */
  recountCensus: () => Promise<OctopodTerminalCensus>
  /** Best-effort reopen when incumbent keeps serving; admission also expires server-side. */
  releaseIncumbentAdmission: () => Promise<void>
  force?: OctopodUpdateForce
  /** The Shield app version activating, recorded so an older client never downgrades the host. */
  appVersion?: string
  /** Reapply version policy under lock because peer activation/stop may land during upload. */
  admitRecord?: (record: OctopodActivationRecord, candidateVersion: string) => string | null
  readinessTimeoutMs?: number
  /** WSL only; SSH hosts always re-hash the runtime (see `installOctopodBundle`). */
  recordedNodeRuntimeProbe?: boolean
  now?: () => Date
  sleep?: (ms: number) => Promise<void>
  signal?: AbortSignal
}

export type OctopodDeployResult =
  | { outcome: 'installed-and-activated'; fullVersion: string; verdict: OctopodActivationVerdict }
  | { outcome: 'already-active'; fullVersion: string }
  | { outcome: 'installed-not-activated'; fullVersion: string; code: string; reason: string }

export async function deployOctopod(
  input: OctopodDeployOptions,
  retryClearedFence = true
): Promise<OctopodDeployResult> {
  const target =
    input.target ??
    (input.localOctopodDir
      ? readOctopodBundleTarget(input.localOctopodDir)
      : await resolveOctopodRuntimeTarget(input))
  const runtimeCacheRoot =
    input.runtimeCacheRoot ?? join(getAppEnvironment().getPath('userData'), 'octopod-artifacts')
  const options = {
    ...input,
    target,
    readinessTimeoutMs: resolveOctopodActivationReadinessTimeout(
      input.readinessTimeoutMs,
      OCTOPOD_STARTUP_READINESS_TIMEOUT_MS
    ),
    nodeRuntimeArchive: () =>
      materializeNodeRuntimeArchive(target, runtimeCacheRoot, { signal: input.signal }),
    nodeRuntimeOfflineArchivePath: nodeRuntimeArchiveCachePath(target, runtimeCacheRoot),
    localOctopodDir:
      input.localOctopodDir ?? (await materializeOctopodArtifact(target, { signal: input.signal }))
  }
  const fullVersion = readLocalFullVersion(options.localOctopodDir)
  const remoteDir = computeRemoteInstallDir(OCTOPOD_INSTALL_MODEL, options.remoteHome, fullVersion)
  const held = async (): Promise<OctopodDeployResult> => {
    const { cleared, ...refusal } = await octopodActivationFenceRefusal(options, 'update')
    // Retry one cleared abandoned fence; repeated abandonment must surface to the caller.
    if (cleared && retryClearedFence) {
      return deployOctopod({ ...input, target, localOctopodDir: options.localOctopodDir }, false)
    }
    return { outcome: 'installed-not-activated', fullVersion, ...refusal }
  }
  // Refuse before upload, then re-read both admission inputs under fence.
  const preUploadRecord = await readOctopodActivationRecord(options)
  const censusRecord = options.censusRecord ?? preUploadRecord
  // An unanswered probe only skips this shortcut; lock acquisition still arbitrates.
  if (await octopodActivationFenceExists(options).catch(() => false)) {
    return held()
  }

  await installOctopodBundle(options, fullVersion, remoteDir)

  return logOctopodActivationOutcome(
    `update to ${fullVersion}`,
    () =>
      withOctopodActivationLock(
        options,
        (lock) =>
          activateInstalledOctopod({ ...options, censusRecord }, fullVersion, remoteDir, lock),
        held
      ),
    ['installed-and-activated', 'already-active']
  )
}
