# Security Policy

## Supported Versions

Only the current `main` branch receives security fixes. There are no supported release branches or LTS tags for the Shield fabric.

| Version | Supported |
| --- | --- |
| `main` | Yes |
| older branches / tags | No — pull latest `main` |

## Reporting a Vulnerability

Report vulnerabilities **privately** through GitHub's private vulnerability reporting / Security Advisories:

**https://github.com/octopusshield/octopus-shield/security/advisories/new**

- **Do not open a public issue for a security vulnerability.**
- Include: affected component (see scope below), reproduction steps or PoC, impact assessment, and any relevant logs with **secrets redacted**.
- Do not paste credential values, tokens, or generated engine passwords into a report — describe the file/path and how they were reached instead.

## Scope

In scope:

- **Desktop app** — the Electron shell (`src/main`, `src/preload`, `src/renderer`): IPC surface, embedded-browser windows, preload bridge, packaging.
- **Octopod daemon** — `src/packages/octopod` (+ `@shield/ganglion`, `@shield/engine-contracts`): health probing, NATS event flow, CLI.
- **Nucleus fabric** — `infra/`: the `octopus-shield-nucleus` compose stack (NATS, Postgres/pgvector, Redis) and `infra/db` SQL DDL.
- **Armory tool execution layer** — `src/packages/armory`: scope authorization, runtime argv construction (`win`/`wsl`/`docker`), exploit-class opt-in, audit chain.

Out of scope: the vendored engine stacks under `engines/` (Wazuh, Mythic, Caldera — host-only checkouts of third-party projects; report to their upstreams), social engineering, physical access, and denial of service against loopback-only services.

## Hardening Summary

- **Electron renderer isolation** — the main window is created with `sandbox: true` and a preload-only bridge (`src/main/window/createMainWindow.ts`). Embedded webviews are forced to `contextIsolation: true`, `nodeIntegration: false`, `webSecurity: true`, and no insecure content on `will-attach-webview` (`src/main/window/main-window-webview-security.ts`). A Content-Security-Policy is present in `src/renderer/index.html`; electron-vite injects a stricter policy for production builds.
- **Armory authorization** — deny-by-default target allowlist: a run is permitted only when every target resolves inside `OSHIELD_ARMORY_SCOPE` (hosts, IPs, IPv4 CIDRs); an unset/empty scope denies everything. Exploitation- and post-exploitation-class tools additionally require the explicit `OSHIELD_ARMORY_EXPLOIT_AUTHORIZED=1` acknowledgment. Every allowed run emits an audit event (`audited: true` on the run record; `src/packages/armory/src/armory-audit.ts`).
- **Loopback-bound nucleus** — every nucleus port in `infra/docker-compose.nucleus.yml` is published on `127.0.0.1` only (NATS 4222/8222, Postgres 5435, Redis 6381). The fabric is single-host by design.

## Secret Stores

All secret material lives in gitignored local files. **Never commit, print, copy, or paste these values** (including into issues, PRs, or chat):

| Store | Purpose |
| --- | --- |
| `infra/.pg_password` | Postgres password, mounted as the compose `pg_password` secret (`POSTGRES_PASSWORD_FILE`) |
| `infra/.nats_token` | NATS auth token (canonical local copy; no code reads it — operators carry it into env vars) |
| `infra/.env` | Compose interpolation for the nucleus stack (`NATS_TOKEN`) |
| repo-root `.env.local` | Engine credential store for the live fabric |
| `engines/` credential files (e.g. Wazuh `single-node/config/credentials/*.env`, Mythic-generated env/compose) | Engine-stack secrets; the whole `engines/` tree is host-only and gitignored |

## Known-Accepted Postures

Documented trade-offs in the current state of `main`:

1. **NATS auth is token-based as of the current compose file.** `infra/docker-compose.nucleus.yml` starts NATS with `--auth ${NATS_TOKEN}`, interpolated from `infra/.env`; clients without the token are rejected, and the octopod daemon carries `OSHIELD_NATS_TOKEN` in the server URL userinfo. The loopback-only port binds remain in place regardless. (The comment block above the ports still describes an earlier anonymous, loopback-only posture and predates the `--auth` flag — treat the command line, not the comment, as current.)
2. **No Linux tray.** The system tray is created on Windows and macOS only; on Linux `createSystemTray` returns `null` (`src/main/tray/system-tray.ts`).
3. **deb/rpm installs do not self-update.** The in-app updater records `linux_package_manual_install_required` for deb/rpm installs; update by downloading and installing the new package manually. AppImage builds update in place.
