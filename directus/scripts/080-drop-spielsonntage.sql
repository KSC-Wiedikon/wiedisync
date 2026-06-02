-- Migration 080: drop game_scheduling_seasons.spielsonntage (fix-forward of 079)
--
-- 079 added a spielsonntage column for an admin-curated "game-Sundays" list. The
-- design changed before release: juniors may play on ANY Sunday (slots generated
-- for every Sunday in the season window at fixed times), with soft clustering onto
-- Sundays another junior team already uses — no admin picker. The column is unused,
-- so remove it and its Directus field metadata. 079 stays in the journal (applied
-- on dev); this fixes forward rather than editing it.
--
-- Schema-only + idempotent.

BEGIN;

DELETE FROM directus_fields
  WHERE collection = 'game_scheduling_seasons' AND field = 'spielsonntage';

ALTER TABLE game_scheduling_seasons DROP COLUMN IF EXISTS spielsonntage;

COMMIT;
