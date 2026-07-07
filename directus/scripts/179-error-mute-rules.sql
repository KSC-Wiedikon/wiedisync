-- Class-level mute rules for the error log.
--
-- A per-hash annotation (error_annotations) only hides ONE occurrence — the
-- hash is md5(ts|event|error) and ts is millisecond-precise, so the same noise
-- reappears tomorrow with a fresh hash. A mute rule instead hides EVERY entry
-- matching (event + case-insensitive substring of the error message) from the
-- default error-log view. Entries are retained in the JSONL and revealed by the
-- "Show archived" toggle (?show_solved=true). Read by GET /kscw/admin/error-logs
-- and managed via /kscw/admin/error-logs/mute-rules. Raw-knex-only, like
-- error_annotations — not a Directus collection, no directus_fields registration.

CREATE TABLE IF NOT EXISTS error_mute_rules (
  id SERIAL PRIMARY KEY,
  event VARCHAR(64),                       -- match this event type; NULL = any event
  error_match TEXT NOT NULL,               -- case-insensitive substring match on the error message
  note TEXT,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  date_created TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  user_created UUID REFERENCES directus_users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_error_mute_rules_enabled ON error_mute_rules(enabled);

-- Seed the two known-noise categories (idempotent — WHERE NOT EXISTS guards re-runs).
INSERT INTO error_mute_rules (event, error_match, note)
SELECT 'auth_error', 'Invalid user credentials', 'Wrong password/email at login — expected user error, not a bug.'
WHERE NOT EXISTS (
  SELECT 1 FROM error_mute_rules WHERE event = 'auth_error' AND error_match = 'Invalid user credentials'
);

INSERT INTO error_mute_rules (event, error_match, note)
SELECT 'network_error', 'Load failed', 'Transient mobile-network drop — the request never reached the server.'
WHERE NOT EXISTS (
  SELECT 1 FROM error_mute_rules WHERE event = 'network_error' AND error_match = 'Load failed'
);
