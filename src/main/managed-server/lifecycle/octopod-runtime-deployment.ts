// Target claims preserve environment identity so interrupted deploys resume the same registration.
import { getAppEnvironment } from '../../../shared/app-environment'
import { randomUUID } from 'node:crypto'
import { assertRuntimeEnvironmentNotReconciling } from '../../../shared/runtime-environment-reconciliation-record'
import { listEnvironments } from '../../../shared/runtime-environment-store'
import { addManagedOctopodEnvironment } from '../../../shared/runtime-environment-managed-octopod-store'
import {
  getOctopodSshDeployment,
  redactRuntimeEnvironment
} from '../../../shared/runtime-environments'
import {
  OCTOPOD_MANAGED_REMOTE_PORT,
  type OctopodManagedDeferral,
  type OctopodManagedDeployResult
} from '../../../shared/octopod-managed-runtime'
import { getManagedOctopodFenceEnvironmentId } from '../../../shared/managed-octopod-ssh-owner'
import { runTargetLifecycle } from '../../ipc/ssh/ssh-target-lifecycle-queue'
import { materializeOctopodArtifact } from '../../octopod/octopod-artifact-materializer'
import {
  closeOctopodManagedTunnel,
  ensureOctopodManagedTunnel,
  startOctopodManagedTunnel
} from './octopod-managed-tunnel'
import { recoverInterruptedOctopodActivation } from '../activation/octopod-activation-recovery'
import { wakeAlreadyActiveOctopod } from '../../ssh/octopod-already-active-wake'
import { readOctopodActivationRecord } from '../activation/octopod-activation-record-store'
import { resolveOctopodRemoteContext, type OctopodRemoteContext } from '../install/octopod-remote-context'
import { deployOctopod } from '../../ssh/octopod-remote-deploy'
import {
  adoptRunningOctopodVersion,
  type OctopodRunningAdoption
} from '../../ssh/octopod-running-version-adoption'
import { readLocalFullVersion } from '../install/remote-versioned-install'
import { sshOctopodHostTransport } from '../../ssh/octopod-ssh-host-transport'
import { OCTOPOD_ACTIVATION_POLICY_REFUSED_CODE } from '../../ssh/octopod-installed-activation'
import { pruneManagedOctopodVersions } from './octopod-managed-version-gc'
import { tunneledOctopodPairingCode } from '../../ssh/octopod-tunneled-pairing'
import { resolveOctopodMigrationFence } from '../../ssh/octopod-migration-source-fence'
import type { SshTarget } from '../../../shared/ssh-types'
import { findCollidingEnvironmentName } from '../../../shared/runtime-environment-name-collision'
import { deployedOctopodTunnelChecks } from './octopod-managed-tunnel-identity'
import {
  isForceableOctopodDeferral,
  managedOctopodDeployPolicy,
  managedOctopodSlot,
  probeManagedOctopodReadiness,
  requireManagedOctopodInfrastructure
} from './octopod-managed-runtime-context'

export async function createManagedOctopodEnvironment(
  userDataPath: string,
  args: {
    name: string
    sshTargetId: string
    force?: boolean
    signal?: AbortSignal
    migration?: boolean
  }
): Promise<OctopodManagedDeployResult> {
  return runTargetLifecycle(args.sshTargetId, async () => {
    const { connectionManager, targetStore, claims } = requireManagedOctopodInfrastructure()
    const environmentId =
      getManagedOctopodFenceEnvironmentId(targetStore.getTarget(args.sshTargetId)) ?? randomUUID()
    // Duplicate/name checks before an add: a crash-zeroed list (#18766) must read as empty here.
    const environments = listEnvironments(userDataPath, { recoverBlankStore: true })
    const registered = environments.find((entry) => entry.id === environmentId)
    if (registered) {
      assertRuntimeEnvironmentNotReconciling(registered)
      if (getOctopodSshDeployment(registered)?.sshTargetId !== args.sshTargetId) {
        throw new Error('The SSH target is owned by a server that is not deployed on it.')
      }
    }
    const namesake = findCollidingEnvironmentName(
      environments.filter((entry) => entry.id !== environmentId),
      args.name
    )
    if (namesake) {
      throw new Error(`A server named "${namesake.name}" already exists.`)
    }
    const current = targetStore.getTarget(args.sshTargetId)
    if (args.migration) {
      assertMigrationFence(userDataPath, current, environmentId, args.name)
    }
    const claimed = claims.claim(args.sshTargetId, environmentId, {
      ...(args.migration ? {} : { deployName: args.name }),
      ownerRecorded:
        Boolean(args.migration) || Boolean(current?.octopodProvisioning) || Boolean(registered)
    })
    await claims.flush(args.signal)
    const targetGeneration = claimed.generation
    if (targetGeneration === undefined) {
      throw new Error('The SSH registration for this host’s Shield server has no durable generation.')
    }
    if (registered && getOctopodSshDeployment(registered)?.sshTargetGeneration !== targetGeneration) {
      throw new Error('The saved Shield server for this host has a stale SSH target generation.')
    }
    let environmentRegistered = false
    try {
      const connection = await connectionManager.connect(claimed)
      let context = await resolveOctopodRemoteContext(
        claimed,
        sshOctopodHostTransport(connection),
        args.signal
      )
      const slot = managedOctopodSlot(context, OCTOPOD_MANAGED_REMOTE_PORT, args.signal)
      const recovery = await recoverInterruptedOctopodActivation(slot)
      if (recovery.outcome === 'pending' || recovery.outcome === 'refused') {
        throw new Error(recovery.reason)
      }
      if (recovery.outcome === 'recovered') {
        context = { ...context, activationRecord: await readOctopodActivationRecord(slot) }
      }
      if (registered) {
        environmentRegistered = true
        const current = await ensureOctopodManagedTunnel(userDataPath, registered.id)
        const activeVersion = context.activationRecord.active
        if (!activeVersion) {
          throw new Error('This host’s Shield server has no active runtime version.')
        }
        return {
          outcome: 'already-current',
          environment: redactRuntimeEnvironment(current),
          activeVersion
        }
      }
      const localOctopodDir = await materializeOctopodArtifact(context.serverTarget, {
        signal: args.signal
      })
      // Adopt before upload: only the paired incumbent can count terminals; redeploy would defer.
      const localVersion = readLocalFullVersion(localOctopodDir)
      const adopted = args.force
        ? null
        : await adoptRunningOctopodVersion(slot, context.activationRecord, localVersion)
      const { active } = context.activationRecord
      if (!adopted && !args.force && active && active !== localVersion) {
        // Wake may observe a peer's changed record; census admission must use that same record.
        context = { ...context, activationRecord: await readOctopodActivationRecord(slot) }
      }
      const serving: DeployedOctopod | OctopodManagedDeferral =
        adopted ??
        (await deployOwnOctopod(context, { ...slot, conn: connection }, localOctopodDir, args))
      if ('outcome' in serving) {
        return serving
      }
      // Read the bound port: the preferred port may belong to another host process.
      const tunnel = deployedOctopodTunnelChecks(serving.readiness, serving.reprobe)
      const localPort = await startOctopodManagedTunnel(
        environmentId,
        claimed,
        connection,
        tunnel.remotePort,
        { ...tunnel, preferredPort: OCTOPOD_MANAGED_REMOTE_PORT }
      )
      const environment = addManagedOctopodEnvironment(userDataPath, {
        id: environmentId,
        name: args.name,
        pairingCode: tunneledOctopodPairingCode(tunnel.readiness(), localPort),
        octopodDeployment: {
          sshTargetId: claimed.id,
          sshTargetGeneration: targetGeneration,
          localPort,
          remotePort: OCTOPOD_MANAGED_REMOTE_PORT
        }
      })
      environmentRegistered = true
      return {
        outcome: serving.created ? 'created' : 'already-current',
        environment: redactRuntimeEnvironment(environment),
        activeVersion: serving.version
      }
    } finally {
      if (!environmentRegistered) {
        await closeOctopodManagedTunnel(environmentId).catch(() => undefined)
      }
    }
  })
}

type DeployedOctopod = OctopodRunningAdoption & { created?: true }

async function deployOwnOctopod(
  context: OctopodRemoteContext<SshTarget>,
  slot: ReturnType<typeof managedOctopodSlot>,
  localOctopodDir: string,
  args: { force?: boolean; signal?: AbortSignal }
): Promise<DeployedOctopod | OctopodManagedDeferral> {
  const appVersion = getAppEnvironment().getVersion()
  const deployResult = await deployOctopod({
    ...slot,
    localOctopodDir,
    target: context.serverTarget,
    ...managedOctopodDeployPolicy(context, appVersion, args.force ? 'force' : 'connect'),
    force: args.force,
    appVersion
  })
  if (deployResult.outcome === 'installed-not-activated') {
    return {
      outcome: 'deferred',
      candidateVersion: deployResult.fullVersion,
      code: deployResult.code,
      reason: deployResult.reason,
      forceable:
        isForceableOctopodDeferral(deployResult.code) ||
        deployResult.code === OCTOPOD_ACTIVATION_POLICY_REFUSED_CODE
    }
  }
  if (deployResult.outcome === 'already-active') {
    await wakeAlreadyActiveOctopod(slot)
  }
  const reprobe = () =>
    probeManagedOctopodReadiness(context, localOctopodDir, deployResult.fullVersion, args.signal)
  const readiness = await reprobe()
  await pruneManagedOctopodVersions({
    slot,
    serverTarget: context.serverTarget,
    activeVersion: deployResult.fullVersion,
    readiness
  })
  return {
    version: deployResult.fullVersion,
    readiness,
    reprobe,
    ...(deployResult.outcome === 'already-active' ? {} : { created: true as const })
  }
}

function assertMigrationFence(
  userDataPath: string,
  target: SshTarget | undefined,
  environmentId: string,
  name: string
): void {
  const fence = target ? resolveOctopodMigrationFence(userDataPath, target) : null
  if (
    fence?.state !== 'fenced' ||
    fence.cutover.destinationEnvironmentId !== environmentId ||
    fence.cutover.destinationName !== name
  ) {
    throw new Error('octopod_migration_fence_required')
  }
}
