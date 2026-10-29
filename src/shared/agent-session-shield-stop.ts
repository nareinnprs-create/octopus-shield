// The host records quit/update/crash on the cut-turn row for Continue. Unknown wire causes retain the row's words without a named cause.

export const AGENT_SESSION_OSHIELD_STOP_CAUSES = ['update', 'quit', 'crash'] as const
/** The row's presentation, so a client that re-words host rows it can't name passes it through. */
export const AGENT_SESSION_OSHIELD_STOP_PRESENTATION = 'shield-stop'
export type AgentSessionShieldStopCause = (typeof AGENT_SESSION_OSHIELD_STOP_CAUSES)[number]
export type AgentSessionShieldStop = { cause: AgentSessionShieldStopCause }

export function isAgentSessionShieldStopCause(value: unknown): value is AgentSessionShieldStopCause {
  return AGENT_SESSION_OSHIELD_STOP_CAUSES.some((cause) => cause === value)
}

/** The stop a row states, when this build knows its cause. */
export function readAgentSessionShieldStop(value: unknown): AgentSessionShieldStop | undefined {
  const cause =
    typeof value === 'object' && value !== null && 'cause' in value ? value.cause : undefined
  return isAgentSessionShieldStopCause(cause) ? { cause } : undefined
}
