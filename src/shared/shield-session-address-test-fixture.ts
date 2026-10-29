import { isShieldSessionId, type ShieldSessionId } from './shield-session-address'

/** A literal Shield session id for a test, checked by the same predicate production uses. */
export function testShieldSessionId(id: string): ShieldSessionId {
  if (!isShieldSessionId(id)) {
    throw new Error(`Not an Shield session id: ${id}`)
  }
  return id
}
