-- Migration 084: home-game slot proposals.
--
-- The home leg moves from instant-book to "opponent proposes up to 3 slots →
-- spielplaner confirms one", mirroring the away-proposal flow. A pending home
-- booking (type 'home_slot_pick', status 'pending') now carries up to 3
-- proposed slot references; on confirm the chosen one is copied into the
-- existing `slot` FK and that slot is marked booked.
--
-- Adds game_scheduling_bookings.proposed_slot_1/2/3 (nullable integer ids into
-- game_scheduling_slots). Stored as plain integers (like the away
-- proposed_datetime_* columns) — the confirm step validates the slot exists and
-- is still available, so no hard FK is needed and none is added (avoids cascade
-- coupling to slot deletes).
--
-- Existing confirmed 'home_slot_pick' rows are untouched (they already have
-- `slot` set and no proposed_slot_*), so they keep rendering as decided games.
--
-- Idempotent.

BEGIN;

ALTER TABLE game_scheduling_bookings ADD COLUMN IF NOT EXISTS proposed_slot_1 integer;
ALTER TABLE game_scheduling_bookings ADD COLUMN IF NOT EXISTS proposed_slot_2 integer;
ALTER TABLE game_scheduling_bookings ADD COLUMN IF NOT EXISTS proposed_slot_3 integer;

COMMENT ON COLUMN game_scheduling_bookings.proposed_slot_1 IS
  'Home-slot proposal 1 — game_scheduling_slots.id the opponent proposed (pending home_slot_pick). On confirm, the chosen one is copied into `slot`.';

-- Directus field metadata so the columns are exposed via the items API
-- (same pattern as migrations 082/083). interface=input (plain integer id).
INSERT INTO directus_fields (collection, field, special, interface, sort, hidden, note)
SELECT v.coll, v.fld, NULL, 'input', v.srt, false,
  'Home-slot proposal id (game_scheduling_slots). Set while a home booking is pending; confirmed one is copied to `slot`.'
FROM (VALUES
  ('game_scheduling_bookings', 'proposed_slot_1', 30),
  ('game_scheduling_bookings', 'proposed_slot_2', 31),
  ('game_scheduling_bookings', 'proposed_slot_3', 32)
) AS v(coll, fld, srt)
WHERE NOT EXISTS (
  SELECT 1 FROM directus_fields df WHERE df.collection = v.coll AND df.field = v.fld
);

COMMIT;
