// Exclusive hard links arbitrate stop versus cancel; cancel cannot succeed once dispatch wins.
import { linkSync, rmSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { writeDurableSecureJsonFile } from '../../shared/secure-file'
import {
  OctopodManagedStopDecisionSchema,
  OctopodManagedStopRequestSchema,
  type OctopodManagedStopDecision,
  type OctopodManagedStopRequest
} from '../../shared/octopod-stop-request'
import { octopodStopReceiptPath, readOctopodStopReceipt } from './octopod-completed-stop-receipt'
import { hasErrorCode } from '../daemon/daemon-process-inspection'

type OctopodManagedStopDecisionValue = OctopodManagedStopDecision['decision']

export function readOctopodManagedStopDecision(
  request: OctopodManagedStopRequest
): OctopodManagedStopDecisionValue | null {
  return readOctopodStopReceipt(request, 'decision', OctopodManagedStopDecisionSchema)?.decision ?? null
}

export function claimOctopodManagedStopDecision(
  input: OctopodManagedStopRequest,
  decision: OctopodManagedStopDecisionValue
): OctopodManagedStopDecisionValue {
  const request = OctopodManagedStopRequestSchema.parse(input)
  const path = octopodStopReceiptPath(request, 'decision')
  const staged = `${path}.${process.pid}.${randomUUID()}.staged`
  const record: OctopodManagedStopDecision = {
    schemaVersion: 1,
    kind: 'octopod_managed_stop_decision',
    request,
    decision
  }
  if (!writeDurableSecureJsonFile(staged, record)) {
    rmSync(staged, { force: true })
    throw new Error('octopod_managed_stop_decision_permissions_unconfirmed')
  }
  try {
    linkSync(staged, path)
    return decision
  } catch (error) {
    if (!hasErrorCode(error, 'EEXIST')) {
      throw error
    }
    const standing = readOctopodManagedStopDecision(request)
    if (!standing) {
      throw new Error('octopod_managed_stop_decision_unverifiable')
    }
    return standing
  } finally {
    rmSync(staged, { force: true })
  }
}
