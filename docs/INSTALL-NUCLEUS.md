# Installing the Nucleus Fabric (Windows)

Operator guide to bring up the full Octopus Shield fabric from scratch on a Windows host: the nucleus infra stack, the three engines, the desktop shell, and the octopod daemon. All commands were verified against this checkout's files. Hostnames below are placeholders — substitute your own.

**What you end up with:**

| Layer | Components | Endpoint defaults |
| --- | --- | --- |
| Nucleus | NATS 2.10, Postgres 16 + pgvector, Redis 7 (loopback-bound) | 4222 / 8222 · 5435 · 6381 |
| Engines | Wazuh (SIEM), Mythic (C2), Caldera (adversary emulation) | 443/55000 · 7443/5436 · 8890 |
| Shell | Shield desktop (Electron) | renderer dev port 15200+ |
| Daemon | `@shield/octopod` health loop + NATS events | probes all of the above |

> `engines/` is a host-only, gitignored vendored tree (multi-GB). It is not part of the published repo; engine stack lifecycle is outside the repo's source of truth by policy (see `infra/README.md`). Secret files are also gitignored — never print or commit their contents.

## Prerequisites

1. **Windows 10/11** with **WSL2** and an **Ubuntu** distro (Armory's WSL runtime invokes `wsl -d Ubuntu -u root`):
   ```powershell
   wsl --install -d Ubuntu
   ```
2. **Docker Desktop** with the WSL2 backend, running.
3. **Node.js 24** (root `package.json` pins `engines.node: "24"`; the `@shield/octopod` and `@shield/armory` packages require Node >= 18) and **pnpm 12.14.0** as pinned in `packageManager`:
   ```powershell
   corepack enable   # Corepack 0.34.5+; if it fails with EPERM, run: npm install -g pnpm@12.14.0
   ```
4. **git**.

## 1. Nucleus (NATS / Postgres / Redis)

### 1.1 Create the secret stores

The compose file reads two gitignored files under `infra/`:

- `infra/.pg_password` — Postgres password, mounted as the `pg_password` secret (`POSTGRES_PASSWORD_FILE`).
- `infra/.env` — must define `NATS_TOKEN`, interpolated into the NATS `--auth` flag. Keep a copy in `infra/.nats_token`.

Generate both without echoing the values (WSL Ubuntu / git-bash):

```bash
cd infra
printf '%s' "$(openssl rand -hex 24)" > .pg_password
printf '%s' "$(openssl rand -base64 27 | tr -d '\n')" > .nats_token
printf 'NATS_TOKEN=%s\n' "$(cat .nats_token)" > .env
chmod 600 .pg_password .nats_token .env
```

PowerShell equivalent:

```powershell
$chars = -join ((1..36) | ForEach-Object { [char](Get-Random -InputObject (48..57 + 65..90 + 97..122)) })
[IO.File]::WriteAllText("$PWD\infra\.nats_token", $chars)
[IO.File]::WriteAllText("$PWD\infra\.env", "NATS_TOKEN=$chars`n")
$pg = -join ((1..32) | ForEach-Object { [char](Get-Random -InputObject (48..57 + 65..90 + 97..122)) })
[IO.File]::WriteAllText("$PWD\infra\.pg_password", $pg)
```

### 1.2 Start the stack

```powershell
cd infra
docker compose up -d
docker compose ps   # wait for oshn-postgres / oshn-nats / oshn-redis to be healthy
```

Service names are `postgres` (`oshn-postgres`), `nats` (`oshn-nats`), `redis` (`oshn-redis`); project name `octopus-shield-nucleus`. Every port is bound to `127.0.0.1` only: Postgres 5435, NATS 4222 + monitor 8222, Redis 6381.

### 1.3 Apply the SQL DDL

`infra/db/audit.sql` and `infra/db/rbac.sql` run against db `octopusshield`, user `octopus` (both idempotent; `rbac.sql` is default-deny and consumes rows via `@shield/access`). From the repo root:

```powershell
Get-Content infra\db\audit.sql -Raw | docker exec -i oshn-postgres psql -U octopus -d octopusshield -v ON_ERROR_STOP=1
Get-Content infra\db\rbac.sql  -Raw | docker exec -i oshn-postgres psql -U octopus -d octopusshield -v ON_ERROR_STOP=1
```

Host-side clients connect to `localhost:5435` with the value stored in `infra/.pg_password`.

## 2. Engines

### 2.1 Caldera

`engines/caldera` vendors the Caldera **5.3.0 source only** — this checkout ships no Dockerfile or compose file for it, and `infra/README.md` treats the running Caldera instance as an external live system. Bring it up from the upstream Caldera Docker guidance for your checkout, then publish:

- UI + API: `http://localhost:8890` (the container serves 8888; host port 8890 is what the Shield defaults target). Caldera 5.x has no TLS contact in source; the `18443` upstream port is a no-op leftover.
- Probe expectations: `GET /api/v2/health` answers `401` without an API key — any HTTP response proves reachability.

### 2.2 Mythic

`engines/mythic/docker-compose.yml` **ships generated** in this checkout (MythicServer images `v3.4.0.61`); Mythic normally generates it, plus a machine-local `.env`, via its CLI. To regenerate or start fresh:

```bash
cd engines/mythic
sudo make                    # builds the mythic-cli binary
sudo ./mythic-cli build      # (re)generates docker-compose.yml + .env — keep .env local, never commit
sudo ./mythic-cli start
```

Endpoints (match the `OSHIELD_*` defaults): UI `https://localhost:7443`, Mythic's own Postgres on host port `5436`. RabbitMQ stays compose-internal (not host-published). The generated compose sets `MYTHIC_SERVER_DYNAMIC_PORTS_BIND_LOCALHOST_ONLY=true`. Probe: `GET https://localhost:7443/graphql/` expects `200`.

### 2.3 Wazuh (single-node)

`engines/wazuh-docker` vendors the Wazuh Docker deployment (see its `docs/ref/getting-started/deployment/single-node.md`, which this section follows). `single-node/` already contains `config.yml`, `wazuh-certs-tool.sh`, and `wazuh-credentials.sh` — no downloads needed.

```bash
cd engines/wazuh-docker/single-node

# 1. Certificates (issues every pair the stack mounts; the manager refuses to start without them)
sudo bash ../tools/utils/deployment/certificates-conf.sh --cert --copy --priv

# 2. Credentials (generates config/credentials/{indexer,manager,dashboard}.env; deployment won't start without them)
sudo bash ../tools/utils/deployment/credentials-conf.sh

# 3. Start
docker compose up -d
```

Notes:

- The indexer needs `vm.max_map_count=262144` on Linux Docker hosts. Inside WSL2 Ubuntu running the stack directly: `wsl -d Ubuntu -u root sysctl -w vm.max_map_count=262144` (temporary) or persist it in `/etc/sysctl.conf`.
- Dashboard: `https://localhost:443`, log in as `admin` — the password is in `config/credentials/indexer.env` (`grep '^WAZUH_INDEXER_ADMIN_PASSWORD=' ...`). Read it locally; don't paste it anywhere shared.
- Manager API: `https://localhost:55000`; agent channel TCP 1514, enrollment 1515. Probe: `GET https://localhost:55000/` answers `401` unauthenticated — any response proves reachability.

## 3. Shield desktop shell

From the repo root:

```powershell
pnpm install --ignore-scripts
```

**Native caveat:** a plain `pnpm install` compiles native modules (`node-pty`, `native/windows-security`, `native/windows-registry`) with node-gyp, which needs Python 3 and Visual Studio Build Tools with the **"Desktop development with C++"** workload. Without MSVC, `--ignore-scripts` skips those builds; run the dev runner directly, bypassing the native gate:

```powershell
node config/scripts/build-workspace-packages.mjs
node config/scripts/run-electron-vite-dev.mjs
```

(Terminal/PTY and Windows-security features stay limited until the native modules are built on a machine with the toolchain.)

- Development (full toolchain): `pnpm dev` — builds workspace packages, runs `ensure-native-runtime.mjs --runtime=electron`, then starts electron-vite dev.
- Production build: `pnpm build` (= `build:desktop` + `build:native`; requires the native toolchain).

## 4. Octopod daemon

Single probe pass — prints one line per engine and exits 0 only when all are healthy:

```powershell
pnpm --filter @shield/octopod once
```

Expect **4/4 healthy** (`caldera`, `wazuh`, `mythic`, `nucleus` — see `ENGINE_PROBE_DESCRIPTORS` in `src/packages/octopod/src/engine-probes.ts`). Auth challenges count as reachable (Caldera/Wazuh answer 401 to the unauthenticated probe).

Daemon mode (NATS event bus + 30 s health loop):

```powershell
pnpm --filter @shield/octopod build
node src\packages\octopod\dist\octopod-cli.js
# Windows cannot deliver SIGINT reliably; use a bounded lifetime for graceful stop:
node src\packages\octopod\dist\octopod-cli.js --lifetime-ms=9000
```

### Environment variables

Endpoint overrides are parsed by `src/packages/engine-contracts/src/oshield-env.ts`; defaults come from `engine-endpoints.ts` and match the stacks above.

| Variable | Default (unset) | Purpose |
| --- | --- | --- |
| `OSHIELD_WAZUH_DASHBOARD_URL` | `https://localhost:443` | Wazuh dashboard |
| `OSHIELD_WAZUH_MANAGER_API_URL` | `https://localhost:55000` | Wazuh manager API |
| `OSHIELD_WAZUH_AGENT_TCP_PORT` | `1514` | Agent channel |
| `OSHIELD_WAZUH_AGENT_ENROLLMENT_PORT` | `1515` | Agent enrollment |
| `OSHIELD_MYTHIC_UI_URL` | `https://localhost:7443` | Mythic UI (nginx front) |
| `OSHIELD_MYTHIC_POSTGRES_HOST` / `_PORT` | `localhost:5436` | Mythic's own Postgres |
| `OSHIELD_MYTHIC_RABBITMQ_HOST` / `_PORT` | `localhost:5672` | Mythic RabbitMQ (compose-internal) |
| `OSHIELD_CALDERA_UI_URL` | `http://localhost:8890` | Caldera UI |
| `OSHIELD_CALDERA_API_URL` | `http://localhost:8890` | Caldera API |
| `OSHIELD_NATS_CLIENT_HOST` / `_PORT` | `localhost:4222` | NATS client |
| `OSHIELD_NATS_MONITOR_URL` or `_HOST` / `_PORT` | `http://localhost:8222` | NATS monitor (`/healthz`) |
| `OSHIELD_PGVECTOR_POSTGRES_HOST` / `_PORT` | `localhost:5435` | Nucleus Postgres + pgvector |
| `OSHIELD_REDIS_HOST` / `_PORT` | `localhost:6381` | Nucleus Redis |
| `OSHIELD_NATS_TOKEN` | *(none)* | Auth token for the daemon's NATS connection (sent as URL userinfo); must match `NATS_TOKEN` in `infra/.env`. An auth-enabled NATS rejects tokenless clients. |
| `OSHIELD_ARMORY_SCOPE` | *(empty = deny all)* | Armory target allowlist — comma-separated hostnames, IPs, or IPv4 CIDRs (CIDR prefixes 8–32) |
| `OSHIELD_ARMORY_EXPLOIT_AUTHORIZED` | *(unset = denied)* | Set to `1` to authorize exploitation/post-exploitation-class Armory tools |

The daemon transport disables TLS trust checks only for the self-signed localhost engine fabric probes (`node-probe-fetch`); strict transport policy stays with the real engine clients.

## 5. Armory

Armory (`src/packages/armory`) executes integrated security tools only through scope authorization. Tool availability comes from ring inventories written by the install ring agents to `%TEMP%\opencode\armory\wsl.json`, `windows.json`, and `docker.json` (missing rings are skipped, not fatal).

```powershell
# List merged inventory (status, runtime, scope class, id)
pnpm exec tsx --conditions=shield-source src/packages/armory/src/armory-cli.ts list

# Run a tool: every target argument must resolve inside OSHIELD_ARMORY_SCOPE
$env:OSHIELD_ARMORY_SCOPE = "10.0.20.0/24,host-a.example.invalid"
pnpm exec tsx --conditions=shield-source src/packages/armory/src/armory-cli.ts run nmap --targets=10.0.20.5 -- -sV 10.0.20.5
```

How authorization works:

- **Deny-by-default**: with no/empty `OSHIELD_ARMORY_SCOPE`, every run is denied (`armory: DENIED — target outside authorized scope`); exit code 3.
- **Exploit-class opt-in**: `exploitation` and `post-exploitation` tools additionally require `OSHIELD_ARMORY_EXPLOIT_AUTHORIZED=1`, and only when the operator set it — it is never defaulted.
- **Targets validated before any process spawns**; argv is built per runtime (`win` absolute paths, `wsl -d Ubuntu -u root`, `docker run --rm`).
- **Audit chain**: every allowed run emits an audit event line (`audit {...}`) with tool id, argv, targets, exit code, and duration; records carry `audited: true`.
- Tools whose binaries were removed by antivirus show status `quarantined-by-av` and are refused.

## 6. Troubleshooting

- **WSL hangs or a distro won't start** (Docker Desktop depends on it): `wsl --shutdown` from PowerShell, wait ~8 s, then relaunch WSL/Docker Desktop.
- **Docker engine returns 500s / compose commands fail oddly**: restart Docker Desktop (tray icon → Restart, or quit and reopen), then `docker compose ps` from `infra/` to confirm the three nucleus services return to healthy.
- **Antivirus (e.g. McAfee) quarantines offensive tool binaries**: Armory marks those inventory entries `quarantined-by-av` and refuses to run them. Restore them or create exclusions per your local AV policy — that decision belongs to the machine owner, not to this repo. Never re-package or commit quarantined binaries.
- **NATS auth failures from the daemon**: the daemon logged in without `OSHIELD_NATS_TOKEN` or with a token that doesn't match `infra/.env`'s `NATS_TOKEN` — set `OSHIELD_NATS_TOKEN` to the same value and restart the daemon.
- **Postgres auth failures from a host client**: connect to `localhost:5435` as `octopus` with the `infra/.pg_password` value; the file has no trailing newline by construction, and `docker exec` psql (section 1.3) needs no password at all.
