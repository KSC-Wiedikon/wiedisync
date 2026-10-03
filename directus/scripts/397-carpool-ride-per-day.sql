-- Migration 397: car pooling — one ride per way PER DAY.
--
-- 393 allowed one offer and one request per member per activity per way. A
-- two-day tournament breaks that: a parent who drives there and back on
-- Saturday and again on Sunday needs two Going and two Return rides. The
-- uniques gain `departure_date`, so a member gets one offer and one request
-- per activity, way and day. The UI warns before a second ride on a day that
-- already has one; this index is the backstop.
--
-- `departure_date` becomes NOT NULL: the endpoint always writes it (393), and
-- a NULL would slip past the unique (NULLs are distinct).
--
-- Endpoint-only table (378): no directus_fields rows, no permission rows.
-- Schema only, idempotent.

BEGIN;

-- Safety backfill (393 already did it; the endpoint never writes NULL).
UPDATE carpools c SET departure_date = g.date
  FROM games g WHERE c.game = g.id AND c.departure_date IS NULL;
UPDATE carpools c SET departure_date = t.date
  FROM trainings t WHERE c.training = t.id AND c.departure_date IS NULL;
UPDATE carpools c
   SET departure_date = CASE
         WHEN c.direction = 'back' THEN (COALESCE(e.end_date, e.start_date) AT TIME ZONE 'Europe/Zurich')::date
         ELSE (e.start_date AT TIME ZONE 'Europe/Zurich')::date
       END
  FROM events e WHERE c.event = e.id AND c.departure_date IS NULL;

ALTER TABLE carpools ALTER COLUMN departure_date SET NOT NULL;

COMMENT ON COLUMN carpools.departure_date IS
  'Day of departure for this ride (393). Part of the per-member unique (397): one offer and one request per activity, way and day.';

DROP INDEX IF EXISTS carpools_game_member_kind_dir_uq;
DROP INDEX IF EXISTS carpools_training_member_kind_dir_uq;
DROP INDEX IF EXISTS carpools_event_member_kind_dir_uq;
CREATE UNIQUE INDEX IF NOT EXISTS carpools_game_member_kind_dir_day_uq
  ON carpools (game, member, kind, direction, departure_date) WHERE game IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS carpools_training_member_kind_dir_day_uq
  ON carpools (training, member, kind, direction, departure_date) WHERE training IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS carpools_event_member_kind_dir_day_uq
  ON carpools (event, member, kind, direction, departure_date) WHERE event IS NOT NULL;

COMMIT;

-- Verification:
--   SELECT count(*) FROM carpools WHERE departure_date IS NULL;   -- → 0
--   \d carpools                                                   -- *_dir_day_uq
