-- Migration 409: hall bookings trim or cancel only the trainings they overlap.
--
-- Until now EVERY entry on the KWI hall administration's calendar became a
-- whole-day closure of KWI A, B and C (migration 325). Right for "Halle
-- geschlossen"; wrong for a friendly: "Freundschaftsspiel BB DU18 FIRE - Zürich
-- 93 DU16 (Halle C)", 22.10.2026 18:30–20:00, cancelled six trainings in three
-- halls for an evening where one hall was busy for 90 minutes. And the club had
-- no way to book a hall itself — `events.hall` existed but nothing used it.
--
-- A HALL BOOKING is now either
--   • a timed, single-day entry on the hall calendar (hall_events) — on the
--     halls it names, all KWI halls when it names none; or
--   • a club event with a hall (`events.hall` + `events.additional_halls`),
--     booked by an admin from the event form.
-- The sweep in kscw-endpoints/src/hall-bookings.js trims each overlapping
-- training to its longest free part, or cancels it when under 30 minutes would
-- be left, and undoes that when the booking moves or disappears. It needs:
--
--   trainings.auto_adjusted_by_booking — which booking did it: 'calendar:<hall_events.id>'
--                          or 'event:<events.id>'. Text, no FK: both tables delete
--                          rows the sweep must still be able to restore from.
--   trainings.original_start_time — start before a booking trimmed the front.
--                          The end side reuses migration 191's original_end_time;
--                          the game sweep never touches a row carrying the
--                          booking marker, so the two cannot both own it.
--   events.additional_halls — further hall ids the event books (json array, same
--                          shape as games.additional_halls).
--
-- AND nothing from that calendar takes effect any more until an admin APPROVES
-- it. hall_events.closure_override keeps its three values but changes meaning:
--   NULL  = pending  (was: automatic — closes)   → does nothing
--   true  = approved (was: confirmed — closes)   → closes / books
--   false = refused  (was: override — no effect) → does nothing
-- The sync drops an entry back to NULL when the hall administration moves it.
-- Backfill: every upcoming entry that is in effect today and is NOT a timed
-- single-day entry (i.e. a real whole-day closure) is grandfathered as approved,
-- so this deploy does not reinstate trainings in halls that really are shut.
-- Timed single-day entries stay pending — under the old rule they closed whole
-- days, which is the bug; an admin decides each one (the friendly above).
--
-- Registered in directus_fields so the items API hands them to the app.
-- Schema-only + idempotent (the backfill only ever moves NULL → true).

BEGIN;

ALTER TABLE trainings ADD COLUMN IF NOT EXISTS auto_adjusted_by_booking text;
ALTER TABLE trainings ADD COLUMN IF NOT EXISTS original_start_time time;
ALTER TABLE events ADD COLUMN IF NOT EXISTS additional_halls json;

CREATE INDEX IF NOT EXISTS idx_trainings_auto_adjusted_by_booking
  ON trainings (auto_adjusted_by_booking)
  WHERE auto_adjusted_by_booking IS NOT NULL;

-- A booked event is looked up by hall on every sweep.
CREATE INDEX IF NOT EXISTS idx_events_booked_hall
  ON events (hall)
  WHERE hall IS NOT NULL;

INSERT INTO directus_fields (collection, field, interface, readonly, hidden, note)
SELECT 'trainings', 'auto_adjusted_by_booking', 'input', true, true,
       'Hall booking that trimmed or cancelled this training: calendar:<hall_events.id> or event:<events.id> (sweep-managed, migration 409).'
WHERE NOT EXISTS (
  SELECT 1 FROM directus_fields df WHERE df.collection = 'trainings' AND df.field = 'auto_adjusted_by_booking'
);

INSERT INTO directus_fields (collection, field, interface, readonly, hidden, note)
SELECT 'trainings', 'original_start_time', 'input', true, true,
       'Start time before a hall booking trimmed the front of the training; restored when the booking moves/vanishes (migration 409).'
WHERE NOT EXISTS (
  SELECT 1 FROM directus_fields df WHERE df.collection = 'trainings' AND df.field = 'original_start_time'
);

INSERT INTO directus_fields (collection, field, special, interface, readonly, hidden, note)
SELECT 'events', 'additional_halls', 'cast-json', 'tags', false, false,
       'Further hall ids this event books besides `hall` (e.g. KWI A+B). Trainings there are trimmed or cancelled (migration 409). Null or empty = one hall.'
WHERE NOT EXISTS (
  SELECT 1 FROM directus_fields df WHERE df.collection = 'events' AND df.field = 'additional_halls'
);

COMMENT ON COLUMN public.hall_events.closure_override IS
  'Admin decision on a hall-administration calendar entry (migration 409). NULL = '
  'pending: does nothing until decided. true = approved: closes the halls it names '
  '(all KWI when none) for whole days, or, when timed and single-day, books them for '
  'its window. false = refused: does nothing. The sync resets it to NULL when the '
  'entry moves. Only meaningful for source = gcal.';

UPDATE directus_fields
SET note = 'Approved? Empty = pending (no effect yet). On = approved: closes / books the halls. Off = refused, no effect. Reset to empty when the hall administration moves the entry.'
WHERE collection = 'hall_events' AND field = 'closure_override';

UPDATE hall_events
SET closure_override = true
WHERE source = 'gcal'
  AND closure_override IS NULL
  AND COALESCE(end_date, date) >= CURRENT_DATE
  AND NOT (
    all_day IS NOT TRUE
    AND start_time IS NOT NULL AND end_time IS NOT NULL AND end_time > start_time
    AND COALESCE(end_date, date) = date
  );

COMMIT;
