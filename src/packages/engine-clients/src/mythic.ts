import {
  engineJson,
  engineRequest,
  type ShieldEngineClientConfig,
  type ShieldResponseLike
} from './engine-transport'

// Verified transport facts (no Mythic client code runs anything automatically):
// - nginx terminates TLS on 7443:
//   engines/mythic/nginx-docker/config/conf.d/services.conf:2-5.
// - POST /graphql/ proxies to the Hasura mythic_graphql container /v1/graphql:
//   engines/mythic/nginx-docker/config/conf.d/services.conf:119-120
//   (container wiring: engines/mythic/docker-compose.yml:20-21,44).
// - Hasura auth goes through the Mythic server webhook:
//   engines/mythic/docker-compose.yml:39.
// - Token handling: `Authorization` header (or `apitoken` header) parsed as
//   "Bearer <token>"; both JWT and API tokens >10 chars are accepted —
//   engines/mythic/mythic-docker/src/authentication/jwt.go:164-208.
export const MYTHIC_GRAPHQL_PATH = '/graphql/'

export const MYTHIC_AUTH_HEADER = 'Authorization'

export type ShieldMythicClientConfig = ShieldEngineClientConfig & {
  apiToken: string
}

export type ShieldMythicGraphQLResponse = {
  data?: unknown
  errors?: readonly unknown[]
}

export type ShieldMythicGraphQLRequest = {
  query: string
  variables?: Record<string, unknown>
  operationName?: string
}

/**
 * GraphQL-only client. No queries are pre-registered here; operation documents
 * with in-repo schema citations live in mythic-operations.ts. Result provenance
 * (data/errors envelope) is the GraphQL-over-HTTP wire shape that Hasura
 * answers on /v1/graphql (cited above).
 */
export class ShieldMythicClient {
  readonly #config: ShieldMythicClientConfig

  readonly #engineName = 'mythic'

  constructor(config: ShieldMythicClientConfig) {
    this.#config = config
  }

  async gqlQuery(
    document: string,
    variables?: Record<string, unknown>,
    operationName?: string,
    signal?: AbortSignal
  ): Promise<ShieldMythicGraphQLResponse> {
    const request: ShieldMythicGraphQLRequest = {
      query: document,
      ...(variables === undefined ? {} : { variables })
    }
    return engineJson(
      await this.#request(operationName === undefined ? request : { ...request, operationName }, signal)
    )
  }

  async #request(
    body: ShieldMythicGraphQLRequest,
    signal: AbortSignal | undefined
  ): Promise<ShieldResponseLike> {
    return engineRequest(this.#engineName, this.#config, {
      method: 'POST',
      path: MYTHIC_GRAPHQL_PATH,
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        // ExtractToken splits on one space and requires two pieces
        // (mythic-docker/src/authentication/jwt.go:200-208).
        [MYTHIC_AUTH_HEADER]: `Bearer ${this.#config.apiToken}`
      },
      body: JSON.stringify(body),
      signal
    })
  }
}
