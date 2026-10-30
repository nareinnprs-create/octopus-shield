export type NeuroProviderKind = 'cloud' | 'serverless' | 'local'

export type NeuroAuthScheme = 'none' | 'bearer' | 'header' | 'query' | 'basic'

/**
 * A user-managed LLM endpoint profile. Secrets never live here: `authRef`
 * names the encrypted key envelope inside the Shield credential vault.
 */
export type NeuroProviderProfile = {
  id: string
  name: string
  kind: NeuroProviderKind
  baseUrl: string
  /** Chat completions path appended to baseUrl; defaults per kind. */
  chatPath: string
  authScheme: NeuroAuthScheme
  /** Header name for `header`, query param for `query`. */
  authLocation: string | null
  /** Credential vault reference; key material is stored encrypted at rest. */
  authRef: string | null
  models: string[]
  /** Response JSON path to the completion text, e.g. `choices.0.message.content`. */
  responsePath: string | null
  /**
   * Request body template with `{{model}}` and `{{prompt}}` placeholders
   * (JSON). Unset uses the OpenAI-style chat body understood by all
   * OpenAI-compatible and Ollama endpoints.
   */
  requestTemplate: string | null
}

export type NeuroProviderRegistryFile = {
  version: 1
  profiles: NeuroProviderProfile[]
}

export type NeuroConnectionTestResult = {
  ok: boolean
  /** HTTP status, transport error, or the extracted completion snippet. */
  detail: string
  latencyMs: number | null
}

/** Profile projection safe to cross IPC; reports key presence without the key. */
export type NeuroProviderStatus = {
  profiles: NeuroProviderProfile[]
  keyConfigured: Record<string, boolean>
  keyProtection: Record<string, 'sealed' | 'plaintext' | null>
}

export const NEURO_PROVIDER_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/

export function neuroProviderAuthRefFor(id: string): string {
  return `neuro-${id}`
}

export const NEURO_DEFAULT_CHAT_PATHS: Record<NeuroProviderKind, string> = {
  cloud: '/v1/chat/completions',
  serverless: '/v1/chat/completions',
  local: '/api/chat'
}

/** Editor starting points; they are not persisted until the user saves. */
export const NEURO_BUILTIN_PROFILES: NeuroProviderProfile[] = [
  {
    id: 'ollama',
    name: 'Ollama (local)',
    kind: 'local',
    baseUrl: 'http://localhost:11434',
    chatPath: '/api/chat',
    authScheme: 'none',
    authLocation: null,
    authRef: null,
    models: [],
    responsePath: 'message.content',
    requestTemplate: null
  },
  {
    id: 'openai-compatible',
    name: 'OpenAI-compatible',
    kind: 'cloud',
    baseUrl: 'https://api.openai.com',
    chatPath: '/v1/chat/completions',
    authScheme: 'bearer',
    authLocation: null,
    authRef: null,
    models: [],
    responsePath: 'choices.0.message.content',
    requestTemplate: null
  }
]
