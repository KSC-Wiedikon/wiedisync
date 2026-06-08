-- Migration 091: Re-request marker for the home-proposal invalidation flow.
--
-- A pending home_slot_pick proposal can silently rot (the slot gets booked by
-- another opponent, blocked, hit by a hall closure, lands too close to a newly
-- confirmed game, or falls before a confirmed derby). When ALL three of an
-- opponent's proposed home slots are gone, the spielplaner confirms in the
-- dashboard and we email the opponent to pick 3 new slots (semi-automatic, via
-- POST /kscw/admin/terminplanung/request-new-slots).
--
-- `new_slots_requested_at` stamps when that re-request email went out, so the
-- dashboard can show "awaiting new proposals (asked dd.mm.yyyy)" instead of the
-- "request new slots" button. It is cleared when the opponent submits fresh
-- proposals (propose-home). Nullable; null = no outstanding re-request.
--
-- Schema-only + idempotent per the CLAUDE.md migration policy. No permission row
-- is needed: both scheduling read policies grant fields ['*'] on this collection
-- (setup-permissions.mjs), so the new column is readable automatically.

BEGIN;

ALTER TABLE game_scheduling_opponents
  ADD COLUMN IF NOT EXISTS new_slots_requested_at timestamp with time zone;

-- Register the field with Directus so the items API returns it.
INSERT INTO directus_fields (collection, field, special, interface, readonly, hidden, sort, width, note)
SELECT 'game_scheduling_opponents', 'new_slots_requested_at', 'cast-timestamp', 'datetime', true, false, 80, 'half',
       'When the opponent was last asked to pick 3 new home slots (all prior proposals invalidated). Cleared on re-proposal.'
WHERE NOT EXISTS (
  SELECT 1 FROM directus_fields
  WHERE collection = 'game_scheduling_opponents' AND field = 'new_slots_requested_at'
);

COMMIT;
