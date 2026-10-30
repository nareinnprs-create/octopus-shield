import {
  NEURO_DEFAULT_CHAT_PATHS,
  NEURO_PROVIDER_ID_PATTERN,
  neuroProviderAuthRefFor,
  type NeuroAuthScheme,
  type NeuroConnectionTestResult,
  type NeuroProviderKind,
  type NeuroProviderProfile,
  type NeuroProviderRegistryFile
} from '../../shared/neuro-provider-types'

export type NeuroProviderFetchLike = (
  url: string,
  init: {
    method: string
    headers: Record<string, string>
    body: string
  }
) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>

export type NeuroConnectionTestContext = {
  fetchLike: NeuroProviderFetchLike
  /** Returns the decrypted key for the profile's authRef, or null. */
  readKey: () => string | null
  pingPrompt?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function asOptionalString(value: unknown): string | null {
  const text = asString(value).trim()
  return text.length > 0 ? text : null
}

const NEURO_KINDS: readonly NeuroProviderKind[] = ['cloud', 'serverless', 'local']
const NEURO_AUTH_SCHEMES: readonly NeuroAuthScheme[] = [
  'none',
  'bearer',
  'header',
  'query',
  'basic'
]

function sanitizeModels(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value
    .map(asString)
    .map((model) => model.trim())
    .filter((model) => model.length > 0)
    .slice(0, 256)
}

/** Defensive parse for registry JSON and IPC payloads; returns null when unusable. */
export function sanitizeNeuroProviderProfile(input: unknown): NeuroProviderProfile | null {
  if (!isRecord(input)) {
    return null
  }
  const id = asString(input.id).trim()
  const baseUrl = asString(input.baseUrl).trim()
  const kind = NEURO_KINDS.includes(input.kind as NeuroProviderKind)
    ? (input.kind as NeuroProviderKind)
    : null
  const authScheme = NEURO_AUTH_SCHEMES.includes(input.authScheme as NeuroAuthScheme)
    ? (input.authScheme as NeuroAuthScheme)
    : null
  if (!NEURO_PROVIDER_ID_PATTERN.test(id) || kind === null || authScheme === null) {
    return null
  }
  let parsedBaseUrl: URL
  try {
    parsedBaseUrl = new URL(baseUrl)
  } catch {
    return null
  }
  if (parsedBaseUrl.protocol !== 'http:' && parsedBaseUrl.protocol !== 'https:') {
    return null
  }
  const needsLocation = authScheme === 'header' || authScheme === 'query'
  return {
    id,
    name: asOptionalString(input.name) ?? id,
    kind,
    baseUrl: `${parsedBaseUrl.protocol}//${parsedBaseUrl.host}${parsedBaseUrl.pathname.replace(/\/$/, '')}`,
    chatPath: asOptionalString(input.chatPath) ?? NEURO_DEFAULT_CHAT_PATHS[kind],
    authScheme,
    authLocation: needsLocation
      ? (asOptionalString(input.authLocation) ?? (authScheme === 'header' ? 'x-api-key' : 'key'))
      : null,
    authRef:
      asOptionalString(input.authRef) ??
      (authScheme === 'none' ? null : neuroProviderAuthRefFor(id)),
    models: sanitizeModels(input.models),
    responsePath: asOptionalString(input.responsePath) ?? 'choices.0.message.content',
    requestTemplate: asOptionalString(input.requestTemplate)
  }
}

export function sanitizeNeuroProviderRegistryFile(input: unknown): NeuroProviderRegistryFile {
  if (!isRecord(input) || input.version !== 1 || !Array.isArray(input.profiles)) {
    return { version: 1, profiles: [] }
  }
  const byId = new Map<string, NeuroProviderProfile>()
  for (const entry of input.profiles) {
    const profile = sanitizeNeuroProviderProfile(entry)
    // Later duplicates win; the file is user-editable so tolerate and dedupe.
    if (profile !== null) {
      byId.set(profile.id, profile)
    }
  }
  return { version: 1, profiles: [...byId.values()] }
}

function readDotPath(value: unknown, path: string): unknown {
  return path
    .split('.')
    .filter((segment) => segment.length > 0)
    .reduce<unknown>(
      (current, segment) => (isRecord(current) ? current[segment] : undefined),
      value
    )
}

function firstText(value: unknown): string | null {
  if (typeof value === 'string') {
    return value
  }
  if (isRecord(value)) {
    for (const child of Object.values(value)) {
      const text = firstText(child)
      if (text !== null) {
        return text
      }
    }
  }
  if (Array.isArray(value)) {
    for (const child of value) {
      const text = firstText(child)
      if (text !== null) {
        return text
      }
    }
  }
  return null
}

function buildAuthHeaders(
  profile: NeuroProviderProfile,
  key: string | null
): Record<string, string> {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (key === null || key.length === 0 || profile.authScheme === 'none') {
    return headers
  }
  if (profile.authScheme === 'bearer') {
    headers.authorization = `Bearer ${key}`
  } else if (profile.authScheme === 'header') {
    headers[profile.authLocation ?? 'x-api-key'] = key
  } else if (profile.authScheme === 'basic') {
    headers.authorization = `Basic ${Buffer.from(key, 'utf8').toString('base64')}`
  }
  return headers
}

function buildTestUrl(profile: NeuroProviderProfile, key: string | null): string {
  const url = new URL(`${profile.baseUrl}${profile.chatPath}`)
  if (profile.authScheme === 'query' && key !== null && key.length > 0) {
    url.searchParams.set(profile.authLocation ?? 'key', key)
  }
  return url.toString()
}

function buildTestBody(profile: NeuroProviderProfile, pingPrompt: string): string {
  const model = profile.models[0]
  if (profile.requestTemplate !== null) {
    const filled = profile.requestTemplate
      .replaceAll('{{model}}', model ?? '')
      .replaceAll('{{prompt}}', pingPrompt)
    try {
      JSON.parse(filled)
      return filled
    } catch {
      // Fall through to the default body on an unusable template.
    }
  }
  return JSON.stringify({
    model,
    messages: [{ role: 'user', content: pingPrompt }],
    stream: false
  })
}

/** One completion per profile; auth/key/template handling shared by all kinds. */
export async function testNeuroProviderConnection(
  profile: NeuroProviderProfile,
  context: NeuroConnectionTestContext
): Promise<NeuroConnectionTestResult> {
  const startedAt = Date.now()
  const key = profile.authScheme === 'none' ? null : context.readKey()
  if (profile.authScheme !== 'none' && (key === null || key.length === 0)) {
    return { ok: false, detail: 'No API key saved for this profile', latencyMs: null }
  }
  let outcome: { response: { ok: boolean; status: number }; text: string }
  try {
    const response = await context.fetchLike(buildTestUrl(profile, key), {
      method: 'POST',
      headers: buildAuthHeaders(profile, key),
      body: buildTestBody(profile, context.pingPrompt ?? 'ping')
    })
    outcome = { response, text: await response.text() }
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
      latencyMs: Date.now() - startedAt
    }
  }
  const latencyMs = Date.now() - startedAt
  if (!outcome.response.ok) {
    const snippet = outcome.text.slice(0, 300)
    return {
      ok: false,
      detail: `HTTP ${outcome.response.status}${snippet.length > 0 ? `: ${snippet}` : ''}`,
      latencyMs
    }
  }
  try {
    const payload: unknown = JSON.parse(outcome.text)
    const text =
      firstText(
        profile.responsePath === null ? payload : readDotPath(payload, profile.responsePath)
      ) ?? firstText(payload)
    if (text === null) {
      return { ok: true, detail: 'Reached endpoint (no completion text found)', latencyMs }
    }
    return { ok: true, detail: text.slice(0, 300), latencyMs }
  } catch {
    return { ok: false, detail: 'Endpoint returned non-JSON payload', latencyMs }
  }
}
