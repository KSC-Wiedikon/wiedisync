-- Migration 273: `live_history` — finished matches from the LedBox scoreboard.
--
-- WHY
-- ---
-- `live_scores` (272) holds exactly one row per board, overwritten on every point.
-- The moment a match ends and the next one starts, the previous result is gone. This
-- table is the append-only counterpart: the board POSTs ONE row when a match finishes,
-- so /live can show "recent matches" instead of an empty board on a quiet evening.
--
-- Append-only by design: the publisher policy gets create (+ public read) and nothing
-- else. The board cannot edit or delete history, so a mis-scored match is corrected by
-- an admin, not silently rewritten by a device in a hall.
--
-- NOT the club's match record. `games` is the source of truth for results — this is a
-- log of what a physical scoreboard displayed, with no fixture link (the board has no
-- idea which `games` row it is showing; see 272's note on the same gap). Treat it as
-- scoreboard history, never as a results table.
--
-- Schema-only + idempotent. Permissions live in setup-permissions.mjs, never here.

-- ── 1. The table ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS live_history (
  id            uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  channel       varchar(64)  NOT NULL,                       -- which board (live_scores.channel)
  sport         varchar(16)  NOT NULL DEFAULT 'volleyball',

  team_a_name   varchar(120),
  team_a_short  varchar(16),
  team_a_color  varchar(16),
  team_b_name   varchar(120),
  team_b_short  varchar(16),
  team_b_color  varchar(16),

  points_a      integer      NOT NULL DEFAULT 0,             -- basketball: the final score
  points_b      integer      NOT NULL DEFAULT 0,
  sets_won_a    integer      NOT NULL DEFAULT 0,             -- volleyball / beach
  sets_won_b    integer      NOT NULL DEFAULT 0,
  period        integer      NOT NULL DEFAULT 0,             -- last period played
  set_results   jsonb        NOT NULL DEFAULT '[]'::jsonb,

  ts            bigint       NOT NULL DEFAULT 0,             -- board clock (ms epoch)
  finished_at   timestamptz  NOT NULL DEFAULT NOW(),         -- server clock — what the UI sorts on

  CONSTRAINT live_history_sport_check
    CHECK (sport IN ('volleyball', 'beach', 'basketball'))
);

-- The only query the page makes: newest first for one channel.
CREATE INDEX IF NOT EXISTS live_history_channel_finished_idx
  ON live_history (channel, finished_at DESC);

COMMENT ON TABLE live_history IS
  'Append-only log of matches the LedBox scoreboard finished. Written by the board''s publisher token (create only), read publicly by /live. NOT the club match record — `games` is.';
COMMENT ON COLUMN live_history.finished_at IS
  'Server clock at insert. The UI sorts on this, not on `ts`, so a board with a wrong clock cannot reorder the list.';
COMMENT ON COLUMN live_history.ts IS
  'The board''s own ms-epoch clock at match end. Kept for correlation with live_scores; not trusted for ordering.';
COMMENT ON COLUMN live_history.channel IS
  'Which physical board produced this. No FK to live_scores — history must outlive a board being removed.';

-- ── 2. Register the collection with Directus ────────────────────────────────
INSERT INTO directus_collections (collection, icon, note, hidden, singleton, "group", sort_field)
SELECT 'live_history', 'history',
       'Finished matches logged by the LedBox scoreboard. Append-only; not the club match record.',
       false, false, NULL, NULL
WHERE NOT EXISTS (SELECT 1 FROM directus_collections WHERE collection = 'live_history');

INSERT INTO directus_fields (collection, field, interface, options, readonly, hidden, sort, width, note)
SELECT 'live_history', v.field, v.interface, v.options::json, v.readonly, false, v.sort, v.width, v.note
FROM (VALUES
  ('id',           'input',        NULL, true,  1,  'half', NULL),
  ('channel',      'input',        NULL, false, 2,  'half', 'Which board produced this.'),
  ('sport',        'select-dropdown',
     '{"choices":[{"text":"Volleyball","value":"volleyball"},{"text":"Beach","value":"beach"},{"text":"Basketball","value":"basketball"}]}',
     false, 3,  'half', NULL),
  ('team_a_name',  'input',        NULL, false, 4,  'half', NULL),
  ('team_a_short', 'input',        NULL, false, 5,  'half', NULL),
  ('team_a_color', 'select-color', NULL, false, 6,  'half', NULL),
  ('team_b_name',  'input',        NULL, false, 7,  'half', NULL),
  ('team_b_short', 'input',        NULL, false, 8,  'half', NULL),
  ('team_b_color', 'select-color', NULL, false, 9,  'half', NULL),
  ('points_a',     'input',        NULL, false, 10, 'half', 'Basketball: the final score.'),
  ('points_b',     'input',        NULL, false, 11, 'half', 'Basketball: the final score.'),
  ('sets_won_a',   'input',        NULL, false, 12, 'half', 'Volleyball / beach.'),
  ('sets_won_b',   'input',        NULL, false, 13, 'half', 'Volleyball / beach.'),
  ('period',       'input',        NULL, false, 14, 'half', 'Last period played.'),
  ('set_results',  'input-code',   NULL, false, 15, 'full', '[{"a":25,"b":20}, …]'),
  ('ts',           'input',        NULL, false, 16, 'half', 'Board clock — not trusted for ordering.'),
  ('finished_at',  'datetime',     NULL, true,  17, 'half', 'Server clock. The UI sorts on this.')
) AS v(field, interface, options, readonly, sort, width, note)
WHERE NOT EXISTS (
  SELECT 1 FROM directus_fields df
  WHERE df.collection = 'live_history' AND df.field = v.field
);

UPDATE directus_fields
   SET special = 'cast-json'
 WHERE collection = 'live_history' AND field = 'set_results'
   AND (special IS NULL OR special = '');
