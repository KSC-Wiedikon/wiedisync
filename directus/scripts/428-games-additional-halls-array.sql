-- Migration 428: games.additional_halls back to a json ARRAY where bp-sync wrote an object.
--
-- WHY
-- ---
-- bp-sync's applyLocalGuards kept the existing `additional_halls` when the
-- Basketplan venue did not resolve, handing pg the PARSED value back. node-postgres
-- writes a JS array as a Postgres array literal, so `[]` was stored as the json
-- OBJECT '{}' (and `["2"]` as '{2}', which failed the update outright — game 718
-- was stuck on 25.09 data for a month). Every `additional_halls.map(...)` /
-- `for … of additional_halls` reader in the app throws on an object, so a week
-- view or the game drawer holding one of those games crashed. On prod: 5
-- basketball home games (KWI B) on 2026-10-25. Fixed in bp-sync (same commit).
--
-- WHAT CHANGES
-- ------------
-- Any `games.additional_halls` that is json but not an array becomes '[]' (no
-- extra halls — what the sync meant to write). date_updated is left alone: this
-- is a repair, not a fixture change.
--
-- Data backfill only, idempotent.

BEGIN;

UPDATE games
SET additional_halls = '[]'::json
WHERE additional_halls IS NOT NULL
  AND json_typeof(additional_halls) <> 'array';

COMMIT;
