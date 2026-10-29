-- Octopus Shield Nucleus — RBAC, MFA, principals, sessions (PostgreSQL 16).
-- Run against db `octopusshield` (user `octopus`, host port 5435 per
-- infra/docker-compose.nucleus.yml). Idempotent: safe to re-run. Run after
-- (or independently of) audit.sql; there are no cross-file FKs yet.
-- TODO(verify): when audit_events gains FKs to principals, audit.sql must
-- run after this file — keep that ordering in the DB README.
--
-- Permissions: role_permissions rows are exact (resource_kind, action) facts
-- with an effect of allow or deny. Deny-wins evaluation is implemented in
-- @shield/access (permission-evaluate.ts) which consumes these rows; the DB
-- never scores permissions itself. Default-deny: absence of a row grants
-- nothing.
--
-- Inkout redaction hook: secret_ciphertext in mfa_factors is sealed material
-- owned by Inkout (never logged, never selected by application roles);
-- sessions rows redact their ids/user ids through the same compensating-event
-- pattern as audit_events when retention expires. See docs/sucker-contract.md.

BEGIN;

CREATE TABLE IF NOT EXISTS roles (
  id          smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name        text NOT NULL UNIQUE,
  kind        text NOT NULL
              CHECK (kind IN ('owner', 'admin', 'operator', 'auditor', 'viewer', 'tentacle')),
  description text
);

CREATE TABLE IF NOT EXISTS users (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Human-facing login identifier. TODO(verify): confirm the upstream
  -- identity source (local directory vs external IdP subject) before the
  -- first client ships; login_name stays regardless.
  login_name  text NOT NULL UNIQUE,
  display_name text NOT NULL,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_roles (
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role_id smallint NOT NULL REFERENCES roles (id) ON DELETE RESTRICT,
  granted_by text,
  granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, role_id)
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id       smallint NOT NULL REFERENCES roles (id) ON DELETE CASCADE,
  resource_kind text NOT NULL,
  action        text NOT NULL,
  effect        text NOT NULL CHECK (effect IN ('allow', 'deny')),
  PRIMARY KEY (role_id, resource_kind, action)
);

-- The seven Tentacles are system principals and always exist; Tentacles get
-- their authority through role rows joined here, not ad-hoc grants.
CREATE TABLE IF NOT EXISTS tentacle_principals (
  name     text PRIMARY KEY
           CHECK (name IN ('archivist', 'scaffold', 'forge', 'inkwell', 'prism', 'sentinal-7', 'verifier')),
  system   boolean NOT NULL DEFAULT true,
  enrolled_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  mfa_satisfied boolean NOT NULL DEFAULT false,
  -- Delivery-state co-presence is a schema invariant: a session marked
  -- satisfied must record the method that satisfied it.
  mfa_method    text,
  CONSTRAINT sessions_mfa_copresence CHECK (mfa_satisfied = (mfa_method IS NOT NULL)),
  CONSTRAINT sessions_mfa_method_value CHECK (mfa_method IN ('totp', 'webauthn')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  CONSTRAINT sessions_expiry_after_creation CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions (user_id);
CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions (expires_at);

CREATE TABLE IF NOT EXISTS mfa_factors (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  type               text NOT NULL CHECK (type IN ('totp', 'webauthn')),
  -- Inkout-sealed ciphertext of the enrollment secret; NEVER store plaintext
  -- here and never log selects against this column.
  secret_ciphertext  bytea NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  last_used_at       timestamptz
);

-- TODO(verify): uniqueness policy — is one 'totp' + one 'webauthn' per user
-- the invariant, or is multi-factor enrollment allowed? Add a partial
-- UNIQUE index once decided.

CREATE INDEX IF NOT EXISTS mfa_factors_user_id_idx ON mfa_factors (user_id);

-- Seed data ----------------------------------------------------------------

-- Five human tiers.
-- Vocabulary (EXPANSION_PLAN_V1.1.md §1): Gardens are isolated operation
-- contexts per engagement/tenant/drill (feature #12), managed here at
-- "admin" tier. SPAR is the signature self-fight loop (§6) these roles govern.
INSERT INTO roles (name, kind, description) VALUES
  ('owner',    'owner',    'Full control including Shed tier changes and Inkout policy'),
  ('admin',    'admin',    'Manages users, Suckers, and Gardens; no Inkout policy'),
  ('operator', 'operator', 'Day-to-day operation of Tentacles and Suckers'),
  ('auditor',  'auditor',  'Read-only over the audit ledger and chain state'),
  ('viewer',   'viewer',   'Read-only over non-secret Shield surfaces')
ON CONFLICT (name) DO NOTHING;

-- The seven Tentacle principals (brand-locked names).
INSERT INTO tentacle_principals (name) VALUES
  ('archivist'), ('scaffold'), ('forge'), ('inkwell'),
  ('prism'), ('sentinal-7'), ('verifier')
ON CONFLICT (name) DO NOTHING;

GRANT SELECT ON roles, users, user_roles, role_permissions,
  tentacle_principals TO octopus;
-- The app connection manages its own session lifecycle only. Authority
-- (roles/user_roles/role_permissions) and mfa_factors secret material are
-- deliberately out of reach: rewrite them via the DDL/admin path, a
-- SECURITY DEFINER helper, or a superuser — never from the app role.
GRANT SELECT, INSERT, UPDATE ON sessions TO octopus;

COMMIT;
