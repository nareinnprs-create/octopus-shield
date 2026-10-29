import { lstatSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { z } from 'zod'
import { readNodeFileSyncWithinLimit } from '../../shared/node-bounded-file-reader'
import { writeDurableSecureJsonFile } from '../../shared/secure-file'
import { hasErrorCode } from '../daemon/daemon-process-inspection'
import {
  OCTOPOD_STOP_RECEIPTS_DIRNAME,
  OctopodCompletedStopReceiptSchema,
  OctopodManagedStopRequestSchema,
  OctopodDaemonRetirementRecordSchema,
  octopodManagedStopRequestKey,
  type OctopodCompletedStopReceipt,
  type OctopodDaemonRetirementRecord,
  type OctopodManagedStopRequest
} from '../../shared/octopod-stop-request'

const RECEIPT_MAX_BYTES = 64 * 1024

type ReceiptKind = 'completed' | 'retirement' | 'decision'

export function octopodStopReceiptPath(request: OctopodManagedStopRequest, kind: ReceiptKind): string {
  const { transactionId, instance } = OctopodManagedStopRequestSchema.parse(request)
  const suffix = kind === 'completed' ? '' : `.${kind}`
  return join(
    dirname(instance.lockPath),
    OCTOPOD_STOP_RECEIPTS_DIRNAME,
    `${transactionId}${suffix}.json`
  )
}

/** Absent returns null; mismatched request receipts throw. */
export function readOctopodStopReceipt<T extends { request: OctopodManagedStopRequest }>(
  request: OctopodManagedStopRequest,
  kind: ReceiptKind,
  schema: z.ZodType<T>
): T | null {
  const path = octopodStopReceiptPath(request, kind)
  try {
    if (!lstatSync(path).isFile()) {
      throw new Error('octopod_stop_receipt_unverifiable')
    }
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) {
      return null
    }
    throw error
  }
  const receipt = schema.parse(
    JSON.parse(readNodeFileSyncWithinLimit(path, RECEIPT_MAX_BYTES).buffer.toString('utf8'))
  )
  if (octopodManagedStopRequestKey(receipt.request) !== octopodManagedStopRequestKey(request)) {
    throw new Error('octopod_stop_receipt_mismatch')
  }
  return receipt
}

function writeReceipt(request: OctopodManagedStopRequest, kind: ReceiptKind, receipt: unknown): void {
  if (!writeDurableSecureJsonFile(octopodStopReceiptPath(request, kind), receipt)) {
    throw new Error('octopod_stop_receipt_permissions_unconfirmed')
  }
}

export function readOctopodCompletedStopReceipt(
  request: OctopodManagedStopRequest
): OctopodCompletedStopReceipt | null {
  return readOctopodStopReceipt(request, 'completed', OctopodCompletedStopReceiptSchema)
}

/** Persist only after proven exit and fsync even existing receipts.
 * Missing retirement records remain unverifiable. */
export function persistOctopodCompletedStopReceipt(
  request: OctopodManagedStopRequest,
  exitedAt: Date
): OctopodCompletedStopReceipt {
  const parsed = OctopodManagedStopRequestSchema.parse(request)
  const retirement = parsed.retireIdleDaemon
    ? (readOctopodDaemonRetirementRecord(parsed)?.retirement ?? 'unverifiable')
    : undefined
  const receipt = readOctopodCompletedStopReceipt(parsed) ?? {
    schemaVersion: 1 as const,
    kind: 'octopod_managed_stop_completed' as const,
    request: parsed,
    exitedAt: exitedAt.toISOString(),
    ...(retirement ? { retirement } : {})
  }
  writeReceipt(parsed, 'completed', receipt)
  return receipt
}

export function readOctopodDaemonRetirementRecord(
  request: OctopodManagedStopRequest
): OctopodDaemonRetirementRecord | null {
  return readOctopodStopReceipt(request, 'retirement', OctopodDaemonRetirementRecordSchema)
}

export function persistOctopodDaemonRetirementRecord(
  request: OctopodManagedStopRequest,
  outcome: Pick<OctopodDaemonRetirementRecord, 'retirement' | 'liveSessions' | 'reason'>
): void {
  writeReceipt(request, 'retirement', {
    schemaVersion: 1,
    kind: 'octopod_managed_stop_retirement',
    request: OctopodManagedStopRequestSchema.parse(request),
    // Name fields explicitly; extra in-process fields would fail the strict schema.
    retirement: outcome.retirement,
    liveSessions: outcome.liveSessions,
    reason: outcome.reason
  })
}
