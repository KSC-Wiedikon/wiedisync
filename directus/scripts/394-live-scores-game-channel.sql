-- Migration 394: phone live scoring per game.
--
-- Until now `live_scores` held one row per PHYSICAL scoreboard (channel 'kscw',
-- the LedBox). A game's participants can now score it from their phone too
-- (`/live/score/:gameId`, endpoint `kscw-endpoints/src/live-scoring.js`). Each
-- such game publishes to its OWN row, channel `game-<games.id>`, read by the same
-- public `/live?channel=game-<id>` page — no second table, no second renderer.
--
-- `game_id` binds a row to its fixture, which the board row never could
-- (useLiveNow documents why its banner says "a match is live", never "your game").
-- NULL for the board's own row. ON DELETE SET NULL: a deleted game must not take
-- the published score with it mid-evening, and the row is not a child record.
--
-- Writes to `game-*` rows go through the endpoint only (raw knex, eligibility +
-- actor logging there). The LedBox policy stays pinned to channel 'kscw'
-- (setup-permissions §5b), so its token cannot write a game row either. The
-- existing Public read grant covers the new column; it carries no personal data.
--
-- Schema-only, idempotent.

BEGIN;

ALTER TABLE live_scores ADD COLUMN IF NOT EXISTS game_id integer;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'live_scores_game_id_fkey') THEN
    ALTER TABLE live_scores
      ADD CONSTRAINT live_scores_game_id_fkey
      FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS live_scores_game_id_idx ON live_scores (game_id) WHERE game_id IS NOT NULL;

COMMENT ON COLUMN live_scores.game_id IS
  'The fixture a phone-scored row belongs to (channel game-<id>). NULL for a physical board''s row.';

INSERT INTO directus_fields (collection, field, interface, readonly, hidden, sort, width, note)
SELECT 'live_scores', 'game_id', 'input', true, false, 30, 'half',
       'Fixture scored from a phone (channel game-<id>). Empty for the hall scoreboard.'
WHERE NOT EXISTS (
  SELECT 1 FROM directus_fields WHERE collection = 'live_scores' AND field = 'game_id'
);

COMMIT;
