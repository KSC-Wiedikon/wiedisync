-- Migration 325: every hall-administration calendar entry is a closure — with a
-- per-entry admin override.
--
-- The KWI calendar belongs to the school's Hausdienst. Until now `gcal-sync`
-- decided what counted as a closure with a KEYWORD TEST
-- (geschlossen|gesperrt|reserv|turnier|…), which fails on exactly the input a
-- hand-typed calendar produces: `Halle Resveiert für Prüfung` (24.–26.10.2026)
-- does not match `reserv`, so the hall read FREE while the school had it booked
-- for an exam — with six KWI trainings standing on Monday 26.10. A keyword list
-- can only ever be one typo behind.
--
-- The rule is inverted: anything the hall administration puts on that calendar
-- closes the hall, and a human decides the exceptions. Measured against the live
-- feed before the flip, that changes exactly ONE of 19 future entries — the exam
-- reservation above; the other 18 already matched.
--
-- `closure_override` is that human decision, and it must OUTLIVE the nightly
-- reconcile: `hall_events` rows are upserted by `uid` and only deleted when the
-- entry leaves the feed, so the flag rides along. NULL = automatic (closes the
-- hall), false = admin says this one does not close anything, true = admin
-- confirms it does (same effect as NULL, but recorded as a decision so the next
-- person does not re-litigate it).
--
-- `end_date` exists because the override could not work without it: a multi-day
-- entry was stored with its START date only (the span lived in the ICS DTEND and
-- was thrown away after the closure rows were written), so nothing outside the
-- sync could reconstruct which days an entry covers. Inclusive, like
-- hall_closures.end_date — NOT the ICS's exclusive DTEND.
--
-- Schema-only, idempotent, additive. No permission change: `hall_events` is
-- already a Member read / Sport-Admin CRUD collection with no field list, and
-- the toggle itself goes through an admin-gated custom endpoint.

BEGIN;

ALTER TABLE hall_events ADD COLUMN IF NOT EXISTS end_date date;
ALTER TABLE hall_events ADD COLUMN IF NOT EXISTS closure_override boolean;

COMMENT ON COLUMN public.hall_events.end_date IS
  'Last day the entry covers, INCLUSIVE (the ICS DTEND is exclusive for all-day '
  'events and is converted on import). NULL = single-day, same as `date`. Needed so '
  'the closure span can be recomputed outside a sync run.';

COMMENT ON COLUMN public.hall_events.closure_override IS
  'Does this calendar entry close the KWI halls? NULL = automatic — since migration '
  '325 every hall-administration entry closes them. false = admin override, closes '
  'nothing (its hall_closures rows are removed and the auto-cancelled trainings come '
  'back). true = admin confirmed it closes, recorded so the decision is not '
  're-litigated. Only meaningful for source = gcal.';

-- Backfill the span for existing rows so nothing reads NULL as "unknown" —
-- every pre-325 row was single-day as far as the schema could tell.
UPDATE hall_events SET end_date = date WHERE end_date IS NULL AND date IS NOT NULL;

-- Register both so the items API and the admin UI can read them. Sorted after
-- `all_day` (the other span-shaped field) and `source`.
INSERT INTO directus_fields (collection, field, interface, options, readonly, hidden, sort, width, note)
SELECT 'hall_events', 'end_date', 'datetime', NULL::json, false, false, 40, 'half',
       'Last day covered, inclusive. NULL/equal to date = single day.'
WHERE NOT EXISTS (
  SELECT 1 FROM directus_fields WHERE collection = 'hall_events' AND field = 'end_date'
);

INSERT INTO directus_fields (collection, field, interface, options, readonly, hidden, sort, width, note)
SELECT 'hall_events', 'closure_override', 'boolean', NULL::json, false, false, 41, 'half',
       'Closes the KWI halls? Empty = automatic (yes). Off = admin override, closes nothing. On = admin confirmed.'
WHERE NOT EXISTS (
  SELECT 1 FROM directus_fields WHERE collection = 'hall_events' AND field = 'closure_override'
);

COMMIT;

-- Verification (dev/prod):
--   \d hall_events                                              -- end_date date, closure_override boolean
--   SELECT count(*) FROM hall_events WHERE end_date IS NULL AND date IS NOT NULL;   -- → 0
--   SELECT count(*) FROM directus_fields
--     WHERE collection='hall_events' AND field IN ('end_date','closure_override');  -- → 2
