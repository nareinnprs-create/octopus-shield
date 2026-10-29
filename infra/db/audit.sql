-- Octopus Shield Nucleus — append-only audit ledger (PostgreSQL 16).
-- Run against db `octopusshield` (user `octopus`, host port 5435 per
-- infra/docker-compose.nucleus.yml). Idempotent: safe to re-run.
--
-- Hash chain
-- ----------
-- Each row commits to its predecessor. App-side composition (selected for
-- byte-stable canonicalization; verification recomputes this, NOT Postgres
-- jsonb text output — see TODO(verify) below):
--
--   entry_hash = hex(sha256( 'osh-audit-v1' || 0x1F || prev_hash || 0x1F || actor_kind
--                     || 0x1F || actor_id || 0x1F || action || 0x1F || resource_kind
--                     || 0x1F || resource_id || 0x1F || coalesce(trace_id, '')
--                     || 0x1F || ts_epoch_milliseconds || 0x1F || payload_json ))
--
-- - `payload_json` is stable-order JSON (object keys sorted, no undefined
--   members) produced by @shield/access `audit-chain.ts` (src/packages/access).
-- - The genesis row carries prev_hash = '000...000' (64 zeros).
-- - Why app-side: Postgres `jsonb::text` re-orders keys, so recomputing here
--   would not match writer hashes. TODO(verify): confirm we keep app-side
--   canonicalization before adding a SQL-side verifier job.
-- - A rewritten row is tamper EVIDENCE (its entry_hash breaks its
--   successor's prev_hash), not prevention; the guard trigger below blocks
--   in-place edits so column drift cannot hide silently.
--   TODO(verify): decide whether a parity watchdog (Ganglion scheduled job)
--   also pins the max(ts,id) entry_hash off-chain (e.g. Redis key).
--
-- Inkout redaction
-- ----------------
-- This ledger is append-only, so Inkout never mutates payload in place. A
-- redaction is recorded as a compensating event with action
-- 'inkout.redact' whose payload references the target row and the redacted
-- field set; renderers must merge forward. If in-place page rewriting is
-- later mandated, the guard trigger must be dropped deliberately and the
-- chain rebuilt from a signed snapshot — see docs/sucker-contract.md.

BEGIN;

CREATE TABLE IF NOT EXISTS audit_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ts            timestamptz NOT NULL DEFAULT now(),
  actor_kind    text NOT NULL CHECK (actor_kind IN ('human', 'tentacle', 'sucker', 'engine')),
  actor_id      text NOT NULL,
  action        text NOT NULL,
  resource_kind text NOT NULL,
  resource_id   text NOT NULL,
  trace_id      text,
  payload       jsonb,
  prev_hash     text CHECK (prev_hash ~ '^[0-9a-f]{64}$'),
  entry_hash    text NOT NULL CHECK (entry_hash ~ '^[0-9a-f]{64}$'),
  -- Control chars in composed fields would make the 0x1F-separated
  -- canonical composition ambiguous (field shift); rejected in depth at the
  -- writer, mirrored here.
  CONSTRAINT audit_events_no_control_chars CHECK (
    actor_id      !~ '[\x00-\x1f\x7f]'
AND action        !~ '[\x00-\x1f\x7f]'
AND resource_kind !~ '[\x00-\x1f\x7f]'
AND resource_id   !~ '[\x00-\x1f\x7f]'
AND (trace_id IS NULL OR trace_id !~ '[\x00-\x1f\x7f]')
  )
);

CREATE INDEX IF NOT EXISTS audit_events_ts_idx
  ON audit_events (ts);
CREATE INDEX IF NOT EXISTS audit_events_actor_id_idx
  ON audit_events (actor_id);
CREATE INDEX IF NOT EXISTS audit_events_resource_idx
  ON audit_events (resource_kind, resource_id);

-- Chain anti-fork: one row may claim a given prev_hash (genesis '000…0'
-- included); concurrent writers lose the race instead of branching.
CREATE UNIQUE INDEX IF NOT EXISTS audit_events_prev_hash_unique
  ON audit_events (prev_hash);

COMMENT ON TABLE audit_events IS
  'Append-only Shield audit ledger. Row integrity: entry_hash chains onto the previous row by ts order (prev_hash stores the predecessor entry_hash; genesis = 64 zeros). Inkout redaction is forward-only via compensating events, never in-place edits.';

COMMENT ON COLUMN audit_events.prev_hash IS
  'entry_hash of the preceding ledger row; 64 hex chars, all-zero for genesis. Null only if the row was imported without chain context — treat as unverified.';

COMMENT ON COLUMN audit_events.entry_hash IS
  'sha256 over the canonical event composition defined at the top of this file (see @shield/access audit-chain-sha256.ts for the writer).';

-- Append-only enforcement: reject in-place UPDATE/DELETE from every caller.
-- Still revocable by a superuser for a deliberate Inkout snapshot-rebuild.
CREATE OR REPLACE FUNCTION audit_events_append_only_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION
    'audit_events is append-only; % rejected (Inkout redacts via compensating events)',
    TG_OP;
END;
$$;

DROP TRIGGER IF EXISTS audit_events_append_only ON audit_events;
CREATE TRIGGER audit_events_append_only
  BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION audit_events_append_only_guard();

GRANT SELECT, INSERT ON audit_events TO octopus;

COMMIT;
