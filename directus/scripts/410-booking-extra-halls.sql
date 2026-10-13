-- Migration 410: a hall booking takes only the training's EXTRA hall it overlaps.
--
-- Migration 409's sweep (kscw-endpoints/src/hall-bookings.js) trims or cancels a
-- training when a booking covers its PRIMARY hall, and ignored `extra_halls`
-- (migration 370) altogether. A team that trains in KWI B and takes KWI A as well
-- from 18:30 kept "KWI A" on the plan while a friendly booked KWI A 19:00–21:00.
--
-- Owner decision (13.10.2026): when a booking hits only an extra hall, the
-- training keeps its time in its main hall and, for that day, loses the extra
-- hall where the booking overlaps — narrowed to its longest free part, or dropped
-- when under 30 minutes would be left — and gets it back when the booking moves,
-- is cancelled or vanishes. Needs:
--
--   trainings.original_extra_halls — `extra_halls` as planned before a booking
--                          narrowed it (same json shape); NULL when untouched.
--   trainings.extra_halls_adjusted_by_booking — which booking did it
--                          ('calendar:<hall_events.id>' | 'event:<events.id>').
--                          Its own marker, NOT auto_adjusted_by_booking: that one
--                          tells the game sweep to keep off the row's TIMES, and a
--                          training that only lost an extra hall must still be
--                          shortened by its own game as before.
--
-- The slot cascade clears both when it rewrites `extra_halls` from the slot, so
-- the sweep re-plans from the new slot shape (it runs right after the cascade).
-- Registered in directus_fields so the items API hands them to the app.
-- Schema-only + idempotent.

BEGIN;

ALTER TABLE trainings ADD COLUMN IF NOT EXISTS original_extra_halls json;
ALTER TABLE trainings ADD COLUMN IF NOT EXISTS extra_halls_adjusted_by_booking text;

CREATE INDEX IF NOT EXISTS idx_trainings_extra_halls_adjusted_by_booking
  ON trainings (extra_halls_adjusted_by_booking)
  WHERE extra_halls_adjusted_by_booking IS NOT NULL;

INSERT INTO directus_fields (collection, field, special, interface, readonly, hidden, note)
SELECT 'trainings', 'original_extra_halls', 'cast-json', 'input-code', true, true,
       'extra_halls as planned before a hall booking narrowed or dropped one of them; restored when the booking moves/vanishes (sweep-managed, migration 410).'
WHERE NOT EXISTS (
  SELECT 1 FROM directus_fields df WHERE df.collection = 'trainings' AND df.field = 'original_extra_halls'
);

INSERT INTO directus_fields (collection, field, interface, readonly, hidden, note)
SELECT 'trainings', 'extra_halls_adjusted_by_booking', 'input', true, true,
       'Hall booking that narrowed or dropped one of this training''s extra halls: calendar:<hall_events.id> or event:<events.id> (sweep-managed, migration 410).'
WHERE NOT EXISTS (
  SELECT 1 FROM directus_fields df WHERE df.collection = 'trainings' AND df.field = 'extra_halls_adjusted_by_booking'
);

COMMIT;
