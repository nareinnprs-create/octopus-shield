// Arakan Console (batch B6): renderer chat surface over `arakan acp` (JSON-RPC, newline-delimited).

export type ArakanConsoleOpenRequest = {
  /** Workspace cwd the agent operates in. */
  cwd: string
}

export type ArakanConsoleOpenResult =
  | { ok: true; sessionId: string; backendVersion: string | null }
  | { ok: false; reason: string }

export type ArakanConsolePromptRequest = { text: string }
export type ArakanConsolePromptResult = { ok: boolean; reason?: string }

export type ArakanConsolePermissionOption = {
  optionId: string
  kind: string
  name?: string
}

export type ArakanConsolePermissionRequest = {
  requestId: number | string
  toolCallTitle?: string
  kind?: string
  options: readonly ArakanConsolePermissionOption[]
}

/** One streamed console event; raw keeps the full ACP payload for forward-compat. */
export type ArakanConsoleEvent =
  | { kind: 'agent-message'; text: string; raw: unknown }
  | { kind: 'tool-call'; toolCallId: string; title: string; status?: string; raw: unknown }
  | {
      kind: 'tool-call-update'
      toolCallId: string
      title?: string
      status?: string
      output?: string
      raw: unknown
    }
  | { kind: 'permission-request'; request: ArakanConsolePermissionRequest }
  | { kind: 'turn-complete'; raw: unknown }
  | { kind: 'notice'; text: string }
  | { kind: 'exited'; code: number | null; reason: string }

export type ArakanConsolePermissionResponse = {
  requestId: number | string
  /** Selected option id from the request's options list. */
  optionId: string
}

export type ArakanConsoleApi = {
  open: (request: ArakanConsoleOpenRequest) => Promise<ArakanConsoleOpenResult>
  prompt: (request: ArakanConsolePromptRequest) => Promise<ArakanConsolePromptResult>
  respondPermission: (response: ArakanConsolePermissionResponse) => Promise<{ ok: boolean }>
  close: () => Promise<{ ok: boolean }>
  onEvent: (listener: (event: ArakanConsoleEvent) => void) => () => void
}
