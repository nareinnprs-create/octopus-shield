// Readiness and instance-lock records must agree before the slot's own build requests a stop.
import { randomUUID } from 'node:crypto'
import { quotePosixShell } from '../../../shared/shell-argument-quoting'
import { selectOctopodSlotRuntimeCommand } from '../install/octopod-remote-runtime'
import {
  parseOctopodReadinessWaitOutput,
  readOctopodReadinessNowCommand
} from '../install/octopod-remote-readiness-wait'
import { execOctopodRemote } from '../install/octopod-remote-runtime-control'
import { readBoundedOctopodRemoteRecord } from '../install/octopod-remote-record-file'
import { octopodSlotDir, type OctopodSlotOptions } from '../../ssh/octopod-recovery-slot'
import { isWindowsRemoteHost, joinRemotePath } from '../../ssh/ssh-remote-platform'
import { isUnconfirmedSshCommandTermination } from '../../ssh/remote-exec/remote-exec-command'
import {
  octopodWindowsNodeCommandLine,
  octopodWindowsSlotOpCommand,
  readOctopodWindowsEncodedAnswer
} from '../install/octopod-remote-windows-node'
import { OCTOPOD_WINDOWS_RUNTIME_MARKER } from '../host-state/octopod-windows-host-script'
import { OCTOPOD_LOCK_FILE_NAME, parseOctopodInstanceLockRecord } from '../../octopod/octopod-instance-lock'
import {
  OCTOPOD_CANCEL_MANAGED_STOP_FLAG,
  OCTOPOD_COMPLETE_MANAGED_STOP_FLAG,
  OCTOPOD_MANAGED_STOP_REQUEST_FILE_FLAG,
  OCTOPOD_STOP_REQUESTS_CAPABILITY,
  OctopodManagedStopCancellationSchema,
  OctopodManagedStopCompletionSchema,
  type OctopodManagedStopCancellation,
  type OctopodManagedStopCompletion,
  type OctopodManagedStopContext,
  type OctopodManagedStopRequest
} from '../../../shared/octopod-stop-request'

const LOCK_RECORD_MAX_BYTES = 64 * 1024

export type OctopodManagedStopTarget =
  | { state: 'ready'; context: OctopodManagedStopContext }
  | { state: 'refused'; verdict: 'unverifiable'; code: string; reason: string }

function refused(code: string, reason: string): OctopodManagedStopTarget {
  return { state: 'refused', verdict: 'unverifiable', code, reason }
}

export async function readRemoteOctopodManagedStopTarget(
  options: OctopodSlotOptions,
  version: string
): Promise<OctopodManagedStopTarget> {
  const slotDir = octopodSlotDir(options, version)
  const readiness = parseOctopodReadinessWaitOutput(
    options.host,
    await execOctopodRemote(options, readOctopodReadinessNowCommand(options.host, slotDir))
  )
  if (readiness.state !== 'ready' || !readiness.readiness.health) {
    return refused(
      'octopod_managed_stop_readiness_unverifiable',
      `octopod ${version} has no readable readiness record, so the running instance is unknown.`
    )
  }
  const { health, runtimeId } = readiness.readiness
  if (health.stopRequests !== OCTOPOD_STOP_REQUESTS_CAPABILITY) {
    return refused(
      'octopod_managed_stop_unsupported',
      `octopod ${version} predates managed stop requests; it can only be stopped by signal.`
    )
  }
  const lockPath = joinRemotePath(options.host, options.userDataDir, OCTOPOD_LOCK_FILE_NAME)
  const lockRead = await readBoundedOctopodRemoteRecord(options, lockPath, LOCK_RECORD_MAX_BYTES)
  const lock = lockRead.state === 'present' ? parseOctopodInstanceLockRecord(lockRead.raw) : null
  if (!lock || lock.pid !== health.pid || !runtimeId) {
    return refused(
      'octopod_managed_stop_instance_unverifiable',
      `The instance lock does not name the octopod ${version} that published readiness.`
    )
  }
  return {
    state: 'ready',
    context: {
      version,
      runtimeId,
      instance: {
        pid: lock.pid,
        startedAtMs: lock.startedAtMs,
        // Newer slots use boot/start ticks to avoid wall-clock drift; older readers drop them.
        ...(lock.linuxStartTicks && lock.bootId
          ? { linuxStartTicks: lock.linuxStartTicks, bootId: lock.bootId }
          : {}),
        nonce: lock.nonce,
        lockPath
      }
    }
  }
}

export async function completeRemoteOctopodManagedStop(
  options: OctopodSlotOptions,
  request: OctopodManagedStopRequest
): Promise<OctopodManagedStopCompletion> {
  return OctopodManagedStopCompletionSchema.parse(
    await runSlotCommand(options, request, OCTOPOD_COMPLETE_MANAGED_STOP_FLAG)
  )
}

export async function cancelRemoteOctopodManagedStop(
  options: OctopodSlotOptions,
  request: OctopodManagedStopRequest
): Promise<OctopodManagedStopCancellation> {
  return OctopodManagedStopCancellationSchema.parse(
    await runSlotCommand(options, request, OCTOPOD_CANCEL_MANAGED_STOP_FLAG)
  )
}

// The slot's own build owns its stop-request format.
async function runSlotCommand(
  options: OctopodSlotOptions,
  request: OctopodManagedStopRequest,
  flag: string
): Promise<unknown> {
  const slotDir = octopodSlotDir(options, request.version)
  const entry = joinRemotePath(options.host, slotDir, 'octopod.js')
  const output = isWindowsRemoteHost(options.host)
    ? await runWindowsSlotCommand(options, slotDir, entry, request, flag)
    : await execOctopodRemote(
        options,
        `${selectOctopodSlotRuntimeCommand(options.host, slotDir, options.nodePath)} && ` +
          `"$octopod_runtime" ${quotePosixShell(entry)} ${flag} ${quotePosixShell(JSON.stringify(request))}`
      )
  const line = output
    .trim()
    .split('\n')
    .findLast((candidate) => candidate.trim().startsWith('{'))
  if (!line) {
    throw new Error('octopod managed stop command returned no verifiable answer')
  }
  const parsed: unknown = JSON.parse(line)
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('octopod managed stop command returned no verifiable answer')
  }
  if (!('transactionId' in parsed) || parsed.transactionId !== request.transactionId) {
    throw new Error('octopod managed stop command answered another transaction')
  }
  return parsed
}

// Stage JSON on Windows to avoid two command-line quoting layers.
async function runWindowsSlotCommand(
  options: OctopodSlotOptions,
  slotDir: string,
  entry: string,
  request: OctopodManagedStopRequest,
  flag: string
): Promise<string> {
  const runtime = readOctopodWindowsEncodedAnswer(
    await execOctopodRemote(
      options,
      octopodWindowsSlotOpCommand(options.host, slotDir, 'slot-runtime', [slotDir])
    ),
    OCTOPOD_WINDOWS_RUNTIME_MARKER
  )
  if (!runtime) {
    throw new Error('The Windows host did not name the runtime this octopod slot needs.')
  }
  const staged = joinRemotePath(options.host, slotDir, `.octopod-stop-command-${randomUUID()}.json`)
  let removeStaged = true
  try {
    await options.conn.writeFile(staged, JSON.stringify(request), {
      hostPlatform: options.host,
      signal: options.signal
    })
    return await execOctopodRemote(
      options,
      octopodWindowsNodeCommandLine(runtime, [
        entry,
        flag,
        OCTOPOD_MANAGED_STOP_REQUEST_FILE_FLAG,
        staged
      ])
    )
  } catch (error) {
    // Unconfirmed commands may still be reading the staged request.
    removeStaged = !isUnconfirmedSshCommandTermination(error)
    throw error
  } finally {
    if (removeStaged) {
      await execOctopodRemote(
        options,
        octopodWindowsSlotOpCommand(options.host, slotDir, 'remove-file', [staged])
      ).catch(() => {})
    }
  }
}
