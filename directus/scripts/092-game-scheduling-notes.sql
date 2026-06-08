-- Migration 092: Remarks/notes between KSCW and a scheduling opponent.
--
-- Two free-text notes per opponent (one conversation per opponent, spanning
-- their home + away legs):
--   • kscw_note     — written by the spielplaner in the dashboard, shown to the
--                     opponent on their public proposal page (read-only there).
--   • opponent_note — written by the opponent on their proposal page, shown to
--                     the spielplaner in the dashboard.
--
-- Distinct from the existing game_scheduling_bookings.admin_notes (private,
-- per-leg, KSCW-only). These are per-opponent and one side is opponent-visible.
--
-- Schema-only + idempotent per the CLAUDE.md migration policy. No permission row
-- is needed: both scheduling read policies grant fields ['*'] on this collection
-- (setup-permissions.mjs); opponent-side reads/writes go through the token-gated
-- endpoints (knex), not the items API.

BEGIN;

ALTER TABLE game_scheduling_opponents
  ADD COLUMN IF NOT EXISTS kscw_note text,
  ADD COLUMN IF NOT EXISTS opponent_note text;

-- Register the fields with Directus so the items API returns them.
INSERT INTO directus_fields (collection, field, special, interface, sort, width, note)
SELECT 'game_scheduling_opponents', 'kscw_note', NULL, 'input-multiline', 81, 'full',
       'Note from KSCW shown to the opponent on their proposal page (editable in the dashboard).'
WHERE NOT EXISTS (
  SELECT 1 FROM directus_fields
  WHERE collection = 'game_scheduling_opponents' AND field = 'kscw_note'
);

INSERT INTO directus_fields (collection, field, special, interface, sort, width, note)
SELECT 'game_scheduling_opponents', 'opponent_note', NULL, 'input-multiline', 82, 'full',
       'Remark written by the opponent on their proposal page (read-only for KSCW).'
WHERE NOT EXISTS (
  SELECT 1 FROM directus_fields
  WHERE collection = 'game_scheduling_opponents' AND field = 'opponent_note'
);

COMMIT;
