/** Census through the managed tunnel before lifecycle changes. Unknown counts never mean zero, so live/uncounted hosts defer update (D7). */
import { getAppEnvironment } from '../../shared/app-environment'
import { assertRuntimeEnvironmentNotReconciling } from '../../shared/runtime-environment-reconciliation-record'
import {
  redactRuntimeEnvironment,
  type KnownRuntimeEnvironment
} from '../../shared/runtime-environments'
import type {
  OctopodManagedDeployResult,
  OctopodManagedPastLiveTerminals,
  OctopodManagedRecoveryResult,
  OctopodManagedRollbackResult
} from '../../shared/octopod-managed-runtime'
import { runTargetLifecycle } from '../ipc/ssh/ssh-target-lifecycle-queue'
import { recoverInterruptedOctopodActivation } from '../managed-server/activation/octopod-activation-recovery'
import { probeActiveOctopodReadiness } from './octopod-active-readiness'
import { materializeOctopodArtifact } from '../octopod/octopod-artifact-materializer'
import { CURRENT_OCTOPOD_DAEMON_PROTOCOL } from './octopod-daemon-protocol-crossing'
import { rebuildOctopodManagedTunnel } from '../managed-server/lifecycle/octopod-managed-tunnel'
import { wakeAlreadyActiveOctopod } from './octopod-already-active-wake'
import {
  clearManagedOctopodUpdateDeferral,
  recordManagedOctopodUpdateDeferral
} from '../managed-server/lifecycle/octopod-managed-update-deferrals'
import {
  isForceableOctopodDeferral,
  managedOctopodInstallDir,
  managedOctopodSlot,
  probeManagedOctopodReadiness,
  requireManagedOctopodEnvironment,
  resolveLinkedOctopodContext
} from '../managed-server/lifecycle/octopod-managed-runtime-context'
import type { OctopodRemoteContext } from '../managed-server/install/octopod-remote-context'
import { readRemoteOctopodBuildHash } from '../managed-server/install/octopod-remote-build-hash'
import { deployOctopod, type OctopodDeployOptions } from './octopod-remote-deploy'
import type { OctopodUpdateForce } from './octopod-update-plan'
import { OCTOPOD_ACTIVATION_POLICY_REFUSED_CODE } from './octopod-installed-activation'
import { pruneManagedOctopodVersions } from '../managed-server/lifecycle/octopod-managed-version-gc'
import { clearOctopodUpdateFailedThisLaunch } from '../managed-server/lifecycle/octopod-managed-update-failure-memory'
import { admitOctopodRecordForIntent } from '../managed-server/lifecycle/octopod-managed-update-decision'
import { rollbackOctopod } from '../managed-server/install/octopod-remote-rollback'
import { collectManagedTerminalCensus } from './octopod-terminal-census-client'
import { updateTerminalCounts } from './octopod-fenced-stop'
import { findIncompleteManagedOctopodMigration } from '../managed-server/lifecycle/octopod-managed-migration-status'
import { latestOctopodMigrationInto } from './octopod-migration-rollback-mark'
import { refreshMaintainedOctopodPairing } from './octopod-maintenance-pairing-refresh'

type LifecycleArgs = { selector: string; signal?: AbortSignal }

export function withManagedOctopodLifecycle<T>(
  userDataPath: string,
  selector: string,
  run: (managed: ReturnType<typeof requireManagedOctopodEnvironment>) => Promise<T>
): Promise<T> {
  const { environment, deployment } = requireManagedOctopodEnvironment(userDataPath, selector)
  return runTargetLifecycle(deployment.sshTargetId, async () => {
    // Re-read in the lifecycle queue because reconciliation/stop may have won first.
    const current = requireManagedOctopodEnvironment(userDataPath, environment.id)
    assertRuntimeEnvironmentNotReconciling(current.environment)
    return run(current)
  })
}

/** Rebuild forwarding when a launched slot binds a different port. */
export async function followLaunchedServerPort(
  userDataPath: string,
  environmentId: string
): Promise<void> {
  try {
    await rebuildOctopodManagedTunnel(userDataPath, environmentId)
  } catch (error) {
    // Server already launched; if tunnel rebuild fails, the next connect can forward its bound port.
    console.warn('[ssh] Could not forward to the relaunched managed Shield server:', error)
  }
}

export function updateManagedOctopodEnvironment(
  userDataPath: string,
  args: LifecycleArgs & { force?: boolean; pastLiveTerminals?: OctopodManagedPastLiveTerminals }
): Promise<OctopodManagedDeployResult> {
  const { pastLiveTerminals } = args
  // Update anyway keeps Update's version admission even if a caller also passed force.
  const intent = args.force && !pastLiveTerminals ? 'force' : 'update'
  return withManagedOctopodLifecycle(userDataPath, args.selector, async (managed) => {
    const admitIntent = admitOctopodRecordForIntent(intent, getAppEnvironment().getVersion())
    // Checked under the host fence: another desktop may have activated a build since the confirm.
    const admitRecord: NonNullable<OctopodDeployOptions['admitRecord']> = pastLiveTerminals
      ? (record, candidateVersion) =>
          record.active !== pastLiveTerminals.incumbentVersion
            ? "This host's server changed since the update was confirmed. Review it and update again."
            : admitIntent(record, candidateVersion)
      : admitIntent
    const force: OctopodUpdateForce | undefined = pastLiveTerminals ? 'live-terminals' : args.force
    const result = await runManagedOctopodUpdate(
      userDataPath,
      managed,
      await resolveLinkedOctopodContext(managed.environment, managed.deployment, args.signal),
      { signal: args.signal, force, admitRecord }
    )
    // A completed manual update clears automatic failure suppression; deferred attempts do not.
    if (result.outcome !== 'deferred') {
      clearOctopodUpdateFailedThisLaunch({ kind: 'ssh', id: managed.deployment.sshTargetId })
    }
    return result
  })
}

export async function runManagedOctopodUpdate(
  userDataPath: string,
  { environment, deployment }: ReturnType<typeof requireManagedOctopodEnvironment>,
  context: OctopodRemoteContext,
  args: {
    force?: OctopodUpdateForce
    signal?: AbortSignal
    localOctopodDir?: string
    admitRecord?: OctopodDeployOptions['admitRecord']
  }
): Promise<OctopodManagedDeployResult> {
  const { countFirst, ...recount } = updateTerminalCounts((options) =>
    collectManagedTerminalCensus(
      userDataPath,
      environment,
      context.activationRecord,
      undefined,
      options
    )
  )
  const census = await countFirst()
  const localOctopodDir =
    args.localOctopodDir ??
    (await materializeOctopodArtifact(context.serverTarget, { signal: args.signal }))
  const slot = managedOctopodSlot(context, deployment.remotePort, args.signal)
  const result = await deployOctopod({
    ...slot,
    localOctopodDir,
    target: context.serverTarget,
    census,
    ...recount,
    censusRecord: context.activationRecord,
    force: args.force,
    appVersion: getAppEnvironment().getVersion(),
    ...(args.admitRecord ? { admitRecord: args.admitRecord } : {})
  })
  if (result.outcome === 'installed-not-activated') {
    const deferral = {
      outcome: 'deferred' as const,
      candidateVersion: result.fullVersion,
      code: result.code,
      reason: result.reason,
      // Force may override policy deferrals, including a newer host build.
      forceable:
        isForceableOctopodDeferral(result.code) ||
        result.code === OCTOPOD_ACTIVATION_POLICY_REFUSED_CODE
    }
    // Policy refusal is final for this host, not a transient update to retry.
    if (result.code !== OCTOPOD_ACTIVATION_POLICY_REFUSED_CODE) {
      recordManagedOctopodUpdateDeferral(environment.id, deferral)
    }
    return deferral
  }
  clearManagedOctopodUpdateDeferral(environment.id)
  const started = result.outcome === 'already-active' && (await wakeAlreadyActiveOctopod(slot))
  const readiness = await probeManagedOctopodReadiness(
    context,
    localOctopodDir,
    result.fullVersion,
    args.signal
  )
  await pruneManagedOctopodVersions({
    slot,
    serverTarget: context.serverTarget,
    activeVersion: result.fullVersion,
    readiness
  })
  const updated = refreshMaintainedOctopodPairing(userDataPath, environment.id, readiness)
  if (started || result.outcome !== 'already-active') {
    await followLaunchedServerPort(userDataPath, environment.id)
  }
  return {
    outcome: result.outcome === 'already-active' ? 'already-current' : 'updated',
    environment: redactRuntimeEnvironment(updated),
    activeVersion: result.fullVersion
  }
}

export function rollbackManagedOctopodEnvironment(
  userDataPath: string,
  args: LifecycleArgs
): Promise<OctopodManagedRollbackResult> {
  return withManagedOctopodLifecycle(
    userDataPath,
    args.selector,
    async ({ environment, deployment }) => {
      const context = await resolveLinkedOctopodContext(environment, deployment, args.signal)
      const record = context.activationRecord
      const target = record.previous
      if (!target) {
        return {
          outcome: 'refused',
          code: 'octopod_rollback_no_target',
          reason: 'This server has no previous version to roll back to.'
        }
      }
      const crossing = migrationRollbackRefusal(userDataPath, environment, record.activatedAt)
      if (crossing) {
        return crossing
      }
      const slot = managedOctopodSlot(context, deployment.remotePort, args.signal)
      const targetDir = managedOctopodInstallDir(context, target)
      const targetBuildHash = await readRemoteOctopodBuildHash(slot, targetDir)
      const { countFirst, ...recount } = updateTerminalCounts((options) =>
        collectManagedTerminalCensus(userDataPath, environment, record, undefined, options)
      )
      // Recount under lock before rollback stop; this initial census closes no admission.
      const census = await countFirst()
      // Require idle because this client cannot prove the older build's daemon protocol attaches to live terminals.
      if (census.liveSessions !== 0) {
        return {
          outcome: 'refused',
          code:
            census.liveSessions === null
              ? 'octopod_rollback_census_unavailable'
              : 'octopod_rollback_terminals_running',
          reason:
            census.liveSessions === null
              ? 'The server did not answer how many terminals it runs. Retry when it answers.'
              : 'Close the terminals running on this server before rolling it back.'
        }
      }
      const result = await rollbackOctopod({
        ...slot,
        record,
        census,
        ...recount,
        targetBuildHash,
        targetDaemonProtocol: CURRENT_OCTOPOD_DAEMON_PROTOCOL
      })
      if (result.outcome !== 'rolled-back') {
        return result
      }
      const readiness = await probeActiveOctopodReadiness(
        { ...slot, remoteInstallDir: targetDir },
        { buildHash: targetBuildHash, fullVersion: result.target }
      )
      const updated = refreshMaintainedOctopodPairing(userDataPath, environment.id, readiness)
      await followLaunchedServerPort(userDataPath, environment.id)
      return {
        outcome: 'rolled-back',
        environment: redactRuntimeEnvironment(updated),
        activeVersion: result.target,
        discarded: result.discarded
      }
    }
  )
}

export function recoverManagedOctopodEnvironment(
  userDataPath: string,
  args: LifecycleArgs & { acceptChangedState?: boolean }
): Promise<OctopodManagedRecoveryResult> {
  return withManagedOctopodLifecycle(
    userDataPath,
    args.selector,
    async ({ environment, deployment }) => {
      const context = await resolveLinkedOctopodContext(environment, deployment, args.signal)
      const result = await recoverInterruptedOctopodActivation({
        ...managedOctopodSlot(context, deployment.remotePort, args.signal),
        acceptChangedState: args.acceptChangedState === true
      })
      if (result.outcome !== 'recovered') {
        return result
      }
      const updated = result.readiness
        ? refreshMaintainedOctopodPairing(userDataPath, environment.id, result.readiness)
        : environment
      if (result.activeVersion) {
        await followLaunchedServerPort(userDataPath, environment.id)
      }
      return {
        outcome: 'recovered',
        resolution: result.resolution,
        activeVersion: result.activeVersion,
        environment: redactRuntimeEnvironment(updated)
      }
    }
  )
}

/** A post-activation migration is absent from the rollback snapshot; restoring it would discard imported state. */
function migrationRollbackRefusal(
  userDataPath: string,
  environment: KnownRuntimeEnvironment,
  activatedAt: string | null
): OctopodManagedRollbackResult | null {
  if (findIncompleteManagedOctopodMigration(userDataPath, environment.id)) {
    return {
      outcome: 'refused',
      code: 'octopod_rollback_migration_in_progress',
      reason: 'A migration into this server is still running. Finish it before rolling back.'
    }
  }
  const migratedAt = latestOctopodMigrationInto(userDataPath, environment)
  if (migratedAt && (activatedAt === null || Date.parse(activatedAt) < Date.parse(migratedAt))) {
    return {
      outcome: 'refused',
      code: 'octopod_rollback_crosses_migration',
      reason:
        "The previous version's state predates the projects migrated onto this server; " +
        'rolling back would lose them. Deploy forward instead.'
    }
  }
  return null
}
