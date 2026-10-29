import { resolveEnvironment } from '../../../shared/runtime-environment-store'
import { OCTOPOD_UPDATE_TERMINALS_RUNNING_CODE } from '../../../shared/octopod-managed-runtime'
import {
  getOctopodSshDeployment,
  type KnownRuntimeEnvironment,
  type OctopodSshDeploymentLink
} from '../../../shared/runtime-environments'
import { getManagedOctopodFenceEnvironmentId } from '../../../shared/managed-octopod-ssh-owner'
import type { ServeReadiness } from '../../server/serve-readiness'
import { computeLocalOctopodBuildHash } from '../../ssh/octopod-local-build-hash'
import { sshOctopodHostTransport } from '../../ssh/octopod-ssh-host-transport'
import type { OctopodHostTarget } from '../../ssh/octopod-host-transport'
import type { OctopodActivationRecord } from '../activation/octopod-activation-record'
import { admitOctopodRecordForIntent, type OctopodUpdateIntent } from './octopod-managed-update-decision'
import {
  type OctopodTerminalCensus,
  UNVERIFIABLE_OCTOPOD_TERMINAL_CENSUS
} from '../../../shared/octopod-terminal-census'
import { probeActiveOctopodReadiness } from '../../ssh/octopod-active-readiness'
import { resolveOctopodRemoteContext, type OctopodRemoteContext } from '../install/octopod-remote-context'
import { OCTOPOD_INSTALL_MODEL } from '../install/remote-install-model'
import { computeRemoteInstallDir } from '../install/remote-versioned-install'
import {
  getSshConnectionManager,
  getSshTargetRegistryStore
} from '../../ssh/targets/ssh-target-registry'

const OCTOPOD_BIND_HOST = '127.0.0.1'

// Pinned slots must fail on absent markers rather than silently use host Node.
const MANAGED_OCTOPOD_LEGACY_NODE_PATH = ''

export function requireManagedOctopodInfrastructure() {
  const targetStore = requireManagedOctopodTargetStore()
  const connectionManager = getSshConnectionManager()
  if (!connectionManager) {
    throw new Error('SSH is unavailable on this client; this host’s Shield server is unverifiable.')
  }
  return { connectionManager, targetStore, claims: targetStore.getOctopodRuntimeClaims() }
}

export function requireManagedOctopodTargetStore() {
  const targetStore = getSshTargetRegistryStore()
  if (!targetStore) {
    throw new Error('SSH target state is unavailable; this host’s Shield server is unverifiable.')
  }
  return targetStore
}

export function requireManagedOctopodEnvironment(
  userDataPath: string,
  selector: string
): { environment: KnownRuntimeEnvironment; deployment: OctopodSshDeploymentLink } {
  const environment = resolveEnvironment(userDataPath, selector)
  const deployment = getOctopodSshDeployment(environment)
  if (!deployment || environment.connectionDependency !== 'ssh-tunnel') {
    throw new Error('This server is not managed through an octopod SSH deployment.')
  }
  return { environment, deployment }
}

export async function resolveLinkedOctopodContext(
  environment: KnownRuntimeEnvironment,
  deployment: OctopodSshDeploymentLink,
  signal?: AbortSignal
): Promise<OctopodRemoteContext> {
  const { connectionManager, targetStore } = requireManagedOctopodInfrastructure()
  const target = targetStore.getTarget(deployment.sshTargetId)
  if (
    !target ||
    target.generation !== deployment.sshTargetGeneration ||
    getManagedOctopodFenceEnvironmentId(target) !== environment.id
  ) {
    throw new Error('The SSH registration for this host’s Shield server is no longer valid.')
  }
  const connection = await connectionManager.connect(target)
  return resolveOctopodRemoteContext(target, sshOctopodHostTransport(connection), signal)
}

export function managedOctopodSlot(
  context: OctopodRemoteContext<OctopodHostTarget>,
  port: number,
  signal?: AbortSignal
) {
  return {
    conn: context.connection,
    host: context.host,
    remoteHome: context.remoteHome,
    nodePath: MANAGED_OCTOPOD_LEGACY_NODE_PATH,
    userDataDir: context.userDataDir,
    bindHost: OCTOPOD_BIND_HOST,
    port,
    signal
  }
}

export function managedOctopodInstallDir(
  context: OctopodRemoteContext<OctopodHostTarget>,
  version: string
): string {
  return computeRemoteInstallDir(
    OCTOPOD_INSTALL_MODEL,
    context.remoteHome,
    version,
    context.host.pathFlavor
  )
}

/** Accept readiness only from the build this client holds. */
export function probeManagedOctopodReadiness(
  context: OctopodRemoteContext<OctopodHostTarget>,
  localOctopodDir: string,
  fullVersion: string,
  signal?: AbortSignal
): Promise<ServeReadiness> {
  return probeActiveOctopodReadiness(
    {
      conn: context.connection,
      host: context.host,
      remoteInstallDir: managedOctopodInstallDir(context, fullVersion),
      signal
    },
    { buildHash: computeLocalOctopodBuildHash(localOctopodDir), fullVersion }
  )
}

export function managedOctopodDeployPolicy(
  context: Pick<OctopodRemoteContext<OctopodHostTarget>, 'activationRecord'>,
  appVersion: string,
  intent: OctopodUpdateIntent
): {
  census: OctopodTerminalCensus
  recountCensus: () => Promise<OctopodTerminalCensus>
  releaseIncumbentAdmission: () => Promise<void>
  censusRecord: OctopodActivationRecord
  admitRecord: (record: OctopodActivationRecord, candidateVersion: string) => string | null
} {
  // Only the active daemon can count sessions; guessing zero risks restarting live terminals.
  const census: OctopodTerminalCensus = context.activationRecord.active
    ? UNVERIFIABLE_OCTOPOD_TERMINAL_CENSUS
    : { liveSessions: 0, startedSinceActivation: 0, daemonProtocolVersion: null }
  return {
    census,
    recountCensus: async () => census,
    releaseIncumbentAdmission: async () => {},
    censusRecord: context.activationRecord,
    // Only the fenced read can reject newer migrated state or rolled-back builds on this unlinked path.
    admitRecord: admitOctopodRecordForIntent(intent, appVersion)
  }
}

// Force can override live terminal counts, never unknown census or protocol deferrals.
export function isForceableOctopodDeferral(code: string): boolean {
  return code === OCTOPOD_UPDATE_TERMINALS_RUNNING_CODE
}
