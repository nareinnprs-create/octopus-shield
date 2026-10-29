// Keep claims, tunnels and registration until the host proves server exit.
import type {
  OctopodManagedCancelStopResult,
  OctopodManagedForgetResult,
  OctopodManagedStopResult
} from '../../../shared/octopod-managed-runtime'
import type { OctopodDaemonRetirementVerdict } from '../../../shared/octopod-stop-request'
import { removeManagedOctopodEnvironment } from '../../../shared/runtime-environment-managed-octopod-store'
import type {
  KnownRuntimeEnvironment,
  OctopodSshDeploymentLink
} from '../../../shared/runtime-environments'
import { recoverInterruptedOctopodActivation } from '../activation/octopod-activation-recovery'
import { withStaleOctopodActivationRecoveryLock } from '../activation/octopod-activation-lock'
import { readOctopodActivationTransaction } from '../activation/octopod-activation-transaction-store'
import { reconcileOctopodDecommission } from './octopod-decommission-recovery'
import { cancelRemoteOctopodManagedStop } from './octopod-managed-remote-stop'
import {
  managedOctopodSlot,
  requireManagedOctopodInfrastructure,
  resolveLinkedOctopodContext
} from './octopod-managed-runtime-context'
import { closeOctopodManagedTunnel, ensureOctopodManagedTunnel } from './octopod-managed-tunnel'
import { clearManagedOctopodUpdateDeferral } from './octopod-managed-update-deferrals'
import { removeOctopodMigrationJournalsForDestination } from '../../ssh/octopod-migration-cutover-journal'
import { decommissionRemoteOctopod } from '../install/octopod-remote-decommission'
import { withManagedOctopodLifecycle } from '../../ssh/octopod-runtime-maintenance'
import { collectManagedTerminalCensus } from '../../ssh/octopod-terminal-census-client'
import { RemoteInstallLockBusyError } from '../install/remote-install-lock'

type ManagedOctopodStopPolicy = {
  isActiveEnvironment: (environmentId: string) => boolean
  retireLocalState: (environmentId: string) => Promise<void> | void
}

type Refusal = Extract<OctopodManagedStopResult, { outcome: 'refused' }>
type Stopped = { version: string | null; retirement: OctopodDaemonRetirementVerdict | null }

function refuse(verdict: Refusal['verdict'], code: string, reason: string): Refusal {
  return { outcome: 'refused', verdict, code, reason }
}

export function stopManagedOctopodEnvironment(
  userDataPath: string,
  args: { selector: string; signal?: AbortSignal },
  policy: ManagedOctopodStopPolicy
): Promise<OctopodManagedStopResult> {
  return withManagedOctopodLifecycle(userDataPath, args.selector, async (managed) => {
    const { environment, deployment } = managed
    if (policy.isActiveEnvironment(environment.id)) {
      return refuse(
        'live',
        'octopod_stop_active_environment',
        'This server is the default host for new projects. Choose another one under New projects open on before stopping it.'
      )
    }
    const stopped = await stopRemote(userDataPath, environment, deployment, args.signal)
    if ('outcome' in stopped) {
      return stopped
    }
    await unlinkEnvironmentLocally(userDataPath, environment, deployment, policy)
    return {
      outcome: 'unlinked',
      verdict: 'exited',
      environmentId: environment.id,
      sshTargetId: deployment.sshTargetId,
      stoppedVersion: stopped.version,
      retirement: stopped.retirement
    }
  })
}

/** Forget local state without assuming host exit; later connects may relink a still-running server. */
export function forgetManagedOctopodEnvironment(
  userDataPath: string,
  args: { selector: string },
  policy: ManagedOctopodStopPolicy
): Promise<OctopodManagedForgetResult> {
  return withManagedOctopodLifecycle(userDataPath, args.selector, async (managed) => {
    const { environment, deployment } = managed
    if (policy.isActiveEnvironment(environment.id)) {
      return refuse(
        'live',
        'octopod_forget_active_environment',
        'This server is the default host for new projects. Choose another one under New projects open on before forgetting it.'
      )
    }
    await unlinkEnvironmentLocally(userDataPath, environment, deployment, policy)
    return {
      outcome: 'forgotten',
      verdict: 'unverifiable',
      environmentId: environment.id,
      sshTargetId: deployment.sshTargetId
    }
  })
}

async function stopRemote(
  userDataPath: string,
  environment: KnownRuntimeEnvironment,
  deployment: OctopodSshDeploymentLink,
  signal?: AbortSignal,
  retried = false
): Promise<Stopped | Refusal> {
  const context = await resolveLinkedOctopodContext(environment, deployment, signal)
  const slot = managedOctopodSlot(context, deployment.remotePort, signal)
  const transaction = await readOctopodActivationTransaction(slot)
  if (transaction?.operation === 'decommission') {
    // Resume the exact interrupted stop from its journal.
    const recovered = await recoverInterruptedOctopodActivation(slot)
    if (recovered.outcome === 'recovered' && recovered.activeVersion === null) {
      return { version: transaction.activeVersion, retirement: null }
    }
    if (recovered.outcome === 'refused') {
      return refuse(recovered.verdict, recovered.code, recovered.reason)
    }
    if (recovered.outcome === 'pending') {
      return refuse('unverifiable', recovered.code, recovered.reason)
    }
    // Another run may settle recovery first; restart from its resulting record.
    if (recovered.outcome === 'none') {
      return retried
        ? refuse(
            'unverifiable',
            'octopod_stop_journal_changed',
            'Another run on this server changed its stop while this one waited. Refresh and retry.'
          )
        : stopRemote(userDataPath, environment, deployment, signal, true)
    }
    return refuse(
      'live',
      'octopod_stop_withdrawn',
      'The interrupted stop was withdrawn and the server keeps serving. Stop it again.'
    )
  }
  if (transaction) {
    return refuse(
      'unverifiable',
      'octopod_activation_recovery_required',
      'An earlier update on this server was interrupted. Recover it before stopping.'
    )
  }
  const record = context.activationRecord
  if (!record.active) {
    return { version: null, retirement: null }
  }
  const census = await collectManagedTerminalCensus(userDataPath, environment, record)
  const result = await decommissionRemoteOctopod({ ...slot, record, census })
  if (result.outcome === 'refused') {
    return refuse(result.verdict, result.code, result.reason)
  }
  return { version: result.version, retirement: result.retirement }
}

async function unlinkEnvironmentLocally(
  userDataPath: string,
  environment: KnownRuntimeEnvironment,
  deployment: OctopodSshDeploymentLink,
  policy: ManagedOctopodStopPolicy
): Promise<void> {
  // Remove registration before releasing claims so crashes leave a resumable hidden target.
  removeManagedOctopodEnvironment(userDataPath, environment.id)
  await policy.retireLocalState(environment.id)
  await closeOctopodManagedTunnel(environment.id)
  const { claims } = requireManagedOctopodInfrastructure()
  claims.releaseForUserRemoval(deployment.sshTargetId, environment.id)
  clearManagedOctopodUpdateDeferral(environment.id)
  await claims.flush()
  // Clear journals after the fence; stale leftovers are recoverable on later conversion.
  removeOctopodMigrationJournalsForDestination(userDataPath, deployment.sshTargetId, environment.id)
}

export function cancelManagedOctopodStop(
  userDataPath: string,
  args: { selector: string; signal?: AbortSignal }
): Promise<OctopodManagedCancelStopResult> {
  return withManagedOctopodLifecycle(userDataPath, args.selector, async (managed) => {
    const { environment, deployment } = managed
    const context = await resolveLinkedOctopodContext(environment, deployment, args.signal)
    const slot = managedOctopodSlot(context, deployment.remotePort, args.signal)
    let result: OctopodManagedCancelStopResult
    try {
      result = await withStaleOctopodActivationRecoveryLock(slot, async (lock) => {
        const transaction = await readOctopodActivationTransaction(slot)
        if (transaction?.operation !== 'decommission') {
          if (transaction) {
            lock.retain()
          }
          return { outcome: 'none' }
        }
        if (transaction.phase === 'process-exited') {
          lock.retain()
          return { outcome: 'already-stopped' }
        }
        if (transaction.request) {
          const cancellation = await cancelRemoteOctopodManagedStop(slot, transaction.request)
          if (cancellation.outcome !== 'canceled') {
            lock.retain()
            return {
              outcome: 'refused',
              verdict: 'live',
              code: 'octopod_stop_already_dispatched',
              reason: 'octopod already acted on the stop and is shutting down; it cannot be canceled.'
            }
          }
        }
        const kept = await reconcileOctopodDecommission(slot, {
          action: 'keep-serving',
          version: transaction.activeVersion
        })
        if (kept.outcome !== 'recovered' || !kept.activeVersion) {
          lock.retain()
          return {
            outcome: 'refused',
            verdict: 'unverifiable',
            code: 'octopod_stop_cancel_unverifiable',
            reason: 'The stop was withdrawn but the server could not be shown to be serving.'
          }
        }
        return { outcome: 'canceled', activeVersion: kept.activeVersion }
      })
    } catch (error) {
      if (error instanceof RemoteInstallLockBusyError) {
        return {
          outcome: 'refused',
          verdict: 'unverifiable',
          code: 'octopod_stop_still_running',
          reason: 'A stop on this server may still be running. Retry after it settles.'
        }
      }
      throw error
    }
    if (result.outcome === 'canceled') {
      await ensureOctopodManagedTunnel(userDataPath, environment.id)
    }
    return result
  })
}
