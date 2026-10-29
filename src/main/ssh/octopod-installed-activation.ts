/** Journal durably before mutation so interrupted deploys can finish or recover. Release the fence only once the host is provably settled on one slot. */
import { octopodRemoteBaseDir } from '../managed-server/install/octopod-remote-windows-node'
import { randomUUID } from 'node:crypto'
import type { OctopodDeployOptions, OctopodDeployResult } from './octopod-remote-deploy'
import { isUnconfirmedSshCommandTermination } from './remote-exec/remote-exec-command'
import {
  withActivatedVersion,
  type OctopodActivationRecord,
  type OctopodStateSnapshot
} from '../managed-server/activation/octopod-activation-record'
import {
  readOctopodActivationRecord,
  writeOctopodActivationRecord
} from '../managed-server/activation/octopod-activation-record-store'
import { launchAndJudgeOctopodSlot } from './octopod-candidate-launch-verdict'
import { planOctopodUpdate } from './octopod-update-plan'
import {
  type OctopodTerminalCensus,
  UNVERIFIABLE_OCTOPOD_TERMINAL_CENSUS
} from '../../shared/octopod-terminal-census'
import { runFencedStop } from './octopod-fenced-stop'
import { CURRENT_OCTOPOD_DAEMON_PROTOCOL } from './octopod-daemon-protocol-crossing'
import { OCTOPOD_LOG_FILENAME } from '../managed-server/install/octopod-remote-host-support'
import { octopodSnapshotFailureReason } from '../managed-server/host-state/octopod-state-snapshot-space'
import {
  OCTOPOD_SNAPSHOT_SPACE_INSUFFICIENT_CODE,
  octopodSnapshotRoomRefusal,
  octopodSnapshotsRoot
} from './octopod-snapshot-room'
import {
  captureOctopodStateSnapshotCommand,
  octopodSnapshotDirName,
  parseOctopodSnapshotCapture
} from '../managed-server/host-state/octopod-state-snapshot'
import { joinRemotePath } from './ssh-remote-platform'
import { computeLocalOctopodBuildHash } from './octopod-local-build-hash'
import { preflightInstalledOctopod } from '../managed-server/install/octopod-remote-preflight'
import type { OctopodActivationLockControl } from '../managed-server/activation/octopod-activation-lock'
import type { OctopodActivateTransaction } from '../managed-server/activation/octopod-activation-transaction'
import {
  createOctopodActivationTransaction,
  withOctopodActivationCandidateReady,
  withOctopodActivationIncumbentStopped,
  withOctopodActivationSnapshot
} from '../managed-server/activation/octopod-activation-transaction-transitions'
import { writeOctopodActivationTransaction } from '../managed-server/activation/octopod-activation-transaction-store'
import {
  execOctopodRemoteOr,
  withoutAbortSignal
} from '../managed-server/install/octopod-remote-runtime-control'
import { execOctopodStateMutationOr } from '../managed-server/host-state/octopod-state-mutation-exec'
import {
  initialOctopodActivationAdmissionCommand,
  parseInitialOctopodActivationAdmission
} from './octopod-initial-activation-admission'
import {
  octopodSlotDir,
  resolveOctopodSlotIdentity,
  type OctopodSlotIdentity
} from './octopod-recovery-slot'
import { octopodSnapshotPath } from './octopod-incumbent-recovery'
import {
  restartAfterSnapshotFailure,
  restoreAfterRejectedCandidate,
  stopTransactionIncumbent
} from './octopod-transaction-incumbent'
import { withOctopodLogTail } from '../managed-server/install/octopod-remote-log-tail'
import { octopodCandidateLaunchFailureCode } from '../octopod/octopod-host-unavailable'
import { errorMessage } from '../../shared/error-message'

type Outcome = Extract<OctopodDeployResult, { outcome: 'installed-not-activated' }>

export const OCTOPOD_ACTIVATION_POLICY_REFUSED_CODE = 'octopod_activation_policy_refused'

function countedLockedRecord(options: OctopodDeployOptions, record: OctopodActivationRecord): boolean {
  const counted = options.censusRecord
  return (
    !counted || (counted.active === record.active && counted.activatedAt === record.activatedAt)
  )
}

/** A census of another incumbent cannot authorize stopping this one. */
function censusForLockedRecord(
  options: OctopodDeployOptions,
  record: OctopodActivationRecord
): OctopodTerminalCensus {
  return countedLockedRecord(options, record) ? options.census : UNVERIFIABLE_OCTOPOD_TERMINAL_CENSUS
}

export async function activateInstalledOctopod(
  options: OctopodDeployOptions & { localOctopodDir: string },
  fullVersion: string,
  remoteDir: string,
  lock: OctopodActivationLockControl
): Promise<OctopodDeployResult> {
  const now = options.now ?? ((): Date => new Date())
  const notActivated = (code: string, reason: string): Outcome => ({
    outcome: 'installed-not-activated',
    fullVersion,
    code,
    reason
  })
  const record = await readOctopodActivationRecord(options)
  const plan = planOctopodUpdate({
    record,
    candidateVersion: fullVersion,
    census: censusForLockedRecord(options, record),
    candidateDaemonProtocol: CURRENT_OCTOPOD_DAEMON_PROTOCOL,
    ...(options.force !== undefined ? { force: options.force } : {})
  })
  if (plan.action === 'noop') {
    return { outcome: 'already-active', fullVersion }
  }
  const refusal = options.admitRecord?.(record, fullVersion)
  if (refusal) {
    return notActivated(OCTOPOD_ACTIVATION_POLICY_REFUSED_CODE, refusal)
  }
  if (plan.action === 'defer') {
    return notActivated(plan.code, plan.reason)
  }

  try {
    await preflightInstalledOctopod({
      ...options,
      remoteInstallDir: remoteDir,
      fullVersion
    })
  } catch (error) {
    options.signal?.throwIfAborted()
    return notActivated(
      'octopod_candidate_preflight_failed',
      `Candidate profile preflight failed; the incumbent was not stopped: ${errorMessage(error)}`
    )
  }

  let incumbent: OctopodSlotIdentity | null = null
  if (record.active) {
    try {
      incumbent = await resolveOctopodSlotIdentity(options, record.active)
    } catch (error) {
      if (isUnconfirmedSshCommandTermination(error)) {
        throw error
      }
      return notActivated(
        'octopod_incumbent_identity_unverifiable',
        `The active octopod ${record.active} build identity could not be verified before ` +
          `stopping it: ${errorMessage(error)} Nothing was stopped.`
      )
    }
  } else {
    const admission = parseInitialOctopodActivationAdmission(
      await execOctopodRemoteOr(
        options,
        initialOctopodActivationAdmissionCommand(
          options.host,
          options.userDataDir,
          remoteDir,
          options.nodePath
        )
      )
    )
    if (admission.decision === 'defer') {
      return notActivated(admission.code, admission.reason)
    }
  }

  // Scan snapshot room before recount so slow scans cannot outdate stop admission.
  const roomless = await octopodSnapshotRoomRefusal(options, record, fullVersion)
  if (roomless) {
    return notActivated(OCTOPOD_SNAPSHOT_SPACE_INSUFFICIENT_CODE, roomless)
  }

  const startedAt = now()
  let transaction: OctopodActivateTransaction = createOctopodActivationTransaction({
    transactionId: randomUUID(),
    candidateVersion: fullVersion,
    appVersion: options.appVersion,
    recordBefore: record,
    snapshotDirName: octopodSnapshotDirName(fullVersion, startedAt.getTime()),
    now: startedAt
  })
  const beginMutating = (): void => {
    lock.retainOnError()
    // After mutation starts, cancellation would strand a stopped host; finish or roll back.
    options = withoutAbortSignal(options)
  }
  if (incumbent) {
    // Recount immediately before stop; the initial census may predate a long upload.
    const fenced = await runFencedStop({
      recountCensus: () =>
        countedLockedRecord(options, record)
          ? options.recountCensus()
          : Promise.reject(new Error('not the incumbent this update counted')),
      releaseIncumbentAdmission: options.releaseIncumbentAdmission,
      now: () => now().getTime(),
      refuse: (census) => {
        const plan = planOctopodUpdate({
          record,
          candidateVersion: fullVersion,
          census,
          candidateDaemonProtocol: CURRENT_OCTOPOD_DAEMON_PROTOCOL,
          ...(options.force !== undefined ? { force: options.force } : {})
        })
        return plan.action === 'defer' ? notActivated(plan.code, plan.reason) : null
      },
      prepare: () => writeOctopodActivationTransaction(options, transaction),
      stale: () =>
        notActivated(
          'octopod_update_terminal_census_unavailable',
          'The terminal count went stale before the current server could be stopped, so nothing ' +
            'was stopped. Shield will try the update again.'
        ),
      stop: () => {
        beginMutating()
        return stopTransactionIncumbent(options, incumbent, lock)
      },
      stopMayHaveBeenSent: (unstopped) => unstopped === null || unstopped.stopMayBeUnderway
    })
    if ('refused' in fenced) {
      return fenced.refused
    }
    if (fenced.stopped) {
      return notActivated(
        'octopod_outgoing_stop_incomplete',
        `${fenced.stopped.reason} No snapshot was taken and the candidate was not started. Shield ` +
          'requires matching runtime readiness before signaling an incumbent and confirmed exit ' +
          'before snapshotting.'
      )
    }
  } else {
    await writeOctopodActivationTransaction(options, transaction)
    beginMutating()
  }
  transaction = withOctopodActivationIncumbentStopped(transaction, now())
  await writeOctopodActivationTransaction(options, transaction)

  // Wait for confirmed exit before snapshotting; a live SQLite WAL is not a backup boundary.
  const snapshotDir = octopodSnapshotPath(options, transaction.snapshot.dirName)
  const captureOutput = await execOctopodStateMutationOr(
    options,
    captureOctopodStateSnapshotCommand(
      options.host,
      options.userDataDir,
      snapshotDir,
      octopodRemoteBaseDir(options.host, options.remoteHome),
      {
        snapshotsRoot: octopodSnapshotsRoot(options),
        keep: [transaction.snapshot.dirName, ...(record.snapshot ? [record.snapshot.dirName] : [])]
      }
    ),
    'FAILED'
  )
  const capture = parseOctopodSnapshotCapture(captureOutput)
  if (capture === 'failed') {
    const reason = octopodSnapshotFailureReason(captureOutput)
    const restarted = incumbent
      ? ` The incumbent was stopped before snapshotting; ${await restartAfterSnapshotFailure(options, incumbent, lock)}`
      : ''
    throw new Error(
      `Could not snapshot ${options.userDataDir} before activating ${fullVersion}` +
        `${reason ? `: ${reason}` : ''}. Shield's persisted state carries no schema version, so ` +
        'without a snapshot a rollback has no way back. Refusing to activate. Fix what stops ' +
        `the copy (often a full disk or quota on ${octopodRemoteBaseDir(options.host, options.remoteHome)}), ` +
        `then reconnect.${restarted}`
    )
  }
  const snapshot: OctopodStateSnapshot | null =
    capture === 'captured'
      ? {
          dirName: transaction.snapshot.dirName,
          takenBeforeVersion: fullVersion,
          readableByVersion: record.active,
          takenAt: startedAt.toISOString()
        }
      : null
  transaction = withOctopodActivationSnapshot(transaction, capture, now())
  await writeOctopodActivationTransaction(options, transaction)

  const { verdict, launchError } = await launchAndJudgeOctopodSlot(options, {
    remoteInstallDir: remoteDir,
    fullVersion,
    buildHash: computeLocalOctopodBuildHash(options.localOctopodDir)
  })
  if (verdict.decision === 'reject') {
    const [code, reason] =
      launchError === undefined
        ? [verdict.code, verdict.reason]
        : [
            octopodCandidateLaunchFailureCode(launchError),
            `The candidate failed while starting: ${errorMessage(launchError)}`
          ]
    const restored = await restoreAfterRejectedCandidate(options, lock, {
      launchedDir: octopodSlotDir(options, transaction.candidateVersion),
      launchedVersion: transaction.candidateVersion,
      transactionStartedAt: transaction.startedAt,
      incumbent,
      restoreState: transaction.snapshot
    })
    const located =
      `${reason} Candidate stderr is at ` +
      `${joinRemotePath(options.host, remoteDir, OCTOPOD_LOG_FILENAME)}. ${restored}`
    return notActivated(code, await withOctopodLogTail(options, remoteDir, located))
  }

  const recordAfter = withActivatedVersion(record, fullVersion, snapshot, now(), options.appVersion)
  transaction = withOctopodActivationCandidateReady(transaction, recordAfter, now())
  await writeOctopodActivationTransaction(options, transaction)
  await writeOctopodActivationRecord(options, recordAfter)
  return { outcome: 'installed-and-activated', fullVersion, verdict }
}
