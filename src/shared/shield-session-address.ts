import { isAgentSessionId } from './agent-session-record'
import { STRUCTURED_WORKER_HANDLE_PREFIX } from './structured-worker-handle'
import { OSHIELD_SESSION_ADDRESS_PREFIX } from './shield-session-address-prefix'

/** Shield-minted structured session identity (record id/OSHIELD_AGENT_SESSION_ID), never provider identity. Orchestration stores bare lineage-root ids after /clear,
 * not live replacement ids; derive mail spelling shield_session_id:<id> alongside run:/dispatch: addresses.
 * Resolve execution location from records. PTYs have no id today; never use pane keys because later agents inherit panes. */
export { OSHIELD_SESSION_ADDRESS_PREFIX }

declare const shieldSessionIdBrand: unique symbol
declare const shieldSessionAddressBrand: unique symbol

/** A bare Shield session id; only `isShieldSessionId` and `parseShieldSessionAddress` produce one. */
export type ShieldSessionId = string & { readonly [shieldSessionIdBrand]: true }
/** An `shield_session_id:<id>` mail address; only `formatShieldSessionAddress` produces one. */
export type ShieldSessionAddress = string & { readonly [shieldSessionAddressBrand]: true }

// Terminal handles (term_/structworker_) share the charset but are never durable session ids.
const TERMINAL_HANDLE_PREFIXES = ['term_', STRUCTURED_WORKER_HANDLE_PREFIX] as const

export function isShieldSessionId(id: string): id is ShieldSessionId {
  return isAgentSessionId(id) && !TERMINAL_HANDLE_PREFIXES.some((prefix) => id.startsWith(prefix))
}

export function formatShieldSessionAddress(shieldSessionId: ShieldSessionId): ShieldSessionAddress {
  const address = `${OSHIELD_SESSION_ADDRESS_PREFIX}${shieldSessionId}`
  // Always true for a checked id; the check brands the address without a type assertion.
  if (!isShieldSessionAddress(address)) {
    throw new Error(`Not an Shield session id: ${shieldSessionId}`)
  }
  return address
}

/** The bare Shield session id of an `shield_session_id:<id>` address; anything else reads as null. */
export function parseShieldSessionAddress(address: string | null | undefined): ShieldSessionId | null {
  if (!address?.startsWith(OSHIELD_SESSION_ADDRESS_PREFIX)) {
    return null
  }
  const id = address.slice(OSHIELD_SESSION_ADDRESS_PREFIX.length)
  return isShieldSessionId(id) ? id : null
}

function isShieldSessionAddress(address: string): address is ShieldSessionAddress {
  return parseShieldSessionAddress(address) !== null
}
