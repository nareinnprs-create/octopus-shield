import type { AgentSessionConversationView } from '../../../../../shared/agent-session-conversation-view'
import {
  formatShieldSessionAddress,
  type ShieldSessionId
} from '../../../../../shared/shield-session-address'
import { ORCHESTRATION_SESSION_CALLER_ERROR_CODES as CODES } from '../../../../../shared/orchestration-session-caller-codes'
import type { ShieldRuntimeService } from '../../../shield-runtime'
import type { WorkerStartModeReceipt } from '../orchestration-worker-start-mode'
import { observeChatAssignee } from '../../../orchestration/chat-assignee'
import type { OrchestrationDb } from '../../../orchestration/db'
import { OrchestrationError } from '../../../orchestration/orchestration-error'
import type { OrchestrationParty } from '../../../orchestration/orchestration-party'
import { readAgentSessionRecordStore } from '../../../orchestration/structured-session-lineage'
import { refuseUndeliverableSessionRecipient } from './messaging/session-recipient'

const NO_EFFECTS = 'No effects were applied.'

/** A chat has no pane or process; its Dispatch names it by its Shield session ID alone. */
export const CHAT_WORKER_AUTHORITY = { paneKey: null, processIncarnation: null } as const

/** The chat a Dispatch assignee party names; null for a terminal or a structured worker. */
export function chatAssigneeOf(party: OrchestrationParty): ShieldSessionId | null {
  return party.terminalHandle === null ? party.shieldSessionId : null
}

/** Use the same reach rules as mail before creating anything; return the assignee's currently running session. */
export async function admitChatAssignee(
  runtime: Pick<ShieldRuntimeService, 'ensureStructuredAgentSessionHost'>,
  sessionId: ShieldSessionId,
  db: OrchestrationDb
): Promise<AgentSessionConversationView> {
  // A failed install leaves no store, which the refusal below names.
  await runtime.ensureStructuredAgentSessionHost().catch(() => undefined)
  const store = readAgentSessionRecordStore()
  const refusal = refuseUndeliverableSessionRecipient(
    { sessionId, address: formatShieldSessionAddress(sessionId) },
    store,
    db,
    NO_EFFECTS
  )
  if (refusal) {
    throw new OrchestrationError(refusal.code, refusal.message, { effectsApplied: false })
  }
  const observed = observeChatAssignee(sessionId, db, store)
  if (observed.status !== 'live') {
    throw new OrchestrationError(
      CODES.notLive,
      `Agent session ${sessionId} cannot take a task here: ${observed.reason} ${NO_EFFECTS}`,
      { effectsApplied: false }
    )
  }
  return observed.session
}

/** A coordinator can't be its own worker: it would answer its own task forever. */
export function refuseChatSelfAssignment(args: {
  sessionId: ShieldSessionId
  coordinatorSessionId: ShieldSessionId | null | undefined
  remedy: string
}): void {
  if (args.sessionId === args.coordinatorSessionId) {
    throw new OrchestrationError(
      'terminal_is_coordinator',
      `${formatShieldSessionAddress(args.sessionId)} is this coordinator's own Shield session ID. ${args.remedy}`
    )
  }
}

/** A chat adopted as a worker is given the task, not launched; the decided mode stands. */
export function chatWorkerMode(
  mode: WorkerStartModeReceipt,
  chat: ShieldSessionId | null
): WorkerStartModeReceipt {
  return chat
    ? {
        ...mode,
        detail: `--terminal names the chat ${formatShieldSessionAddress(chat)}; its task goes to that chat and no agent is launched.`
      }
    : mode
}
