-- Migration 380: per-ride team choice + return time for car pooling.
--
-- Follow-up to 378/379 after first use on prod (Trainingsweekend H3 + D1):
--
--   carpools.teams        jsonb team-id list: which of the activity's invited
--                         teams an OFFER is for. NULL/[] = all of them. A driver
--                         from H3 can offer "H3 only" on a board open to H3 and
--                         D1. Distinct from the activity-level `carpool_teams`
--                         (379), which decides who sees the board at all.
--   carpools.return_time  the departure time of the way back, used when the ride
--                         goes "there & back" — people may leave at different
--                         times (a per-day participation), so the return leg
--                         needs its own clock. `departure_time` stays the
--                         outbound (or, for a back-only ride, the return) time.
--
-- Both enforced in kscw-endpoints/src/carpools.js (endpoint-only tables): an
-- offer for other teams is hidden from, and refuses, members outside them.
--
-- Schema-only + idempotent. No directus_fields rows — the tables are not
-- registered in Directus (see 378).

BEGIN;

ALTER TABLE carpools ADD COLUMN IF NOT EXISTS teams jsonb;
ALTER TABLE carpools ADD COLUMN IF NOT EXISTS return_time time without time zone;

ALTER TABLE carpools DROP CONSTRAINT IF EXISTS carpools_teams_array;
ALTER TABLE carpools
  ADD CONSTRAINT carpools_teams_array
  CHECK (teams IS NULL OR jsonb_typeof(teams) = 'array');

COMMENT ON COLUMN carpools.teams IS
  'Offer only: team ids this ride is for (subset of the activity''s invited teams). NULL/[] = every team that can see the board. Migration 380.';
COMMENT ON COLUMN carpools.return_time IS
  'Departure time of the way back for a there-and-back ride. NULL = not set / not applicable. Migration 380.';

COMMIT;
