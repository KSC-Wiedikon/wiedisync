-- Migration 113: record WHEN a booking was confirmed / manually entered.
--
-- Companion to migration 112 (confirmed_by_*): the dashboard "Confirmed by …"
-- audit line should also show the date+time. date_updated is unreliable for this
-- (a later VM push bumps it), so we capture a dedicated confirmed_at at the exact
-- moment of confirm-home / confirm-away / manual-booking.
--
-- Schema-only + idempotent per the CLAUDE.md migration policy. No permission row
-- needed: both scheduling read policies grant fields ['*'] on this collection, so
-- the new column is readable automatically. Registered with Directus so the items
-- API returns it. Backfill of existing rows (confirmed_at := date_updated, the
-- best available proxy) is an operational step run at deploy time, not baked here.

BEGIN;

ALTER TABLE game_scheduling_bookings
  ADD COLUMN IF NOT EXISTS confirmed_at timestamptz;

-- Register the field with Directus so the items API reads it.
INSERT INTO directus_fields (collection, field, special, interface, sort, width, note)
SELECT 'game_scheduling_bookings', 'confirmed_at', NULL, 'datetime', 64, 'half',
       'When this booking was confirmed or manually entered (captured at action time).'
WHERE NOT EXISTS (
  SELECT 1 FROM directus_fields f
  WHERE f.collection = 'game_scheduling_bookings' AND f.field = 'confirmed_at'
);

COMMIT;
