-- Migration 195: J+S (Jugend+Sport) export support.
--
-- Adds members.js_id (J+S Personennummer / BASPO "SALTO" number) plus a ClubDesk
-- staging column for a fill-only down-sync, and two events columns (js_relevant +
-- js_activity_type) that power the per-event "in scope for J+S" toggle in
-- EventForm. Together these feed the coach-gated /kscw/js-export endpoint, which
-- builds the two NDS import CSVs (activities + Anwesenheitskontrolle) per team and
-- season.
--
-- js_id is a personal federal identifier: it is NEVER exposed through the items
-- API to coaches (the LEADER member-read scope excludes it by omission — it's not
-- in MEMBER_VISIBLE_FIELDS / LEADER_TEAM_MEMBER_FIELDS). The export endpoint reads
-- it with the service role and gates on coach/TR/admin of the requested team.
--
-- Schema-only + idempotent (repo policy #2). Permissions live in
-- setup-permissions.mjs — the events full-field LEADER grants already cover the
-- two new columns ('*'), and js_id deliberately gets NO items-API read grant.

BEGIN;

-- 1. members.js_id — J+S Personennummer. Stored as text to preserve any leading
--    zeros. Editable by admins in the Directus UI (input interface) so numbers
--    ClubDesk lacks can be entered by hand.
ALTER TABLE members ADD COLUMN IF NOT EXISTS js_id varchar(32);
COMMENT ON COLUMN members.js_id IS
  'J+S / BASPO Personennummer (SALTO). ClubDesk-owned, down-sync fill-only. Surfaced only through the gated /kscw/js-export endpoint, never the items API.';

INSERT INTO directus_fields (collection, field, special, interface, sort, hidden, note)
SELECT 'members', 'js_id', NULL, 'input', 26, false,
  'J+S Personennummer (SALTO). Filled from ClubDesk; hand-editable for members ClubDesk does not cover.'
WHERE NOT EXISTS (
  SELECT 1 FROM directus_fields WHERE collection = 'members' AND field = 'js_id'
);

-- 2. ClubDesk staging column. The 064 CREATE TABLE IF NOT EXISTS is a no-op on
--    existing DBs, so a new staging column needs its own ALTER (the same gap the
--    wiedisync_id column hit).
ALTER TABLE clubdesk_export ADD COLUMN IF NOT EXISTS js_id text;

-- 3. events J+S opt-in. Trainings + games are always in scope automatically;
--    events opt in per-event via the EventForm toggle. js_activity_type picks the
--    NDS activity type when js_relevant is set.
ALTER TABLE events ADD COLUMN IF NOT EXISTS js_relevant boolean NOT NULL DEFAULT false;
ALTER TABLE events ADD COLUMN IF NOT EXISTS js_activity_type varchar(32);
COMMENT ON COLUMN events.js_relevant IS 'Coach opt-in: include this event in the J+S activity/attendance export.';
COMMENT ON COLUMN events.js_activity_type IS 'NDS J+S activity type when js_relevant: Training | Wettkampf | Trainingstag | Lagertag.';

INSERT INTO directus_fields (collection, field, special, interface, options, sort, hidden, note)
SELECT 'events', 'js_relevant', 'cast-boolean', 'boolean', NULL, 40, false,
  'Include this event in the J+S export (Jugend+Sport).'
WHERE NOT EXISTS (
  SELECT 1 FROM directus_fields WHERE collection = 'events' AND field = 'js_relevant'
);

INSERT INTO directus_fields (collection, field, special, interface, options, sort, hidden, note)
SELECT 'events', 'js_activity_type', NULL, 'select-dropdown',
  '{"choices":[{"text":"Training","value":"Training"},{"text":"Wettkampf","value":"Wettkampf"},{"text":"Trainingstag","value":"Trainingstag"},{"text":"Lagertag","value":"Lagertag"}]}',
  41, false,
  'J+S activity type used when this event is in scope.'
WHERE NOT EXISTS (
  SELECT 1 FROM directus_fields WHERE collection = 'events' AND field = 'js_activity_type'
);

COMMIT;
