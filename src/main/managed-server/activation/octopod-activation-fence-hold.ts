/** Retry live fences later, clear abandoned bare fences, and require recovery for interrupted journaled state. */
import {
  octopodActivationFenceExists,
  withStaleOctopodActivationRecoveryLock,
  type OctopodActivationLockOptions
} from './octopod-activation-lock'
import { readOctopodActivationTransaction } from './octopod-activation-transaction-store'
import { octopodActivationFenceLockDir } from './octopod-activation-transaction'
import { isRelayInstallLockStale } from '../install/remote-install-lock'
import { findExitedOwnLockToken } from '../../ssh/octopod-exited-own-lock'
import { octopodRemoteBaseDir } from '../install/octopod-remote-windows-node'

export const OCTOPOD_ACTIVATION_FENCE_BUSY_CODE = 'octopod_activation_fence_busy'
const OCTOPOD_ACTIVATION_RECOVERY_REQUIRED_CODE = 'octopod_activation_recovery_required'

type OctopodActivationFenceRefusal = {
  code: string
  reason: string
  /** Bare stale fence cleared; the caller may retry immediately. */
  cleared?: true
}

export async function octopodActivationFenceRefusal(
  options: OctopodActivationLockOptions,
  attempt: string
): Promise<OctopodActivationFenceRefusal> {
  const lockDir = octopodActivationFenceLockDir(options.host, options.remoteHome)
  const journal = (await readOctopodActivationTransaction(options).catch(() => null)) !== null
  const baseDir = octopodRemoteBaseDir(options.host, options.remoteHome)
  const stale =
    (await findExitedOwnLockToken(options, lockDir, { baseDir, guardsStateMutation: true })) !==
      null || (await isRelayInstallLockStale(options.conn, lockDir, options.host))
  if (stale && !journal && (await clearAbandonedFence(options))) {
    return {
      code: OCTOPOD_ACTIVATION_FENCE_BUSY_CODE,
      reason: `An abandoned fence held this host and was cleared; the ${attempt} is retried.`,
      cleared: true
    }
  }
  const stuck = stale || (journal && !(await octopodActivationFenceExists(options).catch(() => true)))
  return stuck
    ? {
        code: OCTOPOD_ACTIVATION_RECOVERY_REQUIRED_CODE,
        reason: `An interrupted update or stop holds this host, so the ${attempt} did not start. Recover it first.`
      }
    : {
        code: OCTOPOD_ACTIVATION_FENCE_BUSY_CODE,
        reason: `Another run is changing this host’s Shield server, so the ${attempt} did not start. It is retried on a later connect.`
      }
}

/** Drop a stale fence only after rechecking under takeover that no journal appeared. */
async function clearAbandonedFence(options: OctopodActivationLockOptions): Promise<boolean> {
  try {
    return await withStaleOctopodActivationRecoveryLock(options, async (lock) => {
      if (await readOctopodActivationTransaction(options)) {
        lock.retain()
        return false
      }
      return true
    })
  } catch {
    // Failed takeover leaves the fence intact for normal refusal classification.
    return false
  }
}
