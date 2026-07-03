-- Migration 167: one-time signup invite tokens (member-bound).
--
-- Open self-registration is being closed: a WiediSync account can only be
-- created by redeeming a single-use invite token that is BOUND TO AN EXISTING
-- members row. Tokens are minted (a) automatically when a website Anmeldung is
-- approved (kscw-hooks registrations approval hook) and (b) manually by
-- coach/TR/vorstand/admin for an existing account-less member
-- (POST /kscw/signup-invites/create). Because the token resolves to a member
-- row, account creation no longer depends on email equality — which closes the
-- divergent-email duplicate-member window (DEVLOG 2026-06-30 merge batch).
--
-- Storage discipline copies password_reset_tokens (migration 073): only the
-- SHA-256 hash of the 256-bit secret is stored; the plaintext exists solely in
-- the emailed link; redemption deletes the row up-front (single-use). One
-- active token per member (previous rows deleted on mint). TTL 30 days,
-- matching members.shell_expires.
--
-- This table is BACKEND-ONLY: accessed solely via knex inside kscw-endpoints /
-- kscw-hooks and intentionally NOT registered as a Directus collection, so it
-- is never reachable through the REST/GraphQL API.
--
-- Schema-only + idempotent. After applying, regenerate the SCHEMA.sql baseline
-- (`npm run db:baseline:prod`) so fresh installs carry this table.

BEGIN;

CREATE TABLE IF NOT EXISTS signup_tokens (
  id          SERIAL PRIMARY KEY,
  member      INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL,
  minted_by   INTEGER REFERENCES members(id) ON DELETE SET NULL,
  minted_via  VARCHAR(20) NOT NULL DEFAULT 'staff', -- 'staff' | 'registration'
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT signup_tokens_member_unique UNIQUE (member)
);

-- Lookup is by token_hash on every info/redeem call.
CREATE INDEX IF NOT EXISTS idx_signup_tokens_hash
  ON signup_tokens (token_hash);

-- Sweep helper for expiry housekeeping.
CREATE INDEX IF NOT EXISTS idx_signup_tokens_expires
  ON signup_tokens (expires_at);

COMMIT;

-- =============================================================================
-- Verification (read-only):
-- =============================================================================
-- SELECT to_regclass('public.signup_tokens');  -- expect: signup_tokens
-- \d signup_tokens
