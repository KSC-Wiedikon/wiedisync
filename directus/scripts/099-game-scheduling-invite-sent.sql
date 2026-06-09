-- Migration 099: Track when an invite email was actually sent.
--
-- Invite rows are auto-created (status 'invited') for every synced SVRZ opponent
-- the moment a team is opened — BEFORE any email goes out. Showing those as
-- "Invited" is misleading: the opponent hasn't been contacted yet. We stamp
-- `email_sent_at` when the invite is actually emailed (bulk send, or the per-card
-- "Draft email" mailto), so the list can show "Not sent" until then and "Invited"
-- once it's gone out. Nullable; null = drafted but not yet sent.
--
-- Schema-only + idempotent per the CLAUDE.md migration policy. No permission row
-- is needed: both scheduling read policies grant fields ['*'] on this collection
-- (setup-permissions.mjs), so the new column is readable automatically.

BEGIN;

ALTER TABLE game_scheduling_opponents
  ADD COLUMN IF NOT EXISTS email_sent_at timestamp with time zone;

-- Register the field with Directus so the items API returns it.
INSERT INTO directus_fields (collection, field, special, interface, readonly, hidden, sort, width, note)
SELECT 'game_scheduling_opponents', 'email_sent_at', 'cast-timestamp', 'datetime', true, false, 81, 'half',
       'When the invite email was actually sent (bulk send or per-card draft). Null = drafted but not yet sent.'
WHERE NOT EXISTS (
  SELECT 1 FROM directus_fields
  WHERE collection = 'game_scheduling_opponents' AND field = 'email_sent_at'
);

COMMIT;
