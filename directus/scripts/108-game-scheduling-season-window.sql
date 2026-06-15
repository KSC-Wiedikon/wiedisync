-- Migration 108: configurable per-season offer window (open / close dates).
--
-- Adds `game_scheduling_seasons.season_opens date` and `season_closes date`.
-- These bound the dates the scheduling tool offers — home slots AND away
-- proposals — and drive the calendars' selectable range (anything before
-- season_opens or after season_closes is greyed out). NULL on either side falls
-- back to the value previously hardcoded in kscw-endpoints/game-scheduling.js:
-- Sep 1 (season's first year) → Mar 31 (second year), derived from the season
-- name (e.g. "2026/27"). So existing seasons keep their current behaviour until
-- a date is set; setting them narrows the window without a code change.
--
-- Idempotent. Schema-only (the columns sit under the existing
-- game_scheduling_seasons update permission — no setup-permissions change).

BEGIN;

ALTER TABLE game_scheduling_seasons
  ADD COLUMN IF NOT EXISTS season_opens date;
ALTER TABLE game_scheduling_seasons
  ADD COLUMN IF NOT EXISTS season_closes date;

COMMENT ON COLUMN game_scheduling_seasons.season_opens IS
  'First date the tool offers slots/away dates. NULL → Sep 1 of the season''s first year.';
COMMENT ON COLUMN game_scheduling_seasons.season_closes IS
  'Last date the tool offers slots/away dates. NULL → Mar 31 of the season''s second year.';

-- Directus field metadata so the columns are editable in the admin + exposed via
-- the items API (same pattern as migration 083's gap_config).
INSERT INTO directus_fields (collection, field, special, interface, options, display, sort, hidden, note)
SELECT 'game_scheduling_seasons', 'season_opens', NULL, 'datetime',
  '{"includeSeconds":false}'::json, 'datetime', 51, false,
  'First date the tool offers slots/away dates (NULL → Sep 1 of the season''s first year).'
WHERE NOT EXISTS (
  SELECT 1 FROM directus_fields WHERE collection = 'game_scheduling_seasons' AND field = 'season_opens'
);

INSERT INTO directus_fields (collection, field, special, interface, options, display, sort, hidden, note)
SELECT 'game_scheduling_seasons', 'season_closes', NULL, 'datetime',
  '{"includeSeconds":false}'::json, 'datetime', 52, false,
  'Last date the tool offers slots/away dates (NULL → Mar 31 of the season''s second year).'
WHERE NOT EXISTS (
  SELECT 1 FROM directus_fields WHERE collection = 'game_scheduling_seasons' AND field = 'season_closes'
);

COMMIT;
