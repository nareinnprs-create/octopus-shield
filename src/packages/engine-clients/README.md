# Shield engine clients

Typed, transport-injected HTTP and GraphQL client skeletons for the three engines fused into Octopus Shield — Wazuh, Caldera, and Mythic. No network is executed automatically, no runtime npm dependencies, no Electron imports. Every encoded endpoint cites the engine source file and line it was read from; anything that could not be verified in-repo is a `TODO(verify)` record, never a guessed route or body shape.

Import clients from `@shield/engine-clients` (Caldera) and the explicit subpaths `./wazuh`, `./mythic`, `./config`, `./engine-transport`, `./caldera-routes`, `./wazuh-routes`, `./mythic-operations`. The `shield-source` condition exposes `src`, mirroring `@shield/process-host`.

- `config.ts` builds `EngineFabricConfig` from `OSHIELD_WAZUH_URL`, `OSHIELD_WAZUH_API_TOKEN`, `OSHIELD_CALDERA_URL`, `OSHIELD_CALDERA_API_KEY`, `OSHIELD_MYTHIC_URL`, and `OSHIELD_MYTHIC_API_TOKEN`, with deployment defaults from the verified engine port map (Wazuh 55000, Mythic 7443 in-repo; Caldera 18443 is deployment-provided — in-repo server default is 8888).
- `caldera.ts` implements exactly three routes whose handler and response schema were verified in-repo: `/api/v2/health`, `/api/v2/abilities`, `/api/v2/adversaries`. Auth is the raw Caldera API key in the `KEY` header. `caldera-routes.ts` holds the remaining verified routes and the `unknown` records.
- `wazuh.ts` encodes the spec-verified auth flow — `POST /security/user/authenticate` with basic auth returns a JWT (900 s default TTL, spec-exposed), cached and sent as `Authorization: Bearer` with one re-login retry on 401. `wazuh-routes.ts` cites each route against the OpenAPI spec shipped inside the manager container (`docker cp single-node-wazuh.manager:/var/wazuh-manager/framework/python/lib/python3.12/site-packages/api/spec/spec.yaml`), live-verified 401 shapes in-container; alerts/vulnerability-findings/detection-rules/decoders have no manager-API paths in 5.0 (indexer-side) and remain `unknown` records. Authenticated smoke still TODO(verify): operator credentials unknown; reset deliberately not performed.
- `mythic.ts` is a GraphQL-only client posting `{query, variables}` to `/graphql/` (nginx TLS 7443 → Hasura `mythic_graphql:8080/v1/graphql`) with `Authorization: Bearer <token>`, all cited from engine sources. `mythic-operations.ts` carries the three fully-verified documents plus resolved records: `token_type` is free-form text (not an enum — `mythic-docker/src/database/schema.go:703`), the Hasura `/v2/` + `/v1alpha1/` REST proxies define no endpoints in the checked-in metadata (`rest_endpoints.yaml:1` = `[]`), and bootstrap is `POST /auth` → JWT (`mythic-docker/src/webserver/initialize.go:155`, `controllers/login.go:15-58`). Only table-backed column-level select documents were resolved via live authenticated introspection (`MYTHIC_TABLE_COLUMNS` in `mythic-operations.ts`, introspection 2026-10-29).
- Live probes 2026-10-28: Mythic `https://localhost:7443/graphql/` reachable; unauthenticated `__schema` introspection rejected by the auth hook (`"Authentication hook unauthorized this request"`, code `access-denied`). Caldera `localhost:8890` down (connection refused) — the 401-without-KEY smoke evidence stands from the earlier 2026-10 run.

Both Caldera and Mythic clients take an injected `fetchLike`, so tests and callers supply their own transport (Node `globalThis.fetch` satisfies `ShieldFetchLike` structurally). Verification citations use `engines/.../:line` paths relative to the repository root; when the engines are vendored at a different depth, resolve citations relative to `engines/`.

From the repository root:

```sh
pnpm build:packages
pnpm --filter @shield/engine-clients typecheck
```
