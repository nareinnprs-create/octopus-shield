# Octopus Shield

**The unified cybersecurity platform.** Offensive, defensive, and deception intelligence fused into one agentic system — built as the rebrand-native continuation of a hardened Electron agent shell.

![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-blue) ![Language](https://img.shields.io/badge/language-TypeScript%207-blueviolet) ![License](https://img.shields.io/badge/license-MIT-green)

---

## What it is

Octopus Shield runs **The Octopus** — a head orchestrator that supervises seven specialist **Tentacles** (Archivist, Scaffold, Forge, Inkwell, Prism, Sentinal-7, Verifier) over a typed agent graph (**Ganglion**), extended by a scope-authorized security-tool execution layer (**Armory**), isolated engagement environments (**Gardens**), and a continuously red-teaming self-fight loop (**SPAR**).

One daemon — **octopod** — watches the entire engine fabric and streams every signal over NATS.

```
                    ┌─────────────────────────────┐
                    │         The Octopus         │
                    │   (head orchestrator)       │
                    └──────────────┬──────────────┘
              ┌──────────┬─────────┼──────────┬──────────┐
              │          │         │          │          │
         Archivist   Scaffold    Forge     Inkwell    Prism ... Verifier
              │          │         │          │          │
        ┌─────┴──────────┴─────────┴──────────┴──────────┴─────┐
        │                  Ganglion agent graph                │
        └─────┬──────────┬──────────┬──────────┬───────────────┘
              │          │          │          │
        ┌─────┴───┐ ┌────┴────┐ ┌───┴───┐ ┌───┴────┐
        │  Wazuh  │ │ Mythic  │ │Caldera│ │ Armory │   ← engine fabric
        └─────────┘ └─────────┘ └───────┘ └────────┘
              NATS · Postgres+pgvector · Redis  ← nucleus
```

## Core packages (`src/packages/`)

| Package | Purpose |
|---|---|
| `@shield/ganglion` | Typed agent graph: Tentacle registry, edges, lookups. Locked 7-name vocabulary. |
| `@shield/engine-contracts` | Canonical `OSHIELD_*` env vocabulary, engine endpoint maps, overrides. |
| `@shield/engine-clients` | Wazuh / Caldera / Mythic clients — every route cited from primary sources. |
| `@shield/octopod` | The daemon: Ganglion composition, NATS event bus, live engine health probes, CLI. |
| `@shield/access` | RBAC evaluate (deny-wins), tamper-evident audit hash chain, MFA/session domain. |
| `@shield/armory` | Scope-authorized security-tool execution: 20+ integrated tools, deny-by-default targets, exploit-class opt-in, per-run audit events. |
| `@shield/audit-store` | Audit-chain persistence to the nucleus Postgres (`audit_events`). |
| `@shield/gardens-vm` | Gardens: isolated VM environments (QEMU / Hyper-V / Virtualization.framework). |
| `@shield/process-host` | Hardened child-process runtime for everything above. |

## The Armory

Integrated tooling — nmap, masscan, amass, Metasploit, msfvenom, searchsploit, BloodHound, Impacket, NetExec, Responder, pypykatz, Burp Suite, SQLMap, FFUF, Hashcat, Hydra, Bettercap, tshark, Ghidra — executed only through the authorization gate:

```bash
# deny-by-default: nothing runs without an explicit scope
set OSHIELD_ARMORY_SCOPE=10.0.0.0/24,lab.local
# exploitation-class tools additionally require explicit opt-in
set OSHIELD_ARMORY_EXPLOIT_AUTHORIZED=1

armory list
armory run nmap --targets=10.0.0.15 -- -sV -p 1-1000 10.0.0.15
```

Every run emits a hash-chained audit event. Out-of-scope targets are refused before a process spawns.

## Engine fabric

| Engine | Role | Access |
|---|---|---|
| **Wazuh** | SIEM/XDR — agents, alerts, vulnerability state | Manager API 55000 (TLS) |
| **Mythic** | C2 / adversarial tradecraft | GraphQL 7443 (TLS) |
| **Caldera** | Adversary emulation — abilities, operations | REST 8890 / API v2 |
| **Nucleus** | NATS + Postgres/pgvector + Redis substrate | loopback-bound |

Health model: liveness probes (`engine.health` events) — any HTTP answer from an engine proves reachability; authenticity is the auth layer's job.

## Quickstart

```bash
pnpm install --ignore-scripts   # MSVC required for full native addons (see docs)
pnpm tc                          # typecheck: ~37k files, 5 lanes

# nucleus (NATS + Postgres + Redis, loopback-bound)
cd infra && docker compose up -d

# octopod daemon: probe the fabric once
pnpm --filter @shield/octopod once
```

See [`docs/INSTALL-NUCLEUS.md`](docs/INSTALL-NUCLEUS.md) for the full fabric bring-up (engines, DDL, secrets) and [`SECURITY.md`](SECURITY.md) for the security posture.

## Desktop shell

Electron + React + TypeScript 7, sandboxed and context-isolated:

- **Windows** — NSIS installer, SignPath-signed, auto-updater
- **macOS** — dmg/zip, hardened-runtime + notarized, Intel + Apple Silicon
- **Linux** — AppImage / deb / rpm, x64 + arm64, Wayland support
- **Mobile** — Expo/React Native companion (iOS + Android lanes)

## Development

```bash
pnpm install --ignore-scripts
pnpm tc        # typecheck everything
pnpm test      # shell suites
pnpm --filter "@shield/*" run test   # package suites
pnpm dev       # shell (requires MSVC for native addons)
```

## Repository layout

```
src/main            Electron main process
src/renderer        React UI
src/preload         Typed IPC bridge
src/packages/       @shield/* platform packages (above)
native/             Per-platform native addons (Rust/Swift/C/node-gyp)
infra/              Nucleus compose + audit/RBAC DDL
engines/            Vendored engine deployments (local-only, gitignored)
docs/               Styleguide, contracts, nucleus install guide
```

## License

[MIT](LICENSE) — with attribution to the upstream project this platform derives from.
