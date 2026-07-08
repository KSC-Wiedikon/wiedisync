-- Migration 191: auto-shorten trainings that collide with home-game warm-up.
--
-- A home game claims its hall from 45 minutes before start (same warm-up
-- constant as spielplanung's gameBlock.ts) — the training scheduled right
-- before it used to be called off entirely. Club ruling 2026-07-08: keep the
-- training and shorten it to the warm-up start instead (e.g. D1 home game
-- Mon 19:15 in KWI C → DU23 trains 18:00–18:30 instead of 18:00–19:30).
--
-- The sweep in kscw-hooks/src/game-training-shorten.js manages both columns:
--   auto_shortened_by_game — games.id whose warm-up block cut this training
--                            (plain integer, no FK: games rows are routinely
--                            deleted/recreated by sv-sync; the sweep treats a
--                            dangling id as "restore").
--   original_end_time      — pre-shorten end, restored when the game moves,
--                            is cancelled, or vanishes.
--
-- Registered in directus_fields (read-only, hidden in admin forms) so the
-- items API exposes them to the app for the "shortened" badge.
--
-- Schema-only + idempotent.

BEGIN;

ALTER TABLE trainings ADD COLUMN IF NOT EXISTS auto_shortened_by_game integer;
ALTER TABLE trainings ADD COLUMN IF NOT EXISTS original_end_time time;

INSERT INTO directus_fields (collection, field, interface, readonly, hidden, note)
SELECT 'trainings', 'auto_shortened_by_game', 'input', true, true,
       'games.id whose warm-up block auto-shortened this training (sweep-managed, migration 191).'
WHERE NOT EXISTS (
  SELECT 1 FROM directus_fields df WHERE df.collection = 'trainings' AND df.field = 'auto_shortened_by_game'
);

INSERT INTO directus_fields (collection, field, interface, readonly, hidden, note)
SELECT 'trainings', 'original_end_time', 'input', true, true,
       'End time before game auto-shorten; restored when the game moves/vanishes (migration 191).'
WHERE NOT EXISTS (
  SELECT 1 FROM directus_fields df WHERE df.collection = 'trainings' AND df.field = 'original_end_time'
);

COMMIT;
