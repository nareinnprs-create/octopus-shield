import { EngineTransportError, engineJson, engineRequest, type ShieldEngineClientConfig, type ShieldResponseLike } from './engine-transport'

export type ShieldWazuhClientConfig = ShieldEngineClientConfig & {
  username: string
  password: string
}

// POST /security/user/authenticate — wazuh spec
// /var/wazuh-manager/framework/python/lib/python3.12/site-packages/api/spec/spec.yaml:8202-8241
// (copied out of container single-node-wazuh.manager, 5.0.0-rc1; route table in
// wazuh-routes.ts cites it per row).
export const WAZUH_LOGIN_PATH = '/security/user/authenticate'

// Token expires after auth_token_exp_timeout seconds, default 900 — spec:8207-8208
// and spec:16-18. The response exposes no expiry field (Token schema is
// { token: string } only — spec:1747-1752), so the TTL is the spec default.
export const WAZUH_TOKEN_DEFAULT_TTL_SECONDS = 900

// Refresh a minute before spec-default expiry.
const TOKEN_REFRESH_MARGIN_SECONDS = 60

export const WAZUH_DEPLOYMENT_FACTS = {
  managerApiPort: 55000,
  managerTls: true,
  managerTlsCertPath: '/var/wazuh-manager/etc/certs/apid.pem',
  managerTlsKeyPath: '/var/wazuh-manager/etc/certs/apid-key.pem',
  remotedTlsCertPath: '/var/wazuh-manager/etc/certs/remoted.pem',
  rootCaPath: '/var/wazuh-manager/etc/certs/root-ca.pem',
  indexerPort: 9200,
  dashboardPort: 443
} as const

/**
 * Only the spec-verified auth flow is encoded: basicAuth login (spec:8212-8213)
 * returns a JWT (spec:8226-8233) that authenticates every other endpoint via
 * the global `security: - jwt: []` default (spec:4040-4041). Token invalidation
 * on security-config change (spec:16-18) is handled by re-login on 401.
 */
export class ShieldWazuhClient {
  readonly #config: ShieldWazuhClientConfig

  readonly #engineName = 'wazuh'

  #token: { value: string; expiresAtMs: number } | null = null

  constructor(config: ShieldWazuhClientConfig) {
    this.#config = config
  }

  // Basic-auth login; cached until shortly before the 900s default expiry.
  async login(signal?: AbortSignal): Promise<string> {
    const response = await engineRequest(this.#engineName, this.#config, {
      method: 'POST',
      path: WAZUH_LOGIN_PATH,
      headers: {
        accept: 'application/json',
        authorization: `basic ${Buffer.from(`${this.#config.username}:${this.#config.password}`, 'utf-8').toString('base64')}`
      },
      signal
    })
    const body = await engineJson<{ data?: { token?: unknown } }>(response)
    const token = body.data?.token
    if (typeof token !== 'string' || token.length === 0) {
      throw new EngineTransportError(this.#engineName, response.status, 'login response missing data.token (spec:8226-8229)')
    }
    this.#token = {
      value: token,
      expiresAtMs: Date.now() + (WAZUH_TOKEN_DEFAULT_TTL_SECONDS - TOKEN_REFRESH_MARGIN_SECONDS) * 1000
    }
    return token
  }

  async #authorize(signal: AbortSignal | undefined): Promise<string> {
    if (this.#token && Date.now() < this.#token.expiresAtMs) {
      return this.#token.value
    }
    return this.login(signal)
  }

  // Bearer per-request; one re-login retry on 401 (tokens are revoked wholesale
  // on any security-config change — spec:16-18).
  async #request(
    signal: AbortSignal | undefined,
    method: string,
    path: string,
    headers?: Readonly<Record<string, string>>,
    body?: string
  ): Promise<ShieldResponseLike> {
    const send = (token: string) => engineRequest(this.#engineName, this.#config, {
      method,
      path,
      headers: { accept: 'application/json', authorization: `Bearer ${token}`, ...headers },
      body,
      signal
    })
    let response = await send(await this.#authorize(signal))
    if (response.status === 401) {
      this.#token = null
      response = await send(await this.login(signal))
    }
    return response
  }

  /** Authenticated passthrough for routes verified in wazuh-routes.ts. */
  async send(
    request: { method: string; path: string; headers?: Readonly<Record<string, string>>; body?: string; signal?: AbortSignal }
  ): Promise<ShieldResponseLike> {
    return this.#request(request.signal, request.method, request.path, request.headers, request.body)
  }
}
