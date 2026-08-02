-- Migration 272: `live_scores` — the LedBox scoreboard's published match state.
--
-- WHY
-- ---
-- The hall's LED scoreboard (the `ledbox-bridge`) already knows the full match state.
-- This table is where it publishes that state so the public `/live` page can mirror it.
-- One row per physical board, keyed by `channel` (a manual string PK, not a serial) —
-- the board PATCHes the SAME row on every change rather than appending, so the table
-- stays at one row per scoreboard forever and the page reads it with a single
-- primary-key lookup. No history is kept here on purpose (see `live_history` in the
-- roadmap if that is ever wanted).
--
-- Read path is PUBLIC (anonymous spectators, `setup-permissions.mjs` §5); the write path
-- is a single static token on the "KSCW LedBox Publisher" policy — create/read/update on
-- this collection ONLY, no delete, nothing else in the club's data.
--
-- ONE TABLE, THREE SPORTS
-- -----------------------
-- `sport` selects how the app renders the same row — the board publishes a superset and
-- the page reads the columns its sport cares about:
--
--   volleyball  points_* (current set), sets_won_*, timeouts_*, subs_*, serving_team,
--               set_results
--   beach       same as volleyball minus subs_* (beach has no substitutions; the team
--               name carries the pair, e.g. "Müller / Meier")
--   basketball  points_* (running score), period, fouls_* (team fouls this period),
--               timeouts_*, serving_team (reused as the POSSESSION ARROW — identical
--               left/right semantics, so it needs no column of its own). No sets.
--
-- Deliberately NOT split into per-sport tables: the board owns one physical display and
-- publishes one state; three tables would mean three permission rows, three poll targets
-- and a race about which one is "current".
--
-- `over` is the board's own match-over flag and is kept distinct from `status`:
-- `status` is the publication lifecycle the page renders (idle / live / final) while
-- `over` is what the scoring firmware thinks. They agree in practice; when they don't,
-- the page trusts `status` and treats `over` as a hint.
--
-- Schema-only + idempotent. Permissions live in setup-permissions.mjs, never here.

-- ── 1. The table ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS live_scores (
  channel       varchar(64)  PRIMARY KEY,                              -- e.g. 'kscw'
  sport         varchar(16)  NOT NULL DEFAULT 'volleyball',
  status        varchar(16)  NOT NULL DEFAULT 'idle',
  event         varchar(32),                                           -- set-end | match-end | switch-8
  ts            bigint       NOT NULL DEFAULT 0,                       -- ms epoch; the app's ordering key
  over          boolean      NOT NULL DEFAULT false,
  period        integer      NOT NULL DEFAULT 0,                       -- basketball: 1..4 = Q1..Q4, 5+ = OT
  side_a        varchar(8)   NOT NULL DEFAULT 'left',                  -- getState() always projects A→left

  team_a_name   varchar(120),
  team_a_short  varchar(16),
  team_a_color  varchar(16),                                           -- hex, e.g. '#4A55A2'
  team_b_name   varchar(120),
  team_b_short  varchar(16),
  team_b_color  varchar(16),

  points_a      integer      NOT NULL DEFAULT 0,                       -- VB: current set · BB: running score
  points_b      integer      NOT NULL DEFAULT 0,
  sets_won_a    integer      NOT NULL DEFAULT 0,                       -- volleyball / beach only
  sets_won_b    integer      NOT NULL DEFAULT 0,
  timeouts_a    integer      NOT NULL DEFAULT 0,
  timeouts_b    integer      NOT NULL DEFAULT 0,
  subs_a        integer      NOT NULL DEFAULT 0,                       -- volleyball only (beach has none)
  subs_b        integer      NOT NULL DEFAULT 0,
  fouls_a       integer      NOT NULL DEFAULT 0,                       -- basketball team fouls this period
  fouls_b       integer      NOT NULL DEFAULT 0,

  serving_team  varchar(8),                                            -- left | right; BB: possession arrow
  set_results   jsonb        NOT NULL DEFAULT '[]'::jsonb,             -- [{ "a": 25, "b": 20 }, …]
  date_updated  timestamptz,

  CONSTRAINT live_scores_sport_check
    CHECK (sport IN ('volleyball', 'beach', 'basketball')),
  CONSTRAINT live_scores_status_check
    CHECK (status IN ('idle', 'live', 'final')),
  CONSTRAINT live_scores_serving_check
    CHECK (serving_team IS NULL OR serving_team IN ('left', 'right'))
);

COMMENT ON TABLE live_scores IS
  'Published state of a physical LedBox scoreboard, one row per channel. Written by the board''s static publisher token, read publicly by /live. Sport-agnostic superset — see the `sport` column.';

COMMENT ON COLUMN live_scores.channel      IS 'Manual PK = the physical scoreboard. The board overwrites this row; it never appends.';
COMMENT ON COLUMN live_scores.sport        IS 'volleyball | beach | basketball — selects how /live renders the row.';
COMMENT ON COLUMN live_scores.status       IS 'Publication lifecycle: idle (no match) | live | final. The page trusts this over `over`.';
COMMENT ON COLUMN live_scores.over         IS 'The scoring firmware''s own match-over flag. A hint; `status` is authoritative.';
COMMENT ON COLUMN live_scores.period       IS 'Basketball period: 1..4 = Q1..Q4, 5+ = overtime. Unused by volleyball/beach (the set number is set_results length + 1).';
COMMENT ON COLUMN live_scores.ts           IS 'ms epoch of the change. The app drops any frame whose ts is older than the last one applied.';
COMMENT ON COLUMN live_scores.serving_team IS 'Volleyball/beach: which side serves. Basketball: the possession arrow — same left/right semantics, so no extra column.';
COMMENT ON COLUMN live_scores.fouls_a      IS 'Basketball team fouls in the CURRENT period. 5+ puts the opponent in the bonus.';
COMMENT ON COLUMN live_scores.fouls_b      IS 'Basketball team fouls in the CURRENT period. 5+ puts the opponent in the bonus.';
COMMENT ON COLUMN live_scores.subs_a       IS 'Volleyball substitutions this set. Beach has no substitutions — /live hides it there.';
COMMENT ON COLUMN live_scores.subs_b       IS 'Volleyball substitutions this set. Beach has no substitutions — /live hides it there.';
COMMENT ON COLUMN live_scores.set_results  IS 'Completed sets, oldest first: [{"a":25,"b":20}, …]. Volleyball/beach only.';

-- `date_updated` is maintained by Directus (the "Date Updated" system field). The board
-- also writes `ts` itself, so ordering never depends on server clock skew.

-- ── 2. Register the collection with Directus ────────────────────────────────
INSERT INTO directus_collections (collection, icon, note, hidden, singleton, "group", sort_field)
SELECT 'live_scores', 'scoreboard',
       'Live match state published by the LedBox scoreboard. Read publicly by /live.',
       false, false, NULL, NULL
WHERE NOT EXISTS (SELECT 1 FROM directus_collections WHERE collection = 'live_scores');

INSERT INTO directus_fields (collection, field, interface, options, readonly, hidden, sort, width, note)
SELECT 'live_scores', v.field, v.interface, v.options::json, v.readonly, false, v.sort, v.width, v.note
FROM (VALUES
  ('channel',      'input',           NULL, false, 1,  'half',
     'The physical scoreboard this row belongs to. Manual primary key.'),
  ('sport',        'select-dropdown',
     '{"choices":[{"text":"Volleyball","value":"volleyball"},{"text":"Beach","value":"beach"},{"text":"Basketball","value":"basketball"}]}',
     false, 2,  'half', 'Selects how /live renders this row.'),
  ('status',       'select-dropdown',
     '{"choices":[{"text":"Idle","value":"idle"},{"text":"Live","value":"live"},{"text":"Final","value":"final"}]}',
     false, 3,  'half', 'Publication lifecycle. Authoritative over `over`.'),
  ('event',        'input',           NULL, false, 4,  'half',
     'Notable board event: set-end | match-end | switch-8.'),
  ('over',         'boolean',         NULL, false, 5,  'half',
     'The firmware''s match-over flag. A hint only.'),
  ('period',       'input',           NULL, false, 6,  'half',
     'Basketball period: 1..4 = Q1..Q4, 5+ = overtime.'),
  ('ts',           'input',           NULL, false, 7,  'half',
     'ms epoch of the change — the app''s staleness/ordering key.'),
  ('side_a',       'input',           NULL, true,  8,  'half',
     'Always "left" — the board projects team A onto the left.'),
  ('team_a_name',  'input',           NULL, false, 9,  'half', 'Beach: the pair, e.g. "Müller / Meier".'),
  ('team_a_short', 'input',           NULL, false, 10, 'half', NULL),
  ('team_a_color', 'select-color',    NULL, false, 11, 'half', NULL),
  ('team_b_name',  'input',           NULL, false, 12, 'half', 'Beach: the pair, e.g. "Müller / Meier".'),
  ('team_b_short', 'input',           NULL, false, 13, 'half', NULL),
  ('team_b_color', 'select-color',    NULL, false, 14, 'half', NULL),
  ('points_a',     'input',           NULL, false, 15, 'half', 'Volleyball: current set. Basketball: running score.'),
  ('points_b',     'input',           NULL, false, 16, 'half', 'Volleyball: current set. Basketball: running score.'),
  ('sets_won_a',   'input',           NULL, false, 17, 'half', 'Volleyball / beach only.'),
  ('sets_won_b',   'input',           NULL, false, 18, 'half', 'Volleyball / beach only.'),
  ('timeouts_a',   'input',           NULL, false, 19, 'half', NULL),
  ('timeouts_b',   'input',           NULL, false, 20, 'half', NULL),
  ('subs_a',       'input',           NULL, false, 21, 'half', 'Volleyball only — beach has no substitutions.'),
  ('subs_b',       'input',           NULL, false, 22, 'half', 'Volleyball only — beach has no substitutions.'),
  ('fouls_a',      'input',           NULL, false, 23, 'half', 'Basketball team fouls this period.'),
  ('fouls_b',      'input',           NULL, false, 24, 'half', 'Basketball team fouls this period.'),
  ('serving_team', 'select-dropdown',
     '{"choices":[{"text":"Left (team A)","value":"left"},{"text":"Right (team B)","value":"right"}]}',
     false, 25, 'half', 'Volleyball/beach: serve. Basketball: possession arrow.'),
  ('set_results',  'input-code',      NULL, false, 26, 'full',
     'Completed sets, oldest first: [{"a":25,"b":20}, …].'),
  ('date_updated', 'datetime',        NULL, true,  27, 'half', NULL)
) AS v(field, interface, options, readonly, sort, width, note)
WHERE NOT EXISTS (
  SELECT 1 FROM directus_fields df
  WHERE df.collection = 'live_scores' AND df.field = v.field
);

-- `date_updated` is the Directus "Date Updated" system field — mark it so Directus
-- stamps it on every write instead of treating it as a plain nullable timestamp.
UPDATE directus_fields
   SET special = 'date-updated'
 WHERE collection = 'live_scores' AND field = 'date_updated'
   AND (special IS NULL OR special = '');

-- `set_results` is jsonb — tell Directus to (de)serialise it as JSON rather than text.
UPDATE directus_fields
   SET special = 'cast-json'
 WHERE collection = 'live_scores' AND field = 'set_results'
   AND (special IS NULL OR special = '');

-- ── 3. Seed the channel the club's board publishes to ───────────────────────
-- The board self-heals by POSTing this row if it is missing, but seeding it means
-- /live has something to read (and renders its idle empty state) from minute one.
INSERT INTO live_scores (channel, sport, status, side_a, set_results)
VALUES ('kscw', 'volleyball', 'idle', 'left', '[]'::jsonb)
ON CONFLICT (channel) DO NOTHING;
