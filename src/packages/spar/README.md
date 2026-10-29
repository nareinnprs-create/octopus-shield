# Shield spar

**SPAR: the Eternal Opposition** (EXPANSION_PLAN_V1.1 §6) — phase 1: the loop skeleton and
referee scoring engine. The engagement "fights itself" on a Gardens VM digital twin; the
referee scores every exchange by ATT&CK technique. **Nothing here executes attacks and no
network call is made**: phase 1 runs entirely against injected fakes, with results entered
manually through the CLI (the referee UI pre-dating automation). Phase 2 wires the real
Caldera/Mythic adapters after API-key provisioning.

## Surfaces

- `spar-engagement` — engagement/round/exchange model, deep validation, and the state
  machine (`planned → running → paused ↔ running → concluded`; no skips; conclude refuses
  while a round is open). Pure round transforms: `openSparRound`, `appendSparExchange`,
  `concludeSparRound`.
- `spar-referee` — pure, deterministic scoring. Phase-1 table (encoded exactly in
  `SPAR_SCORING_TABLE`, version `spar-scoring-phase1-v1`, `TODO(verify)` balance tuning):

  | outcome            | pointsAdversary | pointsDefense | verdict mapping        |
  | ------------------ | --------------- | ------------- | ---------------------- |
  | `breach`           | 3               | 0             | `missed`, `evaded`     |
  | `contained-breach` | 1               | 1             | `contained`            |
  | `defended`         | 0               | 2             | `detected`             |

  `missed` = no telemetry, objective completed. `evaded` = a mutated variant slipped every
  sensor — scored as a full breach, but the raw verdict stays distinguishable on the
  exchange record. `exchangeMatchesScoringTable` re-derives stored scores (store tamper check).
- `spar-scoreboard` — per-technique / per-round / campaign aggregation plus
  `sparDefensePostureSummary` (detection rate = sensor-fired share, i.e. `detected` +
  `contained` verdicts; weakest-technique ranking: rate asc, adversary points desc, id asc).
- `spar-runner` — `startRound` / `submitExchange` / `concludeRound` through injected
  `SparEventSink` + `SparAuditSink`. Denials come back `{ ok: false, reason }` with zero
  emissions; audit records carry `actorKind: 'tentacle'`, `actorId: 'spar'` (same shape as
  `@shield/access` AuditEvent, structurally defined to keep spar dependency-free).
- `spar-events` — `spar.*` vocabulary for the octopod bus: `spar.engagement.created |
  started | paused | concluded`, `spar.round.started | concluded`,
  `spar.exchange.scored`. Structural `SparEventSink` stays transport-free.
- `spar-engagement-store` — machine-local JSON store (convenience only; the audit chain is
  the tamper-evident system of record). Loads are deep-validated and re-scored against the
  phase-1 table — tampered stores fail closed. `OSHIELD_SPAR_STORE` overrides the path.
- `spar-cli` (bin `spar`) — the phase-1 loop proof:

  ```
  spar create <name> --garden <vmName> --source caldera|mythic --intensity weekly|nightly|always-on
  spar start <engagementId>     # also resumes a paused engagement
  spar pause <engagementId> | conclude <engagementId>
  spar round-start <engagementId> | round-conclude <roundId>
  spar exchange <roundId> <Txxxx[.xxx]> detected|missed|contained|evaded
  spar status <engagementId> | scoreboard <engagementId>
  ```

  Exit codes: 0 ok, 2 usage/argument errors, 3 state denials and store failures.

## State machine

```
              start                  start
  planned ──────────▶ running ──────────▶ running ──────────▶ concluded
                              │      ▲
                        pause │      │ start (resume)
                              ▼      │
                             paused
```

Every other transition (including any skip and anything out of `concluded`) is denied.
Rounds only exist inside `running` engagements, one open round at a time, and an
engagement cannot conclude while a round is open.

## Phase-2 wiring plan

- `@shield/engine-clients` Caldera/Mythic adapters become exchange producers: an ability's
  ATT&CK mapping yields `techniqueId`, the engagement's `adversarySource` selects the
  client; they feed `runner.submitExchange` — the runner API is unchanged.
- Sentinel detection state supplies `defenseResult` (per-technique verdict) instead of the
  CLI's manual entry; Lure decoy and Chokehold containment events map to `contained`.
- `SparEventSink` gets a thin adapter onto the `@shield/octopod` bus: enroll the `spar.*`
  keys in `OctopodEventMap` / `OCTOPOD_EVENT_TYPES`, NATS subjects ride the existing
  `oshield.octopod.*` prefix.
- `SparAuditSink` gets a thin adapter onto the `@shield/access` hash chain (Postgres) so
  every score becomes tamper-evident history; the JSON store stays the fast local cache.
- `gardenVmName` is resolved against `@shield/gardens-vm` before `start` is allowed to run
  real adversary tooling inside the isolated Garden; `@shield/armory` stays the only
  execution path, under its existing scope authorization.
- Intensity (`weekly | nightly | always-on`) drives the phase-2 scheduler that opens and
  concludes rounds automatically — the round lifecycle contract is already enforced here.

## Running

```
pnpm --filter @shield/spar typecheck
pnpm --filter @shield/spar test
pnpm --filter @shield/spar build
```
