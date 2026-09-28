-- Migration 392: allow more than one outstanding password-reset link per user.
--
-- Website audit 2026-09-28, F-37. Migration 073 created `password_reset_tokens`
-- with UNIQUE("user"), and /kscw/password-request deleted every earlier token
-- before issuing a new one. That let ANYONE who knows a member's address cancel
-- the member's pending reset link just by requesting another one.
--
-- password-reset.js now keeps the newest MAX_LIVE_TOKENS (3) live links per user
-- (plain INSERT, no ON CONFLICT), purges expired ones on every request, and
-- POST /kscw/set-password deletes every remaining link for the account once a
-- password has been set. Each token stays single-use (claimed with
-- DELETE … RETURNING on token_hash). Until this migration runs the endpoint falls
-- back to the old replace-the-token behaviour on a 23505, so the order of
-- deploying the extension and applying this migration does not matter.
--
-- The unique constraint was also the only index on "user"; the endpoint filters
-- by "user" on every request, so a plain index replaces it.
--
-- Schema-only + idempotent (DROP … IF EXISTS / CREATE INDEX IF NOT EXISTS).

BEGIN;

ALTER TABLE password_reset_tokens
  DROP CONSTRAINT IF EXISTS password_reset_tokens_user_unique;

CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user
  ON password_reset_tokens ("user");

COMMIT;

-- Verify:
-- SELECT conname FROM pg_constraint
--  WHERE conrelid = 'public.password_reset_tokens'::regclass;
--   -- expect: password_reset_tokens_pkey, password_reset_tokens_user_fkey (no _user_unique)
-- \d password_reset_tokens
