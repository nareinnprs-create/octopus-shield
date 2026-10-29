import { rmSync } from 'node:fs'
import type {
  OctopodManagedStopCancellation,
  OctopodManagedStopRequest
} from '../../shared/octopod-stop-request'
import { claimOctopodManagedStopDecision } from './octopod-managed-stop-decision'
import {
  octopodManagedStopRequestPath,
  readOctopodManagedStopRequest
} from './octopod-managed-stop-request'

/** Dispatched stops cannot be canceled; their completion verdict remains authoritative. */
export function cancelOctopodManagedStop(
  request: OctopodManagedStopRequest
): OctopodManagedStopCancellation['outcome'] {
  const outcome = claimOctopodManagedStopDecision(request, 'canceled')
  if (outcome === 'canceled') {
    withdrawOctopodManagedStopRequest(request)
  }
  return outcome
}

export function withdrawOctopodManagedStopRequest(request: OctopodManagedStopRequest): void {
  const path = octopodManagedStopRequestPath(request.instance)
  try {
    if (readOctopodManagedStopRequest(path).transactionId === request.transactionId) {
      rmSync(path, { force: true })
    }
  } catch {
    // The persisted decision fences this transaction even if its request is gone.
  }
}
