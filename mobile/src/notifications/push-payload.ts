// APNs nests custom fields under shield; FCM data is flat/string-valued. Read both and coerce numeric fields.
export type ShieldPushPayload = {
  readonly kind?: 'alert' | 'dismiss'
  readonly hostFingerprint: string
  readonly notificationId?: string
  readonly notificationSeq?: number
  readonly notificationEpoch?: string
  readonly paneKey?: string
  readonly worktreeId?: string
  readonly executionHost?: string
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function readSeq(value: unknown): number | undefined {
  const raw = typeof value === 'number' ? value : Number(readString(value))
  return Number.isFinite(raw) ? raw : undefined
}

export function readShieldPushPayload(data: unknown): ShieldPushPayload | null {
  if (!data || typeof data !== 'object') {
    return null
  }
  const nested = (data as { shield?: unknown }).shield
  const record = (nested && typeof nested === 'object' ? nested : data) as Record<string, unknown>
  // Only gateway pushes carry a fingerprint; locally scheduled data does not.
  const hostFingerprint = readString(record.hostFingerprint)
  if (!hostFingerprint) {
    return null
  }
  return {
    hostFingerprint,
    ...(record.kind === 'dismiss' || record.kind === 'alert' ? { kind: record.kind } : {}),
    notificationId: readString(record.notificationId),
    notificationSeq: readSeq(record.notificationSeq),
    notificationEpoch: readString(record.notificationEpoch),
    paneKey: readString(record.paneKey),
    worktreeId: readString(record.worktreeId),
    executionHost: readString(record.executionHost)
  }
}
