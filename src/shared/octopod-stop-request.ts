/** Stop files reach only the watching octopod; signals from stale PID records could stop an unrelated reused process. */
import { z } from 'zod'
import { openEnum } from './zod-salvage'

/** Plain request in the slot directory: the same graceful stop as SIGTERM. */
export const OCTOPOD_STOP_REQUEST_FILENAME = '.octopod-stop-request'
/** Prefix of an instance-bound request in the data root; older listeners never match it. */
export const OCTOPOD_MANAGED_STOP_REQUEST_PREFIX = '.octopod-managed-stop-request'
export const OCTOPOD_MANAGED_STOP_REQUEST_MAX_BYTES = 32 * 1024
export const OCTOPOD_STOP_RECEIPTS_DIRNAME = 'octopod-stop-receipts'
export const OCTOPOD_COMPLETE_MANAGED_STOP_FLAG = '--complete-managed-stop'
/** Names a staged request file instead of inline JSON; Windows hosts never put the JSON on argv. */
export const OCTOPOD_MANAGED_STOP_REQUEST_FILE_FLAG = '--request-file'

/** One octopod process: its PID, start time, and the instance lock record it published. */
export const OctopodManagedStopInstanceSchema = z.object({
  pid: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  startedAtMs: z.number().finite().nonnegative().nullable(),
  /** Linux only, copied from the lock; older clients omit it and older slots drop it. */
  linuxStartTicks: z.string().regex(/^\d+$/).max(32).optional().catch(undefined),
  bootId: z.string().min(1).max(255).optional().catch(undefined),
  nonce: z.string().min(1).max(255),
  lockPath: z.string().min(1).max(4096)
})

// Older slots drop newer optional request fields rather than refuse the stop.
export const OctopodManagedStopRequestSchema = z.object({
  schemaVersion: z.literal(1),
  transactionId: z.uuid(),
  version: z.string().min(1).max(255),
  runtimeId: z.string().min(1).max(255),
  instance: OctopodManagedStopInstanceSchema,
  /** Best effort: also retire the terminal daemon if it is provably idle. Never blocks the stop. */
  retireIdleDaemon: z.literal(true).optional()
})

export type OctopodManagedStopInstance = z.infer<typeof OctopodManagedStopInstanceSchema>
export type OctopodManagedStopRequest = z.infer<typeof OctopodManagedStopRequestSchema>

/** Equality key for a request; omits the incarnation, which an older client recovering it drops. */
export function octopodManagedStopRequestKey(request: OctopodManagedStopRequest): string {
  const { instance, ...rest } = OctopodManagedStopRequestSchema.parse(request)
  const { linuxStartTicks: _ticks, bootId: _bootId, ...bound } = instance
  return JSON.stringify({ ...rest, instance: bound })
}
/** What a stopping octopod must match before a managed request may stop it. */
export type OctopodManagedStopContext = Omit<
  OctopodManagedStopRequest,
  'schemaVersion' | 'transactionId'
>

const STOP_VERDICTS = ['live', 'unverifiable', 'exited'] as const
const RETIREMENT_VERDICTS = ['retired', 'live', 'unverifiable'] as const

/** The execution host's verdict; `exited` only on proof, never on silence. */
export const OctopodManagedStopVerdictSchema = z.enum(STOP_VERDICTS)

/** `retired` only when the daemon accepted; a busy daemon stays up and keeps its terminals. */
export const OctopodDaemonRetirementVerdictSchema = z.enum(RETIREMENT_VERDICTS)

// Read by clients older than the slot that printed them: unknown fields and arms degrade.
const stopReplyRequestFields = OctopodManagedStopRequestSchema.shape

export const OctopodManagedStopCompletionSchema = z.object({
  ...stopReplyRequestFields,
  kind: z.literal('octopod_managed_stop_completion'),
  verdict: openEnum(STOP_VERDICTS, 'unverifiable'),
  receiptPersisted: z.boolean(),
  /** For a request that asked to retire the daemon, the outcome its receipt recorded. */
  retirement: openEnum(RETIREMENT_VERDICTS, 'unverifiable').optional()
})

/** What the stopping octopod observed about its daemon, written before it exits. */
export const OctopodDaemonRetirementRecordSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal('octopod_managed_stop_retirement'),
  request: OctopodManagedStopRequestSchema,
  retirement: OctopodDaemonRetirementVerdictSchema,
  liveSessions: z.number().int().nonnegative().nullable(),
  reason: z.string().max(4096).nullable()
})

export const OctopodCompletedStopReceiptSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal('octopod_managed_stop_completed'),
  request: OctopodManagedStopRequestSchema,
  exitedAt: z.iso.datetime({ offset: true }),
  /** Present only when the request asked to retire the daemon. */
  retirement: OctopodDaemonRetirementVerdictSchema.optional()
})

export type OctopodManagedStopVerdict = z.infer<typeof OctopodManagedStopVerdictSchema>
export type OctopodManagedStopCompletion = z.infer<typeof OctopodManagedStopCompletionSchema>
export type OctopodCompletedStopReceipt = z.infer<typeof OctopodCompletedStopReceiptSchema>
export type OctopodDaemonRetirementVerdict = z.infer<typeof OctopodDaemonRetirementVerdictSchema>
export type OctopodDaemonRetirementRecord = z.infer<typeof OctopodDaemonRetirementRecordSchema>

export const OCTOPOD_CANCEL_MANAGED_STOP_FLAG = '--cancel-managed-stop'
/** Readiness `health.stopRequests`: this build consumes stop files and both commands above. */
export const OCTOPOD_STOP_REQUESTS_CAPABILITY = 1

/** Exclusive per-transaction creation ensures only octopod dispatch or client cancellation can win. */
export const OctopodManagedStopDecisionSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal('octopod_managed_stop_decision'),
  request: OctopodManagedStopRequestSchema,
  decision: z.enum(['dispatched', 'canceled'])
})

/** `dispatched` means octopod already acted on the request; the caller must await its exit. */
export const OctopodManagedStopCancellationSchema = z.object({
  ...stopReplyRequestFields,
  kind: z.literal('octopod_managed_stop_cancellation'),
  // Unknown degrades to `dispatched`: the caller then awaits exit rather than assume a cancel.
  outcome: openEnum(['canceled', 'dispatched'], 'dispatched')
})

export type OctopodManagedStopDecision = z.infer<typeof OctopodManagedStopDecisionSchema>
export type OctopodManagedStopCancellation = z.infer<typeof OctopodManagedStopCancellationSchema>
