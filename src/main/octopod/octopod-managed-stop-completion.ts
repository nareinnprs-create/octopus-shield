// Request shutdown without signaling; only kernel identity, owner change or PID absence proves exit.
import { setTimeout as delay } from 'node:timers/promises'
import { writeDurableSecureJsonFile } from '../../shared/secure-file'
import {
  OctopodManagedStopRequestSchema,
  octopodManagedStopRequestKey,
  type OctopodManagedStopInstance,
  type OctopodManagedStopRequest,
  type OctopodManagedStopVerdict
} from '../../shared/octopod-stop-request'
import {
  compareOctopodProcessIdentity,
  recordedOctopodProcessIncarnation,
  type OctopodProcessIdentityReaders,
  type OctopodRecordedIdentity
} from './octopod-process-start-time'
import { hasErrorCode, inspectProcessSignal } from '../daemon/daemon-process-inspection'
import { persistOctopodCompletedStopReceipt } from './octopod-completed-stop-receipt'
import { readOctopodManagedStopDecision } from './octopod-managed-stop-decision'
import { withdrawOctopodManagedStopRequest } from './octopod-managed-stop-cancellation'
import {
  octopodInstanceLockNames,
  octopodManagedStopRequestPath,
  readOctopodInstanceLockNaming,
  readOctopodManagedStopRequest
} from './octopod-managed-stop-request'
import {
  OCTOPOD_STOP_COMPLETION_POLL_ATTEMPTS,
  OCTOPOD_STOP_COMPLETION_POLL_MS
} from './octopod-stop-deadlines'

type OctopodProcessProbe = (pid: number) => 'alive' | 'missing' | 'unverifiable'

export type OctopodManagedStopCompletionOptions = OctopodProcessIdentityReaders & {
  probeProcess?: OctopodProcessProbe
  sleep?: () => Promise<void>
  attempts?: number
  now?: () => Date
}

function defaultProbe(pid: number): ReturnType<OctopodProcessProbe> {
  const signal = inspectProcessSignal(pid)
  // EPERM proves some process holds the PID; it cannot prove ours exited.
  return signal === 'occupied' ? 'alive' : signal === 'missing' ? 'missing' : 'unverifiable'
}

function observeInstance(
  instance: OctopodManagedStopInstance,
  recorded: OctopodRecordedIdentity,
  options: OctopodManagedStopCompletionOptions
): OctopodManagedStopVerdict {
  const probe = (options.probeProcess ?? defaultProbe)(instance.pid)
  if (probe !== 'alive') {
    return probe === 'missing' ? 'exited' : 'unverifiable'
  }
  // Wall-clock drift alone cannot prove PID reuse.
  const identity = compareOctopodProcessIdentity(instance.pid, recorded, options)
  return identity === 'differs' ? 'exited' : identity === 'unproven' ? 'unverifiable' : 'live'
}

/** Recover incarnation data from the lock for older clients that omit it. */
function recordedIdentity(instance: OctopodManagedStopInstance): OctopodRecordedIdentity {
  if (recordedOctopodProcessIncarnation(instance)) {
    return instance
  }
  let record: OctopodRecordedIdentity | null = null
  try {
    record = readOctopodInstanceLockNaming(instance)
  } catch {
    return instance
  }
  if (!record) {
    return instance
  }
  return { ...instance, ...recordedOctopodProcessIncarnation(record), identity: record.identity }
}

export async function completeOctopodManagedStop(
  input: OctopodManagedStopRequest,
  options: OctopodManagedStopCompletionOptions = {}
): Promise<OctopodManagedStopVerdict> {
  const request = OctopodManagedStopRequestSchema.parse(input)
  const attempts = options.attempts ?? OCTOPOD_STOP_COMPLETION_POLL_ATTEMPTS
  if (!Number.isSafeInteger(attempts) || attempts < 1 || attempts > 240) {
    throw new Error('octopod_managed_stop_invalid_attempts')
  }
  const completed = (): 'exited' => {
    persistOctopodCompletedStopReceipt(request, (options.now ?? (() => new Date()))())
    return 'exited'
  }
  const recorded = recordedIdentity(request.instance)
  let verdict = observeInstance(request.instance, recorded, options)
  if (verdict !== 'live') {
    return verdict === 'exited' ? completed() : verdict
  }
  if (!lockStillNamesInstance(request.instance)) {
    // A live process that relinquished its lock is no longer ours to address.
    return 'unverifiable'
  }
  if (readOctopodManagedStopDecision(request) === 'canceled') {
    return 'live'
  }
  const requestPath = octopodManagedStopRequestPath(request.instance)
  if (!existingRequestMatches(requestPath, request)) {
    return 'unverifiable'
  }
  if (!writeDurableSecureJsonFile(requestPath, request)) {
    throw new Error('octopod_managed_stop_request_permissions_unconfirmed')
  }
  // A cancel between the first check and write had no request file to remove.
  if (readOctopodManagedStopDecision(request) === 'canceled') {
    withdrawOctopodManagedStopRequest(request)
    return 'live'
  }
  for (let attempt = 0; attempt < attempts; attempt++) {
    await (options.sleep ?? (() => delay(OCTOPOD_STOP_COMPLETION_POLL_MS)))()
    verdict = observeInstance(request.instance, recorded, options)
    if (verdict !== 'live') {
      return verdict === 'exited' ? completed() : verdict
    }
  }
  return 'live'
}

function lockStillNamesInstance(instance: OctopodManagedStopInstance): boolean {
  try {
    return octopodInstanceLockNames(instance)
  } catch {
    return false
  }
}

function existingRequestMatches(path: string, request: OctopodManagedStopRequest): boolean {
  try {
    return (
      octopodManagedStopRequestKey(readOctopodManagedStopRequest(path)) ===
      octopodManagedStopRequestKey(request)
    )
  } catch (error) {
    return hasErrorCode(error, 'ENOENT')
  }
}
