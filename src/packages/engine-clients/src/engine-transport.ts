export type ShieldRequestInit = {
  method?: string
  headers?: Readonly<Record<string, string>>
  body?: string
  signal?: AbortSignal
}

export type ShieldResponseLike = {
  readonly status: number
  readonly ok: boolean
  json: () => Promise<unknown>
  text: () => Promise<string>
}

export type ShieldFetchLike = (
  input: string,
  init?: ShieldRequestInit
) => Promise<ShieldResponseLike>

export type ShieldEngineClientConfig = {
  baseUrl: string
  fetchLike: ShieldFetchLike
}

export type ShieldEngineRequest = {
  method: string
  path: string
  headers?: Readonly<Record<string, string>>
  body?: string
  signal?: AbortSignal
}

export class EngineTransportError extends Error {
  readonly status: number
  readonly body: string

  constructor(engineName: string, status: number, body: string) {
    // 401/403 challenge bodies can echo credential material; only the status is surfaced.
    const redacted = status === 401 || status === 403
    super(`${engineName} request failed (${status}): ${redacted ? '[redacted]' : body.slice(0, 512)}`)
    this.name = 'EngineTransportError'
    this.status = status
    this.body = redacted ? '[redacted]' : body
  }
}

export function engineUrl(baseUrl: string, path: string): string {
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
  const baseOrigin = new URL(base).origin
  const resolved = new URL(path, base)
  // Origin pinning: a caller-supplied path must never retarget the request
  // (//host, absolute URL, or scheme change would escape the engine origin).
  if (resolved.origin !== baseOrigin) {
    throw new RangeError(`engine request path escapes the configured engine origin: ${path}`)
  }
  return resolved.toString()
}

async function rejectNonOk(
  engineName: string,
  response: ShieldResponseLike
): Promise<ShieldResponseLike> {
  if (!response.ok) {
    throw new EngineTransportError(engineName, response.status, await response.text())
  }
  return response
}

export function engineRequest(
  engineName: string,
  config: ShieldEngineClientConfig,
  request: ShieldEngineRequest
): Promise<ShieldResponseLike> {
  const promise = config.fetchLike(engineUrl(config.baseUrl, request.path), {
    method: request.method,
    headers: request.headers,
    body: request.body,
    signal: request.signal
  })
  return promise.then((response) => rejectNonOk(engineName, response))
}

export async function engineJson<T>(response: ShieldResponseLike): Promise<T> {
  // SAFETY: typed call sites encode only routes whose response schemas were read
  // from engine sources (citations at each call site and in caldera-routes.ts /
  // mythic-operations.ts); unverified shapes are returned as unknown instead.
  return (await response.json()) as T
}
