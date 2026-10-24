-- Migration 424: live_scores.source — who wrote a live row.
--
-- WHY
-- ---
-- The hall board now writes a game's own row `game-<games.id>` too (setup-permissions §5b,
-- 2026-10-24), not only its channel 'kscw'. Every board write of that row carries
-- `source: 'board:<channel>'` (point-hub livePush.js). Directus drops an unknown field on
-- CREATE but refuses the whole UPDATE with 403 (verified on dev 2026-10-24) — so without
-- this column the board created the row at the first point and every later update was
-- refused: the row would stay stuck at the first point.
--
-- WHAT CHANGES
-- ------------
--   1. live_scores.source varchar(64), NULL. 'board:<channel>' when the hall board wrote the
--      row through the items API; NULL for phone live scoring (live-scoring.js, raw knex) and
--      for the board's own row. Lets a later change tell a board-fed game row from a
--      phone-scored one. Public read like every live_scores column — it names a board, no
--      personal data.
--   2. The game_id comment from 394 said only phones write game rows; the board does too.
--   3. Registered in directus_fields (read-only).
--
-- Schema-only + idempotent. Restart the container after deploy (new directus_fields row):
-- until Directus reloads its schema the column is unknown to it and board updates still 403.

BEGIN;

ALTER TABLE live_scores ADD COLUMN IF NOT EXISTS source varchar(64);

COMMENT ON COLUMN live_scores.source IS
  'Who wrote the row: board:<channel> for the hall scoreboard (point-hub livePush.js), NULL '
  'for phone live scoring and the board''s own channel row. Migration 424.';

COMMENT ON COLUMN live_scores.game_id IS
  'The fixture a game row belongs to (channel game-<id>), scored from a phone or fed by the '
  'hall scoreboard. NULL for a physical board''s own row.';

INSERT INTO directus_fields (collection, field, interface, readonly, hidden, sort, width, note)
SELECT 'live_scores', 'source', 'input', true, false, 31, 'half',
       'board:<channel> when the hall scoreboard wrote this row. Empty for phone live scoring.'
WHERE NOT EXISTS (
  SELECT 1 FROM directus_fields WHERE collection = 'live_scores' AND field = 'source'
);

COMMIT;
