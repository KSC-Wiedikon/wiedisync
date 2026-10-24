-- Migration 425: live_history.game_id — the fixture a finished board match belongs to.
--
-- WHY
-- ---
-- When the hall board knows the game it is showing, it archives the finished match with
-- `game_id` and home/away orientation (point-hub livePush.js historyRow). live_history had no
-- such column, so Directus dropped it and the history row could only be matched to its game
-- by date + team names (kscw.ch pending-results.js, /live "Recent matches" on a game-<id>
-- channel). With the id, kscw.ch fills an unsynced game's provisional score from the row of
-- THAT game, and a game's /live page lists its own result.
--
-- WHAT CHANGES
-- ------------
--   1. live_history.game_id integer, FK games(id) ON DELETE SET NULL (history must outlive a
--      deleted fixture, like live_scores.game_id in 394), partial index. NULL for a match the
--      board could not tie to a fixture — then team A is the LEFT side, as before.
--   2. Registered in directus_fields (read-only). Public read and the board's create are
--      `fields: *` (setup-permissions §5/§5b) — no permission row changes.
--   3. live_scores.source comment from 424: phone live scoring now writes 'phone'.
--
-- Schema-only + idempotent. Restart the container after deploy (new directus_fields row).

BEGIN;

ALTER TABLE live_history ADD COLUMN IF NOT EXISTS game_id integer;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'live_history_game_id_fkey') THEN
    ALTER TABLE live_history
      ADD CONSTRAINT live_history_game_id_fkey
      FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS live_history_game_id_idx ON live_history (game_id) WHERE game_id IS NOT NULL;

COMMENT ON COLUMN live_history.game_id IS
  'The fixture this finished match belongs to, when the board knew it (team A = home then). '
  'NULL: not tied to a game, team A = the left side. Migration 425.';

COMMENT ON COLUMN live_scores.source IS
  'Who wrote the row: board:<channel> for the hall scoreboard (point-hub livePush.js), phone '
  'for phone live scoring (live-scoring.js), NULL for the board''s own channel row and rows '
  'written before migration 425.';

INSERT INTO directus_fields (collection, field, interface, readonly, hidden, sort, width, note)
SELECT 'live_history', 'game_id', 'input', true, false, 30, 'half',
       'Fixture of this match, when the board knew it (team A = home then). Empty: team A = left.'
WHERE NOT EXISTS (
  SELECT 1 FROM directus_fields WHERE collection = 'live_history' AND field = 'game_id'
);

COMMIT;
