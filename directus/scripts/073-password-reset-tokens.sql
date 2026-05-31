-- Migration 073: dedicated `password_reset_tokens` table for the hardened
-- password-reset flow.
--
-- Security audit 2026-05-31 (High): the old /kscw/password-request flow wrote a
-- random value into `directus_users.token` and mailed it in the reset link.
-- `directus_users.token` is Directus's STATIC API access token column — a
-- full-privilege bearer credential that Directus accepts on any request and
-- that ignores the custom `token_expires_at` column. A leaked reset link was
-- therefore a full API credential for that user (and for 24h, per the old TTL).
--
-- The fix moves the reset secret out of `directus_users.token` entirely:
-- password-reset.js now stores only a SHA-256 *hash* of a 256-bit random secret
-- in this dedicated table (single active token per user, 1-hour TTL), and the
-- /kscw/set-password Mode-2 consumer validates against it (hash lookup, expiry
-- check, single-use delete). The plaintext secret exists only inside the
-- emailed link and is useless against the Directus API.
--
-- This table is BACKEND-ONLY: it is accessed solely via knex inside the
-- kscw-endpoints extension and is intentionally NOT registered as a Directus
-- collection, so it is never reachable through the REST/GraphQL API.
--
-- Schema-only + idempotent. After applying, regenerate the SCHEMA.sql baseline
-- (`npm run db:baseline:dev` / `:prod`) so a fresh install carries this table,
-- and null any stale `directus_users.token` values left by the old flow
-- (operational — see SECURITY.md 2026-05-31).

BEGIN;

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id          SERIAL PRIMARY KEY,
  "user"      UUID NOT NULL REFERENCES directus_users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT password_reset_tokens_user_unique UNIQUE ("user")
);

-- Lookup is by token_hash on every /set-password Mode-2 call.
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_hash
  ON password_reset_tokens (token_hash);

-- Sweep helper: expired rows are also cleaned opportunistically by the app, but
-- an index on expiry keeps any housekeeping cheap.
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_expires
  ON password_reset_tokens (expires_at);

COMMIT;

-- =============================================================================
-- Verification (read-only):
-- =============================================================================
-- SELECT to_regclass('public.password_reset_tokens');  -- expect: password_reset_tokens
-- \d password_reset_tokens
