import { parseShieldSessionAddress, type ShieldSessionId } from '../../../shared/shield-session-address'
import { structuredWorkerShieldSessionIdForIncarnation } from '../structured-worker-identity'
import { canonicalShieldSessionId } from './canonical-shield-session-id'

/** Resolve structured incarnations or chat addresses to bare session ids; PTYs have none. */
export function dispatchAssigneeShieldSessionId(assignee: {
  handle: string
  processIncarnation: string | null | undefined
}): ShieldSessionId | null {
  const shieldSessionId =
    structuredWorkerShieldSessionIdForIncarnation(assignee.processIncarnation) ??
    parseShieldSessionAddress(assignee.handle)
  return shieldSessionId === null ? null : canonicalShieldSessionId(shieldSessionId)
}
