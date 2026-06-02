-- Migration 079: game_scheduling_seasons.spielsonntage (junior Game-Sundays)
--
-- Junior teams (HU23-1, HU20, DU23-1, …) may play home games on Sundays. This
-- column holds the admin-picked Game-Sundays for a season, same JSON shape as
-- spielsamstage: [{ "date": "YYYY-MM-DD", "slots": [{ "time": "HH:MM", "hall_id": "N" }] }].
-- Slot generation emits these as home slots ONLY for junior teams (source =
-- 'spielsonntag'). Null = none configured.
--
-- Schema-only + idempotent. No permission row needed: the existing
-- game_scheduling_seasons CRUD (KSCW Terminplanung / Sport Admin / Vorstand)
-- covers the new column; the generate-slots endpoint reads it via raw knex.

BEGIN;

ALTER TABLE game_scheduling_seasons ADD COLUMN IF NOT EXISTS spielsonntage jsonb;

COMMENT ON COLUMN game_scheduling_seasons.spielsonntage IS
  'Junior Game-Sundays for the season: [{date, slots:[{time, hall_id}]}]. Home slots generated from these apply to junior teams only (source=spielsonntag).';

-- Directus field metadata — mirror the existing spielsamstage field (cast-json
-- + input-code) so the column is recognized by the schema and editable in admin.
INSERT INTO directus_fields (collection, field, special, interface, sort, hidden, note)
SELECT 'game_scheduling_seasons', 'spielsonntage', 'cast-json', 'input-code',
  (SELECT COALESCE(MAX(sort), 0) + 1 FROM directus_fields WHERE collection = 'game_scheduling_seasons'),
  false,
  'Junior Game-Sundays: [{date, slots:[{time, hall_id}]}]. Applies to junior teams only.'
WHERE NOT EXISTS (
  SELECT 1 FROM directus_fields WHERE collection = 'game_scheduling_seasons' AND field = 'spielsonntage'
);

COMMIT;
