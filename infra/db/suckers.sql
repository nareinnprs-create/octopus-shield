-- Octopus Shield Nucleus — Sucker plugin registry and grants (PostgreSQL 16).
-- Run against db `octopusshield` (user `octopus`, host port 5435 per
-- infra/docker-compose.nucleus.yml). Idempotent: safe to re-run.
--
-- Complements infra/db/rbac.sql, which this file deliberately does NOT
-- modify: sucker_grants mirrors the role_permissions row shape (exact
-- (resource_kind, action) facts with allow/deny effect) on a Sucker-scoped
-- role, and deny-wins evaluation stays in @shield/access
-- (permission-evaluate.ts) — the DB never scores permissions itself.
-- Default-deny: absence of a row grants nothing.
--
-- Capability rows use resource_kind = 'sucker.capability' with the egress
-- capability name as action, matching @shield/suckers SuckerBroker.invoke.
--
-- No cross-file FKs yet: docs/sucker-contract.md §7 requires a dedicated
-- sucker_principals sibling before grant/revoke code can be verified
-- complete, at which point suckers.id becomes that principal reference and
-- sucker_grants.sucker_id gains its FK. Until then both tables stand alone.
--
-- Inkout: manifest_json holds no credentials (contract §6.5 — manifests
-- never carry secrets) and grant rows are facts, so neither column needs a
-- sealed-ciphertext rule like rbac.sql mfa_factors.secret_ciphertext.

BEGIN;

CREATE TABLE IF NOT EXISTS suckers (
  id             text PRIMARY KEY
                 CHECK (id ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(id) <= 64),
  version        text NOT NULL
                 CHECK (version ~ '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z.-]+)?$'),
  kind           text NOT NULL CHECK (kind IN ('threat-intel', 'enrichment-feed', 'reporting-sink')),
  isolation_tier text NOT NULL CHECK (isolation_tier IN ('shed-isolated', 'shed-scratch', 'shed-trusted')),
  publisher_id   text NOT NULL,
  signing_key_id text NOT NULL,
  status         text NOT NULL DEFAULT 'installed'
                 CHECK (status IN ('installed', 'attested', 'granted', 'revoked', 'wiped')),
  -- Canonical manifest copy for drift detection against the artifact the
  -- attest step (TODO(verify) mechanism) will bind.
  manifest_json  jsonb NOT NULL,
  installed_at   timestamptz NOT NULL DEFAULT now(),
  revoked_at     timestamptz,
  -- Revocation state and its timestamp are co-present, mirroring the
  -- sessions mfa copresence pattern in rbac.sql.
  CONSTRAINT suckers_revoked_at_copresence CHECK ((status = 'revoked') = (revoked_at IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS sucker_grants (
  sucker_id     text NOT NULL,
  resource_kind text NOT NULL,
  action        text NOT NULL,
  effect        text NOT NULL CHECK (effect IN ('allow', 'deny')),
  granted_by    text,
  granted_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (sucker_id, resource_kind, action)
);

CREATE INDEX IF NOT EXISTS sucker_grants_sucker_id_idx ON sucker_grants (sucker_id);

COMMIT;
