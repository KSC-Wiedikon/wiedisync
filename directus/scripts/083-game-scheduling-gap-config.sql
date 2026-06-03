-- Migration 083: configurable per-season game-spacing gaps.
--
-- Adds `game_scheduling_seasons.gap_config jsonb` (NOT NULL, default
-- {"home":4,"proposal":4,"proposal3":2}). Three gaps in days — the minimum
-- spacing between a new game and any other committed game:
--   home      — opponent picking a KSCW home slot
--   proposal  — away proposals 1 & 2
--   proposal3 — away proposal 3 (the lenient fallback; usually smaller)
--
-- Replaces the previously hardcoded GAME_SPACING_DAYS=4 constant in
-- kscw-endpoints/game-scheduling.js. Existing seasons get the default on add.
--
-- Idempotent.

BEGIN;

ALTER TABLE game_scheduling_seasons
  ADD COLUMN IF NOT EXISTS gap_config jsonb NOT NULL
  DEFAULT '{"home":4,"proposal":4,"proposal3":2}'::jsonb;

COMMENT ON COLUMN game_scheduling_seasons.gap_config IS
  'Per-season game-spacing gaps in days {home, proposal, proposal3}: minimum days between games. proposal3 is the lenient gap for the 3rd away proposal.';

-- Directus field metadata so the column is exposed via the items API + editable
-- in the admin (same pattern as migration 082's teams.recruiting_positions).
INSERT INTO directus_fields (collection, field, special, interface, sort, hidden, note)
SELECT 'game_scheduling_seasons', 'gap_config', 'cast-json', 'input-code', 50, false,
  'Per-season game-spacing gaps {home, proposal, proposal3} in days.'
WHERE NOT EXISTS (
  SELECT 1 FROM directus_fields WHERE collection = 'game_scheduling_seasons' AND field = 'gap_config'
);

COMMIT;
