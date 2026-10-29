// Consume clean idle-stop evidence once; discard failed stops so later crashes cannot inherit it.
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { readNodeFileSyncWithinLimit } from '../../shared/node-bounded-file-reader'
import { writeDurableSecureJsonFile } from '../../shared/secure-file'
import {
  OCTOPOD_IDLE_STOP_RECORD_FILENAME,
  OctopodIdleStopRecordSchema,
  type OctopodIdleStopRecord
} from '../../shared/octopod-idle-exit'
import type { OctopodIdleExitEvidence } from './octopod-idle-exit-monitor'
import { hasErrorCode } from '../daemon/daemon-process-inspection'

const RECORD_MAX_BYTES = 16 * 1024

export function octopodIdleStopRecordPath(userDataPath: string): string {
  return join(userDataPath, OCTOPOD_IDLE_STOP_RECORD_FILENAME)
}

export function writeOctopodIdleStopRecord(
  userDataPath: string,
  evidence: OctopodIdleExitEvidence,
  version: string
): void {
  const record: OctopodIdleStopRecord = {
    schemaVersion: 1,
    kind: 'octopod_idle_stop',
    pid: process.pid,
    version,
    quietSince: new Date(evidence.quietSince).toISOString(),
    stoppedAt: new Date(evidence.stoppedAt).toISOString(),
    idleTimeoutMs: evidence.timeoutMs
  }
  if (!writeDurableSecureJsonFile(octopodIdleStopRecordPath(userDataPath), record)) {
    throw new Error('octopod_idle_stop_record_permissions_unconfirmed')
  }
}

export function consumeOctopodIdleStopRecord(userDataPath: string): OctopodIdleStopRecord | null {
  const path = octopodIdleStopRecordPath(userDataPath)
  let record: OctopodIdleStopRecord | null = null
  try {
    const raw = readNodeFileSyncWithinLimit(path, RECORD_MAX_BYTES).buffer.toString('utf8')
    record = OctopodIdleStopRecordSchema.parse(JSON.parse(raw))
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) {
      return null
    }
    console.error('[octopod] ignoring an unreadable idle-stop record:', error)
  }
  rmSync(path, { force: true })
  return record
}

export function discardOctopodIdleStopRecord(userDataPath: string): void {
  rmSync(octopodIdleStopRecordPath(userDataPath), { force: true })
}
