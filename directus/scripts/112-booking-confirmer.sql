-- Migration 112: record WHO on the KSCW side confirmed / manually entered a booking.
--
-- Companion to migration 111 (proposed_by_* = the opponent-club person). This
-- captures the KSCW spielplaner/admin who CONFIRMED a proposal (confirm-home /
-- confirm-away) or who created a manual booking (manual-booking) — resolved from
-- the authenticated member at action time, stored denormalised on the booking so
-- the dashboard can show a "Confirmed by …" audit line per game. One pair covers
-- both confirmed proposals and manual entries (for a manual booking the creator
-- IS the confirmer; admin_notes='Manuell erfasst' already marks the manual ones).
--
-- Schema-only + idempotent per the CLAUDE.md migration policy. No permission row
-- is needed: both scheduling read policies grant fields ['*'] on this collection
-- (setup-permissions.mjs), so the new columns are readable automatically. They
-- are registered with Directus so the items API returns them + the admin UI
-- shows them. Backfill of existing rows ("attribute to me") is an operational
-- step run at deploy time, not baked here (it needs the live member identity).

BEGIN;

ALTER TABLE game_scheduling_bookings
  ADD COLUMN IF NOT EXISTS confirmed_by_name  text,
  ADD COLUMN IF NOT EXISTS confirmed_by_email text;

-- Register each field with Directus so the items API reads them.
INSERT INTO directus_fields (collection, field, special, interface, sort, width, note)
SELECT 'game_scheduling_bookings', v.field, NULL, 'input', v.sort, 'half', v.note
FROM (VALUES
  ('confirmed_by_name',  62, 'Name of the KSCW spielplaner/admin who confirmed or manually entered this booking (captured at action time).'),
  ('confirmed_by_email', 63, 'Email of the KSCW spielplaner/admin who confirmed or manually entered this booking (captured at action time).')
) AS v(field, sort, note)
WHERE NOT EXISTS (
  SELECT 1 FROM directus_fields f
  WHERE f.collection = 'game_scheduling_bookings' AND f.field = v.field
);

COMMIT;
