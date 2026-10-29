/**
 * A structured agent session as a mail address: `shield_session_id:<id>`, the Shield-minted id every agent is
 * told is its public address. Recipient routing and pointer delivery both read these rules off the
 * durable session record, so the two can never disagree about which sessions mail can reach.
 *
 * The address names a conversation, not one session of it: any session of a `/clear` lineage names
 * the lineage root's address (`canonicalShieldSessionId`), and mail reaches the lineage's live session.
 *
 * A released lease does not end a session: the host stops an idle chat's agent, and the send that
 * points its mail starts it again. For mail, a conversation has ended only when its chat was closed.
 */

import type { AgentSessionConversationView } from '../../../shared/agent-session-conversation-view'
import { isShieldSessionId, type ShieldSessionId } from '../../../shared/shield-session-address'
import { ORCHESTRATION_SESSION_CALLER_ERROR_CODES as CODES } from '../../../shared/orchestration-session-caller-codes'
import type { OrchestrationDb } from './db'
import { OrchestrationError } from './orchestration-error'
import { resolveShieldSessionParty, type OrchestrationSessionParty } from './orchestration-party'
import {
  resolveLineageRunningSession,
  type AgentSessionRecordReader
} from './structured-session-lineage'

export type ShieldAgentSessionLookup =
  | { kind: 'found'; record: AgentSessionConversationView }
  /** The id is a provider's own session id, which rotates on `/clear`; this names the Shield id. */
  | { kind: 'provider-id'; shieldSessionId: string }
  | { kind: 'unknown' }

export function lookupShieldAgentSession(
  store: AgentSessionRecordReader,
  id: string
): ShieldAgentSessionLookup {
  const record = store.getRecord(id)
  if (record) {
    return { kind: 'found', record }
  }
  const owner = store
    .listRecords()
    .find((candidate) => candidate.providerHandleChain.some(({ handle }) => handle.nativeId === id))
  return owner ? { kind: 'provider-id', shieldSessionId: owner.sessionId } : { kind: 'unknown' }
}

export type StructuredSessionMailReach =
  /** `session` is the conversation's live session, the one its mail reaches now. */
  | { kind: 'reachable'; session: AgentSessionConversationView }
  | { kind: 'other-host' }
  /** The lineage names a session with no record, or loops: not being able to look, not an end. */
  | { kind: 'unverifiable'; reason: string }
  | { kind: 'ended'; reason: 'closed' | 'worker-identity-lost' }

/** Whether mail to `record`'s conversation can reach the session that runs it now. */
export function structuredSessionMailReach(
  store: AgentSessionRecordReader,
  record: AgentSessionConversationView,
  db: OrchestrationDb | null | undefined,
  canonicalStore?: Pick<AgentSessionRecordReader, 'listRecords'> | null
): StructuredSessionMailReach {
  const running = resolveLineageRunningSession(store, record.sessionId)
  if (running.kind === 'unverifiable') {
    return { kind: 'unverifiable', reason: running.reason }
  }
  if (running.kind === 'other-host') {
    return { kind: 'other-host' }
  }
  const live = running.record
  if (
    isShieldSessionId(live.sessionId) &&
    !addressableSessionParty(live.sessionId, db, canonicalStore)
  ) {
    // Lost worker identity cannot act through the caller resolver and therefore cannot read mail.
    return { kind: 'ended', reason: 'worker-identity-lost' }
  }
  const visible = store.getVisibleSessionTabIndex?.()
  if (visible?.present && !visible.sessionIds.includes(live.sessionId)) {
    // Do not revive closed chats into invisible turns; their mail waits.
    return { kind: 'ended', reason: 'closed' }
  }
  return { kind: 'reachable', session: live }
}

/** Exclude only proven lost worker identity, which the party resolver refuses in every role. */
export function addressableSessionParty(
  sessionId: ShieldSessionId,
  db: OrchestrationDb | null | undefined,
  store?: Pick<AgentSessionRecordReader, 'listRecords'> | null
): OrchestrationSessionParty | null {
  try {
    return resolveShieldSessionParty(sessionId, db, store)
  } catch (error) {
    if (error instanceof OrchestrationError && error.code === CODES.notLive) {
      return null
    }
    throw error
  }
}
