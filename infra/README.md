# Octopus Shield infra

Live engine + nucleus fabric topology. Components below are running and expected to be reachable; first viewer to rely on a value should re-verify it against the component's own stack, since this file only records the port map handed to the Tentacles.

## Live engines

| Component | Endpoint | Port | Notes |
| --- | --- | --- | --- |
| Wazuh 5.0.0-rc1 dashboard | https://localhost:443 | 443 | HTTPS |
| Wazuh manager API | https://localhost:55000 | 55000 | Manager API |
| Wazuh agents | TCP 1514 / 1515 | — | 1514 agent channel, 1515 enrollment |
| Mythic UI | https://localhost:7443 | 7443 | HTTPS |
| Mythic Postgres | localhost:5436 | 5436 | Mythic's own DB |
| Mythic RabbitMQ | 5672 | — | Internal to the Mythic stack, not host-published |
| Caldera UI | http://localhost:8890 | 8890 | Plain HTTP |
| Caldera API | https://localhost:18443 | 18443 | HTTPS |

## Nucleus infra (`docker-compose.nucleus.yml`, project `octopus-shield-nucleus`)

| Component | Endpoint | Port | Notes |
| --- | --- | --- | --- |
| NATS 2.10 client | localhost:4222 | 4222 | JetStream enabled |
| NATS HTTP monitor | http://localhost:8222 | 8222 | `/healthz` |
| Postgres 16 + pgvector | localhost:5435 | 5435 | Image `pgvector/pgvector:pg16`, container `oshn-postgres`, db `octopusshield`, user `octopus` |
| Redis 7 | localhost:6381 | 6381 | Host port 6381 maps to in-container 6379, container `oshn-redis` |

## Ownership

- `infra/` (this directory, compose, README) and the `@shield/engine-contracts` endpoint defaults are versioned by the repo; daemon wiring lives in `@shield/octopod`.
- SQL DDL in `infra/db/` is filled in by a dedicated Tentacle (see [db/README.md](./db/README.md)).
- Engine stack lifecycle (Wazuh/Mythic/Caldera services and their secrets) is outside this repo's source of truth; treat their dashboards/APIs as external live systems, not as files here.

## Secrets

`.env.local` (repo root, engine credential store) and `infra/.pg_password` (mounted via the compose `pg_password` secret) are the ONLY supported secret stores for the fabric. Never print, copy, or commit secret values; never add another secret location without changing this rule first.
