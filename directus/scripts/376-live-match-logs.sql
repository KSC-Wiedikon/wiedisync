-- Migration 376: `live_match_logs` — the LedBox board's point-by-point match log.
--
-- WHY
-- ---
-- `live_scores` (272) is one row overwritten on every point, and the board's pushes
-- are debounced + latest-wins, so points go missing on fast taps, undos and outages.
-- `live_history` (273) keeps only the final score. Neither can answer "how many
-- points did we win in reception" or "what was our longest run conceded".
--
-- The board already keeps the full log on its own card (point-hub historyStore.js):
-- every point, serve, timeout, swap, undo and set end, each stamped with the running
-- score, the serving team and the board's clock. This table is where that log lands.
--
-- UPLOADED AFTER THE MATCH, NOT LIVE. Most halls give the board no uplink, so the
-- board stores each finished match and uploads it whenever it next has a connection
-- (store-and-forward, point-hub matchUpload.js). A match can therefore arrive days
-- late, and the same match can be POSTed twice (a timeout after the server already
-- committed). `(channel, match_key)` is UNIQUE and the board treats the duplicate
-- error as "already uploaded", so a retry never double-counts a match.
--
-- Append-only like 273: the publisher gets create and nothing else.
--
-- `game_id` links to the fixture when the board set the match up from the schedule.
-- NULL for a hand-typed match. A trigger NULLs an id that does not exist (a game
-- deleted since, or a dev id reaching prod) instead of failing the insert — a
-- rejected upload would be retried forever and the match's log never stored.
--
-- NOT the club match record. `games` is. This is what one physical scoreboard saw.
--
-- Schema-only + idempotent. Permissions live in setup-permissions.mjs, never here.

-- ── 1. The table ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS live_match_logs (
  id            uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  channel       varchar(64)  NOT NULL,                       -- which board (live_scores.channel)
  match_key     varchar(64)  NOT NULL,                       -- the board's id for the match
  game_id       integer,                                     -- games.id when set up from the schedule
  sport         varchar(16)  NOT NULL DEFAULT 'volleyball',

  team_a        varchar(120),                                -- a = the team on the LEFT at the first rally
  team_b        varchar(120),
  sets_a        integer      NOT NULL DEFAULT 0,             -- basketball: the final score
  sets_b        integer      NOT NULL DEFAULT 0,
  set_results   jsonb        NOT NULL DEFAULT '[]'::jsonb,   -- [{ "a": 25, "b": 20, "dur": 1520 }, …]
  events        jsonb        NOT NULL DEFAULT '[]'::jsonb,   -- the play-by-play, by team (a/b), oldest first
  event_count   integer      NOT NULL DEFAULT 0,

  board_date    varchar(32),                                 -- the board's own "match started" stamp
  uploaded_at   timestamptz  NOT NULL DEFAULT NOW(),         -- server clock

  CONSTRAINT live_match_logs_sport_check
    CHECK (sport IN ('volleyball', 'beach', 'basketball'))
);

CREATE UNIQUE INDEX IF NOT EXISTS live_match_logs_channel_key_uidx
  ON live_match_logs (channel, match_key);
CREATE INDEX IF NOT EXISTS live_match_logs_game_idx
  ON live_match_logs (game_id) WHERE game_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS live_match_logs_uploaded_idx
  ON live_match_logs (uploaded_at DESC);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'live_match_logs_game_fk') THEN
    ALTER TABLE live_match_logs
      ADD CONSTRAINT live_match_logs_game_fk
      FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE SET NULL;
  END IF;
END $$;

-- An unknown game id must not reject the upload (see header).
CREATE OR REPLACE FUNCTION live_match_logs_drop_unknown_game() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.game_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM games WHERE id = NEW.game_id) THEN
    NEW.game_id := NULL;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS live_match_logs_drop_unknown_game ON live_match_logs;
CREATE TRIGGER live_match_logs_drop_unknown_game
  BEFORE INSERT OR UPDATE OF game_id ON live_match_logs
  FOR EACH ROW EXECUTE FUNCTION live_match_logs_drop_unknown_game();

COMMENT ON TABLE live_match_logs IS
  'Point-by-point match logs uploaded by the LedBox board after each match (store-and-forward). Append-only for the board. NOT the club match record — `games` is.';
COMMENT ON COLUMN live_match_logs.match_key IS
  'The board''s own id for the match. UNIQUE per channel so a re-sent upload is rejected as a duplicate, never stored twice.';
COMMENT ON COLUMN live_match_logs.events IS
  'Each entry: { t: "HH:MM:SS" board clock, type: point|timeout|sub|serve|swap|set|remove-set|set-end|period-end|switch-due|undo|match-end, side: a|b, delta, score: [a,b], sets: [a,b], srv: a|b (serving team AFTER the action) }. Undone actions are removed, an undo marker stays.';
COMMENT ON COLUMN live_match_logs.game_id IS
  'games.id when the board set the match up from the schedule; NULL for a hand-typed match or an id that did not exist at upload.';

-- ── 2. Register the collection with Directus ────────────────────────────────
INSERT INTO directus_collections (collection, icon, note, hidden, singleton, "group", sort_field)
SELECT 'live_match_logs', 'query_stats',
       'Point-by-point logs uploaded by the LedBox scoreboard. Append-only; not the club match record.',
       false, false, NULL, NULL
WHERE NOT EXISTS (SELECT 1 FROM directus_collections WHERE collection = 'live_match_logs');

INSERT INTO directus_fields (collection, field, interface, options, readonly, hidden, sort, width, note)
SELECT 'live_match_logs', v.field, v.interface, v.options::json, v.readonly, false, v.sort, v.width, v.note
FROM (VALUES
  ('id',           'input',        NULL, true,  1,  'half', NULL),
  ('channel',      'input',        NULL, false, 2,  'half', 'Which board produced this.'),
  ('match_key',    'input',        NULL, false, 3,  'half', 'The board''s id for the match (unique per channel).'),
  ('game_id',      'select-dropdown-m2o', NULL, false, 4, 'half', 'The fixture, when set up from the schedule.'),
  ('sport',        'select-dropdown',
     '{"choices":[{"text":"Volleyball","value":"volleyball"},{"text":"Beach","value":"beach"},{"text":"Basketball","value":"basketball"}]}',
     false, 5,  'half', NULL),
  ('team_a',       'input',        NULL, false, 6,  'half', 'Left at the first rally.'),
  ('team_b',       'input',        NULL, false, 7,  'half', NULL),
  ('sets_a',       'input',        NULL, false, 8,  'half', 'Basketball: the final score.'),
  ('sets_b',       'input',        NULL, false, 9,  'half', 'Basketball: the final score.'),
  ('set_results',  'input-code',   NULL, false, 10, 'full', '[{"a":25,"b":20,"dur":1520}, …]'),
  ('events',       'input-code',   NULL, false, 11, 'full', 'The play-by-play, oldest first.'),
  ('event_count',  'input',        NULL, false, 12, 'half', NULL),
  ('board_date',   'input',        NULL, false, 13, 'half', 'Board clock — not trusted for ordering.'),
  ('uploaded_at',  'datetime',     NULL, true,  14, 'half', 'Server clock.')
) AS v(field, interface, options, readonly, sort, width, note)
WHERE NOT EXISTS (
  SELECT 1 FROM directus_fields df
  WHERE df.collection = 'live_match_logs' AND df.field = v.field
);

UPDATE directus_fields
   SET special = 'cast-json'
 WHERE collection = 'live_match_logs' AND field IN ('set_results', 'events')
   AND (special IS NULL OR special = '');

INSERT INTO directus_relations (many_collection, many_field, one_collection, one_deselect_action)
SELECT 'live_match_logs', 'game_id', 'games', 'nullify'
WHERE NOT EXISTS (
  SELECT 1 FROM directus_relations WHERE many_collection = 'live_match_logs' AND many_field = 'game_id'
);
