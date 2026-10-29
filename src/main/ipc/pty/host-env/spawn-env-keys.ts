import { OSHIELD_AGENT_SESSION_ID_ENV } from '../../../../shared/agent-session-caller-env'
import { OSHIELD_STRUCTURED_SESSION_ENV } from '../../../../shared/structured-session-marker'

export const AGENT_HOOK_RUNTIME_ENV_KEYS = [
  'OSHIELD_AGENT_HOOK_PORT',
  'OSHIELD_AGENT_HOOK_TOKEN',
  'OSHIELD_AGENT_HOOK_ENV',
  'OSHIELD_AGENT_HOOK_VERSION',
  'OSHIELD_AGENT_HOOK_TRANSPORT',
  'OSHIELD_AGENT_HOOK_ENDPOINT',
  // Remove the reverted inherited path still present in older PTYs (#2778).
  'OSHIELD_CLAUDE_AGENT_STATUS_SETTINGS'
] as const

// Inherited Claude child stamps make an independent pane act as the launching session's child.
export const CLAUDE_CHILD_SESSION_STAMP_ENV_KEYS = [
  'CLAUDECODE',
  'CLAUDE_CODE_CHILD_SESSION',
  'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_CODE_BRIDGE_SESSION_ID',
  'CLAUDE_CODE_EXECPATH',
  'CLAUDE_CODE_ENTRYPOINT'
] as const

// Inherited structured-session IDs would make every pane claim the parent orchestration caller.
export const OSHIELD_AGENT_SESSION_CALLER_ENV_KEYS = [
  OSHIELD_AGENT_SESSION_ID_ENV,
  OSHIELD_STRUCTURED_SESSION_ENV
] as const
