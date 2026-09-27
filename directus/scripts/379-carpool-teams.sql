-- Migration 379: open a car pooling board to chosen teams only.
--
-- Follow-up to 378. A shared activity — an event several teams are invited to
-- (a Trainingsweekend, a club tournament), or a game opened to guest teams
-- (migration 271) — is seen by every one of those teams, so its rides board
-- was too. The person setting the activity up now decides which of those teams
-- the board is for: "H1 and H3 share cars to the away game", not the whole
-- guest list.
--
--   carpool_teams = NULL or []  → open to everyone who can see the activity
--                                  (the 378 behaviour, and the default)
--   carpool_teams = [3, 9]      → only players / coaches / TRs of teams 3 and 9
--                                  (plus anyone who already has a ride on it,
--                                  so narrowing never strands a passenger)
--
-- The check lives in kscw-endpoints/src/carpools.js (the tables are endpoint-
-- only); this column is only the setting. It sits on the activity row so it is
-- written through the items API with the activity's own update grant — the
-- same people who may switch the board on may scope it. Trainings get no
-- column: a training has exactly one team, there is nothing to choose.
--
-- ⚠ `games` writes by coaches/spielplaner are field allow-listed —
-- `carpool_teams` joins GAME_WRITE_FIELDS in setup-permissions.mjs in the same
-- commit, or the coach's PATCH 403s.
--
-- ⚠ Restart the container after applying (raw directus_fields insert does not
-- bust the schema cache).
--
-- Schema-only + idempotent.

BEGIN;

ALTER TABLE games  ADD COLUMN IF NOT EXISTS carpool_teams jsonb;
ALTER TABLE events ADD COLUMN IF NOT EXISTS carpool_teams jsonb;

ALTER TABLE games DROP CONSTRAINT IF EXISTS games_carpool_teams_array;
ALTER TABLE games
  ADD CONSTRAINT games_carpool_teams_array
  CHECK (carpool_teams IS NULL OR jsonb_typeof(carpool_teams) = 'array');
ALTER TABLE events DROP CONSTRAINT IF EXISTS events_carpool_teams_array;
ALTER TABLE events
  ADD CONSTRAINT events_carpool_teams_array
  CHECK (carpool_teams IS NULL OR jsonb_typeof(carpool_teams) = 'array');

COMMENT ON COLUMN games.carpool_teams IS
  'Car pooling scope (migration 379): team ids the rides board is open to — the playing team and/or its guest teams. NULL/[] = everyone who can see the game.';
COMMENT ON COLUMN events.carpool_teams IS
  'Car pooling scope (migration 379): team ids the rides board is open to. NULL/[] = everyone who can see the event.';

INSERT INTO directus_fields (collection, field, special, interface, options, readonly, hidden, sort, width, note)
SELECT v.c, 'carpool_teams', 'cast-json', 'input-code', '{"language":"json"}'::json, false, false, 62, 'half',
       'Car pooling: team ids the rides board is open to. Empty = everyone who can see this activity.'
  FROM (VALUES ('games'), ('events')) AS v(c)
 WHERE NOT EXISTS (
   SELECT 1 FROM directus_fields f WHERE f.collection = v.c AND f.field = 'carpool_teams'
 );

COMMIT;

-- Verification:
--   SELECT count(*) FROM games  WHERE carpool_teams IS NOT NULL;   -- → 0
--   SELECT collection FROM directus_fields WHERE field = 'carpool_teams';  -- → games, events
