-- Migration 125: per-member iCal feed token.
--
-- Adds members.ical_token — a stable, unguessable secret that scopes the
-- personal iCal subscription feed (?source=duties&token=…) to one member, so a
-- subscriber sees their OWN scorer/scoreboard duties auto-populate their
-- calendar app. The public team feed (/kscw/ical?team=…) is anonymous and
-- unchanged; only the personal `duties` source consults this token.
--
-- The token only ever exposes a duty SCHEDULE (game time + opponent + a link
-- back into the app) — never PII. Roster/DoB stays behind the authenticated,
-- time-gated /kscw/scorer/game/:id/roster endpoint. A leaked token is therefore
-- low-impact and rotatable via POST /kscw/me/ical-token/rotate.
--
-- Backfill assigns every existing member a token now; members created later get
-- one lazily on first GET /kscw/me/ical-token (handled in the endpoint).
--
-- Schema-only + idempotent. No permission change — the field is read only via
-- the custom endpoint (raw knex), never granted on the items API.

BEGIN;

-- 1) Column.
ALTER TABLE members ADD COLUMN IF NOT EXISTS ical_token varchar(64);

-- 2) Backfill existing rows with a random 32-char hex token (uuid sans dashes).
--    gen_random_uuid() is built into Postgres core (>= 13), no extension needed.
UPDATE members
   SET ical_token = replace(gen_random_uuid()::text, '-', '')
 WHERE ical_token IS NULL;

-- 3) Uniqueness. NULLs (future rows pre-lazy-gen) are allowed multiple times by
--    a standard unique index, which is exactly what we want.
CREATE UNIQUE INDEX IF NOT EXISTS members_ical_token_key ON members (ical_token);

-- 4) Register in directus_fields so the admin Data Model shows it — hidden +
--    readonly because it's a secret set by the system, never hand-edited.
INSERT INTO directus_fields (collection, field, special, interface, readonly, hidden, sort, note)
SELECT 'members', 'ical_token', NULL, 'input', true, true, 200,
       'Personal iCal subscription token (system-set). Scopes the duties feed; rotate via POST /kscw/me/ical-token/rotate.'
WHERE NOT EXISTS (
  SELECT 1 FROM directus_fields df WHERE df.collection = 'members' AND df.field = 'ical_token'
);

COMMIT;
