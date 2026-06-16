-- Migration 111: record WHO at the opponent club proposed/confirmed a booking.
--
-- When an opponent submits home-slot picks or away-date proposals from their
-- tokenized link, we now capture the name + email of the person doing it (a
-- modal on the "Confirm home/away games" buttons). The invited contact_email on
-- game_scheduling_opponents is the club's contact LIST, not the individual who
-- actually filled the form — so we store the proposer on the BOOKING (home and
-- away are separate bookings, submitted independently, each gets its own
-- proposer). Lets the spielplaner see who to follow up with per game.
--
-- Schema-only + idempotent per the CLAUDE.md migration policy. No permission row
-- is needed: both scheduling read policies grant fields ['*'] on this collection
-- (setup-permissions.mjs), so the new columns are readable automatically. They
-- are registered with Directus so the items API returns them + the admin UI
-- shows them.

BEGIN;

ALTER TABLE game_scheduling_bookings
  ADD COLUMN IF NOT EXISTS proposed_by_name  text,
  ADD COLUMN IF NOT EXISTS proposed_by_email text;

-- Register each field with Directus so the items API reads them.
INSERT INTO directus_fields (collection, field, special, interface, sort, width, note)
SELECT 'game_scheduling_bookings', v.field, NULL, 'input', v.sort, 'half', v.note
FROM (VALUES
  ('proposed_by_name',  60, 'Name of the opponent-club person who submitted this proposal (captured at confirm time).'),
  ('proposed_by_email', 61, 'Email of the opponent-club person who submitted this proposal (captured at confirm time).')
) AS v(field, sort, note)
WHERE NOT EXISTS (
  SELECT 1 FROM directus_fields f
  WHERE f.collection = 'game_scheduling_bookings' AND f.field = v.field
);

COMMIT;
