import {
  engineJson,
  engineRequest,
  type ShieldEngineClientConfig,
  type ShieldResponseLike
} from './engine-transport'

// Auth: raw API key sent in the `KEY` header; valid API keys authenticate the
// request without a session (engines/caldera/app/service/auth_svc.py:21,166-174).
export const CALDERA_API_KEY_HEADER = 'KEY'

export type ShieldCalderaClientConfig = ShieldEngineClientConfig & {
  apiKey: string
}

export type ShieldCalderaHealth = {
  application: string
  version: string
  access: string
  plugins: readonly unknown[]
}

export type ShieldCalderaAbility = {
  ability_id: string
  tactic: string | null
  technique_name: string | null
  technique_id: string | null
  name: string | null
  description: string | null
  executors: readonly unknown[]
  requirements: readonly unknown[] | null
  privilege: string | null
  repeatable: boolean | null
  buckets: readonly string[] | null
  singleton: boolean | null
  plugin: string | null
}

export type ShieldCalderaAdversary = {
  adversary_id: string
  name: string
  description: string
  atomic_ordering: readonly string[]
  objective: string
  tags: readonly string[] | null
  has_repeatable_abilities: boolean
  plugin: string | null
}

/**
 * Only routes whose handler line and response schema were both verified in-repo
 * are implemented here; everything else lives in caldera-routes.ts with cited
 * records. API auth is the raw Caldera key in the KEY header (auth_svc.py:21,
 * 166-174); POST /enter is UI form login only (default.py:20-36) and never
 * grants API access.
 */
export class ShieldCalderaClient {
  readonly #config: ShieldCalderaClientConfig

  readonly #engineName = 'caldera'

  constructor(config: ShieldCalderaClientConfig) {
    this.#config = config
  }

  // GET /api/v2/health — engines/caldera/server.py:309 mounts /api/v2;
  // engines/caldera/app/api/v2/handlers/health_api.py:18 registers /health.
  // Response: engines/caldera/app/api/v2/schemas/caldera_info_schemas.py:7-11
  // and engines/caldera/app/api/v2/handlers/health_api.py:28-35.
  // Live-verified: 401 without KEY; a health probe wants any-response semantics (see
  // @shield/octopod engine-probes) — this typed method still requires auth + ok status.
  async health(signal?: AbortSignal): Promise<ShieldCalderaHealth> {
    return engineJson(
      await this.#request(signal, 'GET', '/api/v2/health')
    )
  }

  // GET /api/v2/abilities — engines/caldera/app/api/v2/handlers/ability_api.py:18.
  // Response: AbilitySchema(many, partial) via Ability.display_schema
  // (engines/caldera/app/objects/c_ability.py:19-34,52).
  async listAbilities(signal?: AbortSignal): Promise<readonly ShieldCalderaAbility[]> {
    return engineJson(
      await this.#request(signal, 'GET', '/api/v2/abilities')
    )
  }

  // GET /api/v2/adversaries — engines/caldera/app/api/v2/handlers/adversary_api.py:21.
  // Response: AdversarySchema dump (engines/caldera/app/objects/c_adversary.py:17-24).
  async listAdversaries(signal?: AbortSignal): Promise<readonly ShieldCalderaAdversary[]> {
    return engineJson(
      await this.#request(signal, 'GET', '/api/v2/adversaries')
    )
  }

  // v2 middleware rejects unauthenticated requests with 401 —
  // engines/caldera/app/api/v2/security.py:62-69; auth via session or KEY
  // header (engines/caldera/app/service/auth_svc.py:204-207).
  async #request(
    signal: AbortSignal | undefined,
    method: string,
    path: string
  ): Promise<ShieldResponseLike> {
    return engineRequest(this.#engineName, this.#config, {
      method,
      path,
      headers: {
        accept: 'application/json',
        [CALDERA_API_KEY_HEADER]: this.#config.apiKey
      },
      signal
    })
  }
}
