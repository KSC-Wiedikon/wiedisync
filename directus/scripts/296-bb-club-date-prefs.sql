-- 296-bb-club-date-prefs.sql
--
-- A club tells us which DATES suit it. It does not book a pitch.
--
-- WHY THIS REPLACES THE PICK-A-SLOT MODEL
-- ---------------------------------------
-- The portal let a club tick a date, and that wrote a `basketball_slot_plan` row, which the
-- migration-278 trigger turns into a claim on one `basketball_slots` candidate. Two things were
-- wrong with that, and they pull in opposite directions:
--
--   TOO SPECIFIC — a slot is (date, time, hall). Lions D1 has up to three times on one
--   Saturday, so ticking 14.11 silently chose ONE of them, picked by our own ranking. The club
--   meant "we can travel that day"; the system recorded "we take 11:00 in KWI A+B".
--
--   TOO STRONG — that claim removed the pitch from every other club immediately, making the
--   popular Saturdays first-come-first-served among 64 clubs, decided by who opened their mail
--   first rather than by what fits the hall.
--
-- The club's real answer is an availability, exactly like the volleyball opponent's. Allocation
-- — which time, which hall, which of several interested clubs — is ours, and happens once we
-- can see everyone's answers instead of racing them against each other.
--
-- So: preferences live here, claim NOTHING, and a planner still creates the actual
-- `basketball_slot_plan` row when it places the game. Migration 295's floor claims keep
-- guarding those real placements; nothing about that changes.
--
-- ⚠ One row per (season, club, our team, date) — the fixture is implied by the pairing, since
-- a club meets each of our teams once at home. UNIQUE makes a re-submit converge instead of
-- accumulating duplicates.
--
-- ⚠ Deliberately NOT linked to `basketball_slots`. A preference must survive the inventory
-- being regenerated (the planner may re-run the generator any number of times before the
-- Spielplansitzung), and tying it to a candidate row would delete the club's answer with it.
--
-- Schema-only. Idempotent.

BEGIN;

CREATE TABLE IF NOT EXISTS basketball_club_date_prefs (
  id              serial PRIMARY KEY,
  season          integer NOT NULL REFERENCES game_scheduling_seasons(id) ON DELETE CASCADE,
  -- The opponent club that answered.
  bp_club         integer NOT NULL REFERENCES basketplan_clubs(id) ON DELETE CASCADE,
  -- Our team they would be playing.
  kscw_team       integer NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  date            date    NOT NULL,
  note            text,
  -- Public routes have no accountability.user, so the actor lives on the row
  -- (CLAUDE.md → Audit logging, documented option b).
  responder_name  text,
  responder_email text,
  date_created    timestamptz NOT NULL DEFAULT now(),
  date_updated    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bb_club_date_prefs_uniq UNIQUE (season, bp_club, kscw_team, date)
);

-- The planner's view: "who can come on this date, for this team?"
CREATE INDEX IF NOT EXISTS bb_club_date_prefs_team_date_idx
  ON basketball_club_date_prefs (season, kscw_team, date);
-- The portal's view: "what did this club already tell us?"
CREATE INDEX IF NOT EXISTS bb_club_date_prefs_club_idx
  ON basketball_club_date_prefs (season, bp_club);

COMMENT ON TABLE basketball_club_date_prefs IS
  'Dates an opponent club says suit it, per KSCW team, collected through the club portal. A PREFERENCE, not a booking: it claims no hall slot and blocks no other club. The planner allocates time and hall afterwards by creating a basketball_slot_plan row, which is what actually holds the floor (migrations 278 + 295). Not linked to basketball_slots on purpose — regenerating the candidate inventory must not delete a club''s answer.';

INSERT INTO directus_collections
  (collection, icon, color, hidden, singleton, collapse, versioning, status, archive_app_filter, note)
SELECT 'basketball_club_date_prefs', 'event_available', '#e8590c', false, false, 'open', false, 'active', true,
       'Dates opponent clubs said suit them, per team. Preferences — they hold no hall slot.'
WHERE NOT EXISTS (
  SELECT 1 FROM directus_collections c WHERE c.collection = 'basketball_club_date_prefs'
);

INSERT INTO directus_fields (collection, field, special, interface, sort, width, note, readonly, hidden)
SELECT 'basketball_club_date_prefs', v.field, v.special, v.interface, v.sort, v.width, v.note, v.readonly, false
FROM (VALUES
  ('season',          NULL,           'select-dropdown-m2o', 1, 'half', 'Scheduling season.', true),
  ('bp_club',         NULL,           'select-dropdown-m2o', 2, 'half', 'The opponent club that answered.', true),
  ('kscw_team',       NULL,           'select-dropdown-m2o', 3, 'half', 'Our team they would play.', true),
  ('date',            NULL,           'datetime',            4, 'half', 'A date that suits them. Time and hall are ours to allocate.', false),
  ('note',            NULL,           'input-multiline',     5, 'full', 'Their remark on this date.', false),
  ('responder_name',  NULL,           'input',               6, 'half', 'Who at the club answered.', true),
  ('responder_email', NULL,           'input',               7, 'half', NULL, true),
  ('date_created',    'date-created', 'datetime',            8, 'half', NULL, true),
  ('date_updated',    'date-updated', 'datetime',            9, 'half', NULL, true)
) AS v(field, special, interface, sort, width, note, readonly)
WHERE NOT EXISTS (
  SELECT 1 FROM directus_fields f
  WHERE f.collection = 'basketball_club_date_prefs' AND f.field = v.field
);

DO $$
DECLARE sid integer; cid integer; tid integer; n integer;
BEGIN
  SELECT id INTO sid FROM game_scheduling_seasons WHERE season = '2026/27';
  SELECT id INTO cid FROM basketplan_clubs WHERE is_own_club IS NOT TRUE ORDER BY id LIMIT 1;
  SELECT id INTO tid FROM teams WHERE sport = 'basketball' AND active ORDER BY id LIMIT 1;
  IF sid IS NULL OR cid IS NULL OR tid IS NULL THEN
    RAISE EXCEPTION 'migration 296: missing season/club/team fixture for the self-test';
  END IF;

  INSERT INTO basketball_club_date_prefs (season, bp_club, kscw_team, date)
  VALUES (sid, cid, tid, DATE '2099-02-07');
  -- A re-submit must converge, not duplicate.
  INSERT INTO basketball_club_date_prefs (season, bp_club, kscw_team, date)
  VALUES (sid, cid, tid, DATE '2099-02-07')
  ON CONFLICT (season, bp_club, kscw_team, date) DO NOTHING;

  SELECT count(*) INTO n FROM basketball_club_date_prefs WHERE date = DATE '2099-02-07';
  IF n <> 1 THEN RAISE EXCEPTION 'migration 296: expected 1 row after re-submit, got %', n; END IF;

  -- The point of the whole table: it must claim no floor.
  IF EXISTS (SELECT 1 FROM basketball_floor_claims WHERE date = DATE '2099-02-07') THEN
    RAISE EXCEPTION 'migration 296: a preference claimed a floor — it must not';
  END IF;

  DELETE FROM basketball_club_date_prefs WHERE date = DATE '2099-02-07';
  RAISE NOTICE 'migration 296: date preferences ready (unique per club+team+date, hold nothing)';
END $$;

COMMIT;
