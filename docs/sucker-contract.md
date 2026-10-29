# Sucker Plugin Contract — v0.1 (design artifact)

Status: draft for review by the other Tentacles. This document defines what
a **Sucker** (Shield plugin) may declare, how it is isolated (**Shed**
tiers), how authority is granted and revoked, and where **Inkout**
redaction hooks must fire. Types marked `TODO(verify)` are open decisions;
nothing here invents network endpoints — provider specifics stay abstract
behind generic domain queries.

Suckers extend `octopod` (the daemon) and the Ganglion orchestration with
third-party capabilities: threat-intel lookups (VirusTotal, OTX,
AbuseIPDB, GreyNoise), enrichment feeds, reporting sinks. They are
*not* Tentacles, never carry human-tier roles, and their brokered reads
are governed by the same RBAC engine as everything else
(`@shield/access/permission-evaluate`).

## 1. Manifest

A Sucker ships a machine-readable manifest. Canonical TypeScript shape
(mirrors `roles`/`role_permissions` rows in `infra/db/rbac.sql`):

```ts
type SuckerManifest = {
  /** Stable slug, e.g. 'threat-intel-virustotal'. Immutable once granted. */
  id: string
  /** Semantic version of the Sucker itself. */
  version: string
  /** What kind of Sucker this is. TODO(verify): is this enum final?; 'custom' must be gated behind owner approval alone. */
  kind: 'threat-intel' | 'enrichment-feed' | 'reporting-sink' | 'custom'
  /** Requested authority; granted as exact (resource_kind, action) rows.
   *  resourceKind values MUST come from the Shield resource-kind registry
   *  (owner-curated catalog; TODO(verify) before first Sucker ships) —
   *  free-form values like 'sessions' or 'mfa_factors' are invalid by
   *  default. */
  permissions: ReadonlyArray<{
    resourceKind: string
    action: string
  }>
  /**
   * Shed isolation tier, orientation-free labels. Names TODO(verify).
   */
  isolation: {
    tier: 'shed-isolated' | 'shed-scratch' | 'shed-trusted'
  }
  /** Abstract egress declarations, NO endpoints. See §5. */
  egress: ReadonlyArray<{
    /** Named capability class, resolved by the Ganglion broker. */
    capability: string
    purpose: string
  }>
  /** Identity of the packager; attest step binds to this. TODO(verify). */
  publisher: { id: string; signingKeyId: string }
}
```

Rules:

- `permissions` is *requests*, not facts. The grant step (§3) writes
  `role_permissions` rows for a Sucker-scoped role only after an admin
  approves them; two identical requests from different Suckers do not
  interfere because deny-wins evaluation is per-principal.
- No wildcard permissions in v0 (`@shield/access` evaluates exact pairs
  only). A Sucker needing 40 actions declares 40 rows so revocation is
  surgical.
- `id` changes create a new principal; upgrades keep `id` and bump
  `version`.

### Example manifest

Generic threat-intel Sucker, placeholder host only (`octopusshield.invalid`
is explicitly allowed as a doc placeholder; real endpoints live in
Ganglion broker configuration, never in manifests):

```json
{
  "id": "threat-intel-generic",
  "version": "0.1.0",
  "kind": "threat-intel",
  "permissions": [
    { "resourceKind": "ioc-record", "action": "query" },
    { "resourceKind": "audit-events", "action": "consult" }
  ],
  "isolation": { "tier": "shed-t0" },
  "egress": [
    { "capability": "external.ioc-reputation", "purpose": "file/ip/domain reputation lookups" }
  ],
  "publisher": { "id": "octopusshield.invalid/publisher/example", "signingKeyId": "TODO(verify)" }
}
```

## 2. Isolation — Shed tiers

Shed is the isolation vocabulary (a Sucker "sheds" everything it carried
when the lease ends). Three tiers, strongest first; tier names are
`TODO(verify)` against whatever Shed implementation Scaffold lands:

| Tier | Guarantees (abstract) |
| --- | --- |
| `shed-t0` | No host filesystem, no ambient network; all I/O is brokered and logged; ephemeral workspace, wiped at lease end. |
| `shed-t1` | Brokered egress and a named scratch volume inside the Shed; still no host fs. |
| `shed-t2` | Trusted Suckers only (core authorship); narrow shared-memory channel to the host, audit-logged per call. |

Invariants:

- Lower tier ⊂ higher tier's restrictions. A manifest may request a tier;
  install refuses tiers above the sucker kind's ceiling.
  `TODO(verify)`: does `reporting-sink` have a different ceiling than
  `threat-intel`?
- Shed teardown is the Inkout trigger point for local scratch data (§6).

## 3. Lifecycle

```
install → attest → grant → invoke ⤳ (repeat) → revoke → shed-wipe
```

1. **install** — manifest is parsed and validated against this contract
   (`typed` schema; unknown fields reject). The Sucker is registered in
   state `installed-not-attested`, holding zero authority.
2. **attest** — platform verifies the artifact matches the publisher
   declaration (signature over manifest + artifact hash).
   `TODO(verify)`: mechanism — signed bundle vs in-transit attestation is
   undecided. Failure is terminal for that install attempt; retry is a
   fresh install event. Every step (including failures) writes an
   `audit_events` row with `actor_kind='sucker'` and the Sucker id as
   `actor_id`.
3. **grant** — an `owner`/`admin` human approves the requested permission
   rows; the approval writes `role_permissions` rows on a Sucker-scoped
   role and binds the principal (`users.user_id` is not reused; Suckers
   get their own principal id and roles). Partial grants are allowed: a
   Sucker may be granted fewer permissions than requested and must
   degrade gracefully (see `permissionDenied` on §4).
4. **invoke** — each call is one capability exchange through the broker.
   The broker re-evaluates `evaluate()` per call; grant changes take
   effect immediately.
   **Contract invariant (revocation completeness):** the broker must not
   cache grant results across invokes. If caching is ever introduced
   (perf), it must be bounded by a TTL *and* fail closed on stall
   (deny-on-stall) — a cached grant that survives a revoke is a contract
   violation. `collectRoleGrants` snapshots are per-call inputs, never held.
5. **revoke** — removing `role_permissions` rows, or the whole role,
   strands the Sucker: next invoke gets `permissionDenied` and the
   lifecycle reports the Sucker `revoked`. Revocation must not require
   cooperation from the Sucker process (deny-wins is enforced broker-side).
6. **shed-wipe** — after revoke (or shed lease expiry), Shed destroys
   the workspace and scratch data; Inkout logs the completion event.
   `TODO(verify)`: wipe verification method.

## 4. Capability surface (typed)

The runtime capability surface is deliberately *generic*: providers are
named in broker configuration, not in the contract, so the same type
serves VirusTotal, OTX, AbuseIPDB, GreyNoise, or a future intel source.
Payload shapes are abstract JSON envelopes; provider mapping lives with
the broker.

```ts
type SuckerRequest = {
  suckerId: string
  /** Query kind declared by the Sucker's kind + broker catalog. */
  queryKind: string
  /** Opaque, JSON-serializable query body (see §4.1). */
  payload: Record<string, unknown>
  traceId: string | null
  issuedAtEpochMs: number
}

type SuckerResponse =
  | { outcome: 'satisfied'; payload: Record<string, unknown>; traceId: string | null }
  | { outcome: 'empty'; traceId: string | null }
  | { outcome: 'permissionDenied'; because: 'explicit-deny' | 'no-grant'; traceId: string | null }
  | { outcome: 'upstream-failure'; retryable: boolean; traceId: string | null }
```

The `permissionDenied.because` values re-use the `PermissionDecision`
vocabulary from `@shield/access/permission-evaluate` — one evaluation
semantics for humans, Tentacles, engines, and Suckers.

### 4.1 Generic threat-intel queries

All threat-intel Suckers speak the same generic interface:

```ts
/** Abstract IOCs; providers translate to their native lookups. */
type IocQueryRequest = {
  ioc: { type: 'file-hash' | 'ip' | 'domain' | 'url'; value: string }
}

/** Threat actor / campaign context, abstract. */
type AttributionQueryRequest = {
  subject: { type: 'actor' | 'campaign' | 'malware-family'; identifier: string }
}

/** Noise/telemetry context (GreyNoise-style), abstract. */
type NoiseQueryRequest = {
  source: { type: 'ip'; value: string }
}
```

Mapping table (`capability` → query kinds; provider bindings
`TODO(verify)` at wiring time):

| Sucker | Capability class | Query kinds |
| --- | --- | --- |
| VirusTotal Sucker | `external.ioc-reputation` | IocQueryRequest |
| OTX Sucker | `external.ioc-reputation`, `external.threat-attribution` | IocQueryRequest, AttributionQueryRequest |
| AbuseIPDB Sucker | `external.ioc-reputation` | IocQueryRequest (`file-hash` unsupported by class → broker `upstream-failure`) |
| GreyNoise Sucker | `external.host-noise` | NoiseQueryRequest |

No endpoint URLs, API versions, or auth wire details belong in this
contract. The broker holds them, per-Ganglion deployment, and Inkout
redacts them from any exported config (§6).

## 5. Egress broker

- Suckers never open sockets directly at `shed-t0`/`shed-t1`. Each
  `SuckerRequest` is one brokered capability call; the broker checks the
  grant (`evaluate()`), stamps `traceId`, and forwards.
- `egress.capability` in the manifest must match the broker catalog,
  otherwise install warns and attest fails.
  `TODO(verify)`: hard-fail vs degrade-with-warning.
- All egress attempts — allowed or denied — land in `audit_events` with
  `actor_kind='sucker'`, `resource_kind=capability`, and a redacted-safe
  payload (§6).

## 6. Inkout redaction hook points

Inkout must be able to strip secrets/personal data from every surface a
Sucker touches, without mutating the append-only ledger. Hook points:

1. **Ingress payloads** — broker request/response envelopes pass through
   Inkout's field-level classifier before they reach a Sucker or are
   written anywhere; marked fields (`secret_*`, credentials, tokens)
   become sealed values, replaced with references.
2. **Ledger hygiene** — `audit_events.payload` must be redaction-safe at
   write time (references, not secrets). Post-write redaction is
   *forward-only*: an `inkout.redact` compensating event referencing the
   target row and field set; the append-only guard trigger in
   `infra/db/audit.sql` enforces this mechanically.
3. **Shed scratch** — teardown wipes and logs; a failed wipe is an
   audit-noted exception, never silent.
4. **Exports/exports-to-mobile** — any capability snapshot leaving the
   Ganglion (renderer history, mobile mirror, support bundles) goes
   through the same classifier, honoring viewer-role visibility rules.
5. **Mfa/secrets** — Sucker manifests never carry credentials; broker-held
   provider keys are Inkout-sealed, mirroring the `mfa_factors`
   `secret_ciphertext` rule in `infra/db/rbac.sql`.

## 7. Open questions

- `TODO(verify)`: attest mechanism (signed bundle vs live attestation).
- `TODO(verify)`: Shed tier ceiling per Sucker kind (labels are now
  orientation-free: `shed-isolated` / `shed-scratch` / `shed-trusted`).
- `TODO(verify)`: broker egress-match failure policy (hard-fail vs warn).
- `TODO(verify)`: whether `kind: 'custom'` survives review or splits
  into concrete kinds (until then: owner-approval only, see §1).
- **RESOLVED for revocation completeness**: Sucker principal storage — a
  dedicated `sucker_principals` sibling table is REQUIRED before grant or
  revoke code lands (§3 revoke can't be verified complete otherwise); not
  merged into `tentacle_principals`, which stays Tentacle-only by name
  domain.

## 8. Vocabulary (locked — EXPANSION_PLAN_V1.1 §1/§6)

- **Suckers** are plugins; they are NOT Tentacles (§ lifecycle uses
  Sucker-scoped roles, never Tentacle roles).
- **Shed** is the isolation engine; tiers above.
- **Inkout** is redaction; hook points §6.
- **Ganglion** is the agent graph/broker fabric referenced in §5.
- **Gardens** are isolated operation contexts per engagement/tenant/drill
  (digital-twin War Games, feature #12) — deployment context type, not a
  plugin property.
- **SPAR** is the platform's signature self-fight loop: adversary
  Tentacles attack a Garden twin of the estate while Sentinel Tentacles
  defend; a referee scores every exchange by ATT&CK technique. Engine
  feeds: Caldera (abilities/adversaries) + Mythic (tradecraft) — the
  adapters in `@shield/engine-clients` this contract's broker shares.
