-- Migration 328: hall_closures.push_to_gcal — put OUR blocked dates on the
-- hall administration's calendar, one closure at a time, by choice.
--
-- The sync has been two-way since 2026-07, but only for GAMES: `gcal-push.js`
-- writes `games` rows with type='home' in a KWI hall and nothing else. A
-- `hall_closures` row we create — a tournament, a club event, a Sperrdatum —
-- has never been pushed, so it is invisible to the school. Found on 2026-08-18:
-- both VB U20 Tournament blocks (13.12.2026 and 07.03.2027) are blocked in
-- wiedisync and absent from the KWI calendar, i.e. as far as the Hausdienst is
-- concerned those halls are free.
--
-- ⚠⚠ DEFAULT false — opt-in, never automatic. That calendar belongs to the
-- school; we hold write access because the club account could grant it, not
-- because the entries are ours. A default of true would, on the first sync
-- after this migration, bulk-write every closure we hold into someone else's
-- calendar — including the ones that CAME from it (source='gcal') and the
-- Zurich school holidays they enter themselves. Those two sources are excluded
-- in code as well; this default is the belt to that braces.
--
-- ⚠ The flag is set per ROW but decided per GROUP: a KWI closure is three rows
-- (hall A/B/C) and the calendar convention is ONE entry naming the halls, so
-- the UI writes all rows of a (start_date, end_date, reason) group together and
-- the pusher emits one event per group.
--
-- ⚠ Duplicate suppression is NOT stored here. Whether the Hausdienst already
-- covers a span is derived at push time from the `hall_events` mirror of their
-- calendar, because their entry can appear or disappear at any time and a
-- cached boolean would go stale silently — the exact failure this whole feature
-- exists to fix.
--
-- Schema-only, idempotent, additive. No permission change: `hall_closures` is
-- already Member-read / Sport-Admin-CRUD with no field list.

BEGIN;

ALTER TABLE hall_closures ADD COLUMN IF NOT EXISTS push_to_gcal boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.hall_closures.push_to_gcal IS
  'Publish this closure to the hall administration''s Google calendar (KSCW Heimspiele/Halle KWI)? '
  'Default false — opt-in per closure, because that calendar is the school''s. Ignored for '
  'source IN (''gcal'',''school_holidays''): the first came FROM that calendar and the second is '
  'theirs to enter. Set for every row of a (start_date, end_date, reason) group at once; the '
  'pusher emits ONE event per group naming the halls. A span the Hausdienst already covers is '
  'skipped at push time (derived from hall_events), never pushed as a duplicate.';

-- Register so the items API + admin UI can read it. Sits after `source` (the
-- other "where does this closure come from / go to" field).
INSERT INTO directus_fields (collection, field, interface, options, readonly, hidden, sort, width, note)
SELECT 'hall_closures', 'push_to_gcal', 'boolean', NULL::json, false, false, 30, 'half',
       'Publish to the hall administration''s Google calendar. Off by default — that calendar is the school''s.'
WHERE NOT EXISTS (
  SELECT 1 FROM directus_fields WHERE collection = 'hall_closures' AND field = 'push_to_gcal'
);

COMMIT;

-- Verification (dev/prod):
--   \d hall_closures                                                  -- push_to_gcal boolean NOT NULL DEFAULT false
--   SELECT count(*) FROM hall_closures WHERE push_to_gcal;            -- → 0 immediately after this migration
--   SELECT count(*) FROM directus_fields
--     WHERE collection='hall_closures' AND field='push_to_gcal';      -- → 1
