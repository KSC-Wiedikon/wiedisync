-- Migration 261: game-clash markers — own-team training cancel + two-team member decline.
--
-- Two rules (2026-07-28):
--   1. A team's own training on a day that team has a scheduled game (home OR
--      away) is auto-cancelled — the squad is at the game, the calendar showed
--      both. Sweep-managed in kscw-hooks/src/game-training-shorten.js, reusing
--      trainings.auto_shortened_by_game + the migration-191 restore machinery
--      (game moves/cancels/vanishes → training un-cancelled). No new trainings
--      column needed.
--   2. A member playing in two teams is auto-declined from team B's training
--      when their OTHER team A has a same-day game (note "Game <team A>").
--      That needs its own marker: participations.auto_declined_by already
--      means "absences.id" (migration 028) and a games.id would collide with
--      absence ids, corrupting both unwind paths. Hence:
--
-- participations.auto_declined_by_game — games.id that caused the decline.
--   Plain integer, no FK (same reasoning as 028/191): games rows are routinely
--   deleted/recreated by sv-sync; the sweep treats a dangling id as "unwind".
--
-- trg_participations_clear_auto_marker gains the same detach rule migration
-- 038 gave auto_declined_by: a user-driven status flip (marker untouched in
-- the same UPDATE) clears the marker, so the sweep never re-fights a manual
-- override. The sweep's own writes set status + marker together, which the
-- guard deliberately preserves.
--
-- Schema-only + idempotent.

BEGIN;

ALTER TABLE participations ADD COLUMN IF NOT EXISTS auto_declined_by_game integer;

CREATE INDEX IF NOT EXISTS idx_participations_auto_declined_by_game
  ON participations (auto_declined_by_game)
  WHERE auto_declined_by_game IS NOT NULL;

CREATE OR REPLACE FUNCTION trg_participations_clear_auto_marker()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NEW.auto_declined_by IS NOT DISTINCT FROM OLD.auto_declined_by THEN
    NEW.auto_declined_by := NULL;
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NEW.auto_declined_by_game IS NOT DISTINCT FROM OLD.auto_declined_by_game THEN
    NEW.auto_declined_by_game := NULL;
  END IF;
  RETURN NEW;
END;
$$;

INSERT INTO directus_fields (collection, field, interface, readonly, hidden, note)
SELECT 'participations', 'auto_declined_by_game', 'input', true, true,
       'games.id of the member''s other team''s same-day game that auto-declined this training RSVP (sweep-managed, migration 261).'
WHERE NOT EXISTS (
  SELECT 1 FROM directus_fields df
  WHERE df.collection = 'participations' AND df.field = 'auto_declined_by_game'
);

COMMIT;
