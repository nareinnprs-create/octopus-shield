export const PI_PROCESS_OWNER_ENV_KEYS = [
  'OSHIELD_PI_STATUS_OWNED',
  'OSHIELD_PRIME_AGENT_STATUS_OWNED',
  'OSHIELD_PI_TITLE_MARKER_OWNED'
] as const

/** A new terminal is not a child agent in the pane that launched its host. */
export function stripPiProcessOwnerEnv(env: Record<string, string | undefined>): void {
  for (const key of PI_PROCESS_OWNER_ENV_KEYS) {
    delete env[key]
  }
}
