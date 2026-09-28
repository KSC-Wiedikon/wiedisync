-- Migration 393: car pooling split into two boards — Going and Return.
--
-- Until now one ride could go "there & back" (direction 'both'), with one
-- passenger list for both ways and a bare `return_time` clock for the way home
-- (380). Feedback after first use: the way back is its own car pool. People
-- leave at different times and on different days, and who rides home with whom
-- is not who rode there. So:
--
--   * every ride (offer or request) is for ONE way: 'there' (Going tab) or
--     'back' (Return tab). 'both' is gone;
--   * each ride carries its own departure DATE next to its time
--     (`departure_date`, NULL = the activity's day — kept only for safety, the
--     endpoint always writes it). A multi-day event's return is on its last day;
--   * passengers belong to one way, because they belong to one ride row;
--   * one offer and one request per member per activity PER WAY (the uniques
--     gain `direction`), so a driver can offer both ways as two rides;
--   * a ride's direction is immutable, like its kind — moving it would carry
--     its passengers onto the other board.
--
-- Existing 'both' rows are split: the row becomes the Going ride, a copy with
-- `departure_time := return_time` becomes the Return ride, and its passengers
-- are copied into it (they had a seat both ways). `return_time` is cleared and
-- no longer written (kept as a column only so the extension deployed before
-- this migration does not break mid-deploy).
--
-- Endpoint-only tables (378): no directus_fields rows, no permission rows.
-- Schema + one-off backfill, idempotent (the split loop only sees 'both' rows,
-- which the new CHECK then forbids).

BEGIN;

ALTER TABLE carpools ADD COLUMN IF NOT EXISTS departure_date date;

COMMENT ON COLUMN carpools.departure_date IS
  'Day of departure for this ride (migration 393). Going: usually the activity''s first day; Return: its last. NULL = the activity''s day.';
COMMENT ON COLUMN carpools.return_time IS
  'DEPRECATED (migration 393): a return is now its own ride row with direction = ''back''. Always NULL.';

-- Uniques per way, before the split inserts the Return copies.
DROP INDEX IF EXISTS carpools_game_member_kind_uq;
DROP INDEX IF EXISTS carpools_training_member_kind_uq;
DROP INDEX IF EXISTS carpools_event_member_kind_uq;
CREATE UNIQUE INDEX IF NOT EXISTS carpools_game_member_kind_dir_uq
  ON carpools (game, member, kind, direction) WHERE game IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS carpools_training_member_kind_dir_uq
  ON carpools (training, member, kind, direction) WHERE training IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS carpools_event_member_kind_dir_uq
  ON carpools (event, member, kind, direction) WHERE event IS NOT NULL;

-- Split every there-and-back ride into a Going and a Return ride.
DO $$
DECLARE
  r carpools%ROWTYPE;
  v_new integer;
BEGIN
  FOR r IN SELECT * FROM carpools WHERE direction = 'both' ORDER BY id LOOP
    INSERT INTO carpools (game, training, event, kind, member, direction, seats,
                          departure_time, departure_location, notes, teams, date_created)
    VALUES (r.game, r.training, r.event, r.kind, r.member, 'back', r.seats,
            r.return_time, r.departure_location, r.notes, r.teams, r.date_created)
    RETURNING id INTO v_new;
    INSERT INTO carpool_passengers (carpool, passenger, seats, added_by_name, date_created)
      SELECT v_new, p.passenger, p.seats, p.added_by_name, p.date_created
        FROM carpool_passengers p
       WHERE p.carpool = r.id;
    UPDATE carpools SET direction = 'there', return_time = NULL WHERE id = r.id;
  END LOOP;
END $$;

UPDATE carpools SET return_time = NULL WHERE return_time IS NOT NULL;

ALTER TABLE carpools ALTER COLUMN direction SET DEFAULT 'there';
ALTER TABLE carpools DROP CONSTRAINT IF EXISTS carpools_direction_check;
ALTER TABLE carpools
  ADD CONSTRAINT carpools_direction_check CHECK (direction IN ('there', 'back'));

-- Backfill the day: games/trainings have one; an event's Going ride is on its
-- first Zurich day, its Return ride on its last.
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

-- Direction is immutable, like kind (378's guard, extended).
CREATE OR REPLACE FUNCTION trg_carpools_guard() RETURNS trigger AS $$
DECLARE
  v_taken integer;
BEGIN
  IF NEW.kind <> OLD.kind THEN
    RAISE EXCEPTION 'carpool_kind_immutable' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.direction <> OLD.direction THEN
    RAISE EXCEPTION 'carpool_direction_immutable' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.game IS DISTINCT FROM OLD.game
     OR NEW.training IS DISTINCT FROM OLD.training
     OR NEW.event IS DISTINCT FROM OLD.event THEN
    RAISE EXCEPTION 'carpool_activity_immutable' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.kind = 'offer' AND NEW.seats < OLD.seats THEN
    SELECT COALESCE(sum(seats), 0) INTO v_taken FROM carpool_passengers WHERE carpool = NEW.id;
    IF NEW.seats < v_taken THEN
      RAISE EXCEPTION 'carpool_seats_below_taken' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  NEW.date_updated := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMIT;

-- Verification:
--   SELECT direction, count(*) FROM carpools GROUP BY 1;            -- no 'both'
--   SELECT count(*) FROM carpools WHERE departure_date IS NULL;     -- → 0
--   SELECT count(*) FROM carpools WHERE return_time IS NOT NULL;    -- → 0
