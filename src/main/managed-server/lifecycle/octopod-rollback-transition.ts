import { octopodRemoteBaseDir } from '../install/octopod-remote-windows-node'
import { randomUUID } from 'node:crypto'
import type { OctopodRollbackOptions, OctopodRollbackResult } from '../install/octopod-remote-rollback'
import { isUnconfirmedSshCommandTermination } from '../../ssh/remote-exec/remote-exec-command'
import { withRolledBackVersion } from '../activation/octopod-activation-record'
import { writeOctopodActivationRecord } from '../activation/octopod-activation-record-store'
import { launchAndJudgeOctopodSlot } from '../../ssh/octopod-candidate-launch-verdict'
import { assessOctopodRollback } from '../../ssh/octopod-update-plan'
import { OCTOPOD_LOG_FILENAME } from '../install/octopod-remote-host-support'
import {
  captureOctopodStateSnapshotCommand,
  octopodRollbackRescueDirName,
  parseOctopodSnapshotCapture,
  parseOctopodSnapshotPresence,
  parseOctopodSnapshotRestore,
  probeOctopodStateSnapshotCommand,
  restoreOctopodStateSnapshotCommand
} from '../host-state/octopod-state-snapshot'
import {
  newestStateMtimeCommand,
  parseNewestStateMtimeSeconds
} from '../host-state/octopod-state-newest-mtime'
import { joinRemotePath } from '../../ssh/ssh-remote-platform'
import type { OctopodActivationLockControl } from '../activation/octopod-activation-lock'
import {
  rollbackStartingState,
  type OctopodRollbackTransaction
} from '../activation/octopod-activation-transaction'
import {
  createOctopodRollbackTransaction,
  withOctopodRollbackPhase,
  withOctopodRollbackRescue
} from '../activation/octopod-activation-transaction-transitions'
import { writeOctopodActivationTransaction } from '../activation/octopod-activation-transaction-store'
import { ROLLBACK_STALE_COUNT, rollbackRecountRefusal } from './octopod-rollback-admission'
import { runFencedStop } from '../../ssh/octopod-fenced-stop'
import { execOctopodRemoteOr, withoutAbortSignal } from '../install/octopod-remote-runtime-control'
import { execOctopodStateMutationOr } from '../host-state/octopod-state-mutation-exec'
import {
  octopodSlotDir,
  resolveOctopodSlotIdentity,
  type OctopodSlotIdentity
} from '../../ssh/octopod-recovery-slot'
import { octopodSnapshotPath } from '../../ssh/octopod-incumbent-recovery'
import {
  putTransactionIncumbentBack,
  restoreAfterRejectedCandidate
} from '../../ssh/octopod-transaction-incumbent'
import {
  readOctopodRollbackBarrierTarget,
  rollbackBarrierRefusal,
  stopIncumbentBehindTerminalBarrier
} from './octopod-rollback-terminal-barrier'
import { withOctopodLogTail } from '../install/octopod-remote-log-tail'
import { errorMessage } from '../../../shared/error-message'

async function stateWritesSinceActivation(options: OctopodRollbackOptions): Promise<boolean | null> {
  const activatedAtSeconds = Math.floor(Date.parse(options.record.activatedAt ?? '') / 1000)
  if (!Number.isFinite(activatedAtSeconds)) {
    return null
  }
  const newest = parseNewestStateMtimeSeconds(
    await execOctopodRemoteOr(
      options,
      newestStateMtimeCommand(
        options.host,
        options.userDataDir,
        octopodRemoteBaseDir(options.host, options.remoteHome)
      )
    )
  )
  return newest === null ? null : newest >= activatedAtSeconds
}

export async function rollbackOctopodLocked(
  options: OctopodRollbackOptions,
  lock: OctopodActivationLockControl
): Promise<OctopodRollbackResult> {
  const now = options.now ?? ((): Date => new Date())
  const snapshot = options.record.snapshot
  const presence = snapshot
    ? parseOctopodSnapshotPresence(
        await execOctopodRemoteOr(
          options,
          probeOctopodStateSnapshotCommand(
            options.host,
            octopodSnapshotPath(options, snapshot.dirName),
            octopodRemoteBaseDir(options.host, options.remoteHome)
          )
        )
      )
    : 'absent'
  const safety = assessOctopodRollback({
    record: options.record,
    snapshotPresent: presence === 'unverifiable' ? null : presence === 'present',
    census: options.census,
    targetDaemonProtocol: options.targetDaemonProtocol,
    stateWritesSinceActivation: await stateWritesSinceActivation(options)
  })
  if (safety.safety === 'unsafe') {
    return { outcome: 'refused', code: safety.code, reason: safety.reason }
  }
  if (!snapshot || !options.record.active) {
    return {
      outcome: 'refused',
      code: 'octopod_rollback_no_active',
      reason: 'No octopod version is active on this host, so there is nothing to roll back from.'
    }
  }
  let incumbent: OctopodSlotIdentity
  try {
    incumbent = await resolveOctopodSlotIdentity(options, options.record.active)
  } catch (error) {
    if (isUnconfirmedSshCommandTermination(error)) {
      throw error
    }
    return {
      outcome: 'refused',
      code: 'octopod_rollback_active_identity_unverifiable',
      reason: `The active octopod identity could not be verified: ${errorMessage(error)} Nothing was changed.`
    }
  }

  const barrierTarget = await readOctopodRollbackBarrierTarget(options, incumbent.version)
  if (barrierTarget.state === 'refused') {
    return { outcome: 'refused', code: barrierTarget.code, reason: barrierTarget.reason }
  }
  const startedAt = now()
  let transaction: OctopodRollbackTransaction = createOctopodRollbackTransaction({
    transactionId: randomUUID(),
    incumbentVersion: incumbent.version,
    targetVersion: safety.target,
    recordBefore: options.record,
    recordAfter: withRolledBackVersion(options.record, startedAt),
    rescueDirName: octopodRollbackRescueDirName(incumbent.version, startedAt.getTime()),
    now: startedAt
  })
  const fenced = await runFencedStop({
    recountCensus: options.recountCensus,
    releaseIncumbentAdmission: options.releaseIncumbentAdmission,
    now: () => now().getTime(),
    refuse: rollbackRecountRefusal,
    prepare: () => writeOctopodActivationTransaction(options, transaction),
    stale: () => ROLLBACK_STALE_COUNT,
    stop: async () => {
      lock.retainOnError()
      // Cancellation after mutation could strand a stopped host; finish or recover instead.
      options = withoutAbortSignal(options)
      // Pre-lock census can go stale; the fenced stop supplies the terminal-safety proof.
      return stopIncumbentBehindTerminalBarrier(
        options,
        transaction.transactionId,
        barrierTarget.context
      )
    },
    // Withdrawn stops leave the incumbent serving and needing admission reopened.
    stopMayHaveBeenSent: (barrier) => barrier.state !== 'withdrawn'
  })
  if ('refused' in fenced) {
    return fenced.refused
  }
  const blocked = rollbackBarrierRefusal(fenced.stopped)
  if (blocked) {
    if (blocked.retainFence) {
      lock.retain()
    }
    const recovered = blocked.restartIncumbent
      ? ` ${await putIncumbentBack(options, lock, transaction, incumbent)}`
      : ''
    return { outcome: blocked.outcome, code: blocked.code, reason: blocked.reason + recovered }
  }
  transaction = withOctopodRollbackPhase(transaction, 'incumbent-stopped', now())
  await writeOctopodActivationTransaction(options, transaction)

  const rescue = parseOctopodSnapshotCapture(
    await execOctopodStateMutationOr(
      options,
      captureOctopodStateSnapshotCommand(
        options.host,
        options.userDataDir,
        octopodSnapshotPath(options, transaction.rescue.dirName),
        octopodRemoteBaseDir(options.host, options.remoteHome)
      )
    )
  )
  if (rescue === 'failed') {
    const recovered = await putIncumbentBack(options, lock, transaction, incumbent)
    return {
      outcome: 'failed',
      code: 'octopod_rollback_rescue_snapshot_failed',
      reason:
        'The current state could not be preserved in a rescue snapshot, so the data root was ' +
        `not replaced. ${recovered}`
    }
  }
  transaction = withOctopodRollbackRescue(transaction, rescue, now())
  await writeOctopodActivationTransaction(options, transaction)

  // Restore before launching: older builds must never load newer state.
  const restored = parseOctopodSnapshotRestore(
    await execOctopodStateMutationOr(
      options,
      restoreOctopodStateSnapshotCommand(
        options.host,
        options.userDataDir,
        octopodSnapshotPath(options, snapshot.dirName),
        octopodRemoteBaseDir(options.host, options.remoteHome)
      )
    )
  )
  if (restored !== 'restored') {
    const recovered = await putIncumbentBack(options, lock, transaction, incumbent)
    return {
      outcome: 'failed',
      code: 'octopod_rollback_restore_failed',
      reason: `The pre-activation snapshot could not be restored (${restored}). ${recovered}`
    }
  }
  transaction = withOctopodRollbackPhase(transaction, 'rollback-state-restored', now())
  await writeOctopodActivationTransaction(options, transaction)

  const targetDir = octopodSlotDir(options, safety.target)
  const { verdict, launchError } = await launchAndJudgeOctopodSlot(options, {
    remoteInstallDir: targetDir,
    fullVersion: safety.target,
    buildHash: options.targetBuildHash
  })
  if (verdict.decision === 'reject') {
    const reason =
      launchError === undefined
        ? verdict.reason
        : `It failed while starting: ${errorMessage(launchError)}`
    const recovered = await restoreAfterRejectedCandidate(options, lock, {
      launchedDir: targetDir,
      launchedVersion: safety.target,
      transactionStartedAt: transaction.startedAt,
      incumbent,
      restoreState: rescueVerdict(transaction),
      launchedFromState: rollbackStartingState(transaction)
    })
    return {
      outcome: 'failed',
      code: launchError === undefined ? verdict.code : 'octopod_rollback_target_launch_failed',
      reason: await withOctopodLogTail(
        options,
        targetDir,
        `The rollback target ${safety.target} did not come up healthy: ${reason} ${recovered} ` +
          `Its stderr is at ${joinRemotePath(options.host, targetDir, OCTOPOD_LOG_FILENAME)}.`
      )
    }
  }

  // Until target readiness is proven, active must still identify the recoverable incumbent.
  transaction = withOctopodRollbackPhase(transaction, 'target-ready', now())
  await writeOctopodActivationTransaction(options, transaction)
  await writeOctopodActivationRecord(options, transaction.recordAfter)
  return {
    outcome: 'rolled-back',
    target: safety.target,
    discarded: safety.safety === 'lossy' ? safety.discards : [],
    verdict
  }
}

type RestoreState = Parameters<typeof putTransactionIncumbentBack>[2]['restoreState']

function rescueVerdict(transaction: OctopodRollbackTransaction): RestoreState {
  return transaction.rescue.state === 'pending' ? null : transaction.rescue
}

async function putIncumbentBack(
  options: OctopodRollbackOptions,
  lock: OctopodActivationLockControl,
  transaction: OctopodRollbackTransaction,
  incumbent: OctopodSlotIdentity
): Promise<string> {
  const failure = await putTransactionIncumbentBack(options, lock, {
    transactionStartedAt: transaction.startedAt,
    launchedVersion: null,
    incumbent,
    restoreState: rescueVerdict(transaction)
  })
  return failure ?? `octopod ${incumbent.version} was restored and is serving again.`
}
