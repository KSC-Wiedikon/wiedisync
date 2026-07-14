-- Migration 211: per-game match-sheet roster the coach can adjust before kickoff.
--
-- WHY THIS TABLE EXISTS
-- --------------------
-- Coaches want to hand a phone to the referee (player IDs) and to the scorer (the
-- line-up) in the 45 minutes before a game. The sheet they show is *not* quite what
-- any existing table holds:
--
--   * jersey number lives on members.number — CLUB-WIDE. A player in two teams has one
--     number, which is wrong on at least one of the two match sheets.
--   * captain lives on teams.captain — the SEASON's captain, not the one wearing the
--     armband on a Saturday the regular captain is ill.
--   * libero is not stored at all; it is a value inside members.position, and it is a
--     per-MATCH designation in the rules, not a property of a person.
--
-- Writing the coach's pre-game tweak back into members/teams would let one Saturday
-- rewrite a player's club-wide number and the team's captain. So the tweak lives here
-- instead: one row per (game, player), scoped to the game, touching nothing else.
--
-- RELATIONSHIP TO THE EINSATZLISTE (read this before extending)
-- ------------------------------------------------------------
-- The legal document is Volleymanager's Einsatzliste. This table NEVER writes to it.
--   * number / is_captain / is_libero do not exist on the Einsatzliste at all, so
--     editing them cannot contradict it. They are ours alone.
--   * `added` / `dropped` DO diverge from it. They are the emergency door — a player
--     turns up who was not nominated, or a nominated one does not turn up. The UI shows
--     a red banner saying the change must also be made by hand in Volleymanager,
--     because we do not push it.
--
-- ⚠ Interaction with migration 206 (auto_nomination_list): that cron files the
-- Einsatzliste from RSVPs ~60 min before kickoff and CLOSES it. The coach's edit window
-- opens at −45 min, i.e. AFTER the close. It is dormant today (no team enables it, no
-- game has ever been pushed), but if it is ever switched on, a coach's emergency
-- add/drop would land on an already-closed list. Reconcile the two before enabling it.
--
-- SNAPSHOT, NOT A DIFF
-- -------------------
-- Rows are written only when a coach first edits a game's sheet, and then the FULL sheet
-- is persisted — not just the changed rows. That makes the read path trivial (rows exist
-- → they are the sheet; no rows → derive from VM/RSVP as today) and it preserves the
-- sheet exactly as it was shown, which matters when someone asks three weeks later who
-- was on court. Name/DoB/licence are denormalised for the same reason, and so that a VM
-- player with no matching `members` row (licence not in our register) survives the
-- snapshot instead of silently vanishing from it.
--
-- Schema-only + idempotent, per the migration policy.

BEGIN;

CREATE TABLE IF NOT EXISTS game_rosters (
  id            serial PRIMARY KEY,
  game          integer NOT NULL REFERENCES games(id) ON DELETE CASCADE,

  -- NULL = a player on the Einsatzliste whose licence number matches no `members` row.
  -- We still show them (VM is the legal list), we just cannot link them.
  member        integer REFERENCES members(id) ON DELETE SET NULL,

  -- Denormalised so the sheet survives a member rename/deletion and so unmatched VM
  -- players keep their identity. Sourced from VM, else from `members`.
  last_name     varchar(100) NOT NULL DEFAULT '',
  first_initial varchar(8)   NOT NULL DEFAULT '',
  birthdate     date,
  licence       varchar(16),
  eligible      boolean NOT NULL DEFAULT true,

  -- The three the coach owns. None of them exist on the Einsatzliste.
  number        integer,
  is_captain    boolean NOT NULL DEFAULT false,
  is_libero     boolean NOT NULL DEFAULT false,

  -- The two that DO diverge from the Einsatzliste.
  added         boolean NOT NULL DEFAULT false,  -- not nominated; put on by the coach
  dropped       boolean NOT NULL DEFAULT false,  -- nominated; struck off by the coach

  -- Which source seeded the snapshot, so the UI can still caption the sheet.
  source        varchar(8) NOT NULL DEFAULT 'vm',

  -- Actor capture: this endpoint writes via raw knex and so bypasses Directus's
  -- revision trail (CLAUDE.md → Audit logging).
  edited_by_name  varchar(150),
  edited_by_email varchar(150),

  date_created  timestamptz NOT NULL DEFAULT now(),
  date_updated  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE game_rosters IS
  'Per-game match sheet as the coach adjusted it. Snapshot written on first edit; empty '
  'means "derive from the Einsatzliste / RSVPs". Never pushed to Volleymanager.';
COMMENT ON COLUMN game_rosters.number IS
  'Jersey for THIS game. Seeded from members.number (which is club-wide and therefore '
  'wrong for anyone playing in two teams); the coach corrects it here.';
COMMENT ON COLUMN game_rosters.is_libero IS
  'Libero for THIS match. Seeded from members.position containing "libero". A per-match '
  'designation in the rules — deliberately not a property of the person.';
COMMENT ON COLUMN game_rosters.added IS
  'Not on the Einsatzliste. Diverges from Volleymanager — must be entered there by hand.';
COMMENT ON COLUMN game_rosters.dropped IS
  'On the Einsatzliste but struck off. Diverges from Volleymanager — must be entered there by hand.';

-- One row per player per game. Partial, because `member` is nullable for unmatched VM
-- players and NULLs do not collide in a plain unique index.
CREATE UNIQUE INDEX IF NOT EXISTS idx_game_rosters_game_member
  ON game_rosters (game, member) WHERE member IS NOT NULL;

-- The read path is always "the sheet for one game".
CREATE INDEX IF NOT EXISTS idx_game_rosters_game ON game_rosters (game);

-- ── Directus registration ────────────────────────────────────────────────────
-- Without these the items API and the admin dashboard cannot see the collection at all.

INSERT INTO directus_collections (collection, icon, note, hidden, singleton, "group", sort_field)
SELECT 'game_rosters', 'assignment_ind',
       'Per-game match sheet as adjusted by the coach. Never pushed to Volleymanager.',
       false, false, NULL, NULL
WHERE NOT EXISTS (SELECT 1 FROM directus_collections WHERE collection = 'game_rosters');

INSERT INTO directus_fields (collection, field, interface, readonly, hidden, sort, width, note)
SELECT 'game_rosters', v.field, v.interface, v.readonly, false, v.sort, 'half', v.note
FROM (VALUES
  ('game',            'select-dropdown-m2o', false, 1,  'The game this sheet belongs to.'),
  ('member',          'select-dropdown-m2o', false, 2,  'NULL for an Einsatzliste player whose licence matches no member.'),
  ('last_name',       'input',               false, 3,  'Denormalised so the sheet survives a rename.'),
  ('first_initial',   'input',               false, 4,  'Initial only — the match sheet never carries full first names.'),
  ('birthdate',       'datetime',            false, 5,  'Full DoB: the scorer needs ages for eligibility.'),
  ('licence',         'input',               false, 6,  'Licence category (RLL / JLL / DLR). Volleymanager source only.'),
  ('eligible',        'boolean',             false, 7,  'Volleymanager''s eligibility verdict at snapshot time.'),
  ('number',          'input',               false, 8,  'Jersey for this game only.'),
  ('is_captain',      'boolean',             false, 9,  'Captain for this game only — not teams.captain.'),
  ('is_libero',       'boolean',             false, 10, 'Libero for this match only.'),
  ('added',           'boolean',             false, 11, 'Added by the coach; NOT on the Einsatzliste.'),
  ('dropped',         'boolean',             false, 12, 'Struck off by the coach; still ON the Einsatzliste.'),
  ('source',          'input',               true,  13, 'Which source seeded the snapshot (vm / rsvp).'),
  ('edited_by_name',  'input',               true,  14, 'Actor capture — raw-knex writes bypass the Directus revision trail.'),
  ('edited_by_email', 'input',               true,  15, 'Actor capture.'),
  ('date_created',    'datetime',            true,  16, NULL),
  ('date_updated',    'datetime',            true,  17, NULL)
) AS v(field, interface, readonly, sort, note)
WHERE NOT EXISTS (
  SELECT 1 FROM directus_fields df
  WHERE df.collection = 'game_rosters' AND df.field = v.field
);

-- M2O relations, so the dashboard can follow game → sheet and sheet → member.
INSERT INTO directus_relations (many_collection, many_field, one_collection)
SELECT 'game_rosters', 'game', 'games'
WHERE NOT EXISTS (
  SELECT 1 FROM directus_relations
  WHERE many_collection = 'game_rosters' AND many_field = 'game'
);

INSERT INTO directus_relations (many_collection, many_field, one_collection)
SELECT 'game_rosters', 'member', 'members'
WHERE NOT EXISTS (
  SELECT 1 FROM directus_relations
  WHERE many_collection = 'game_rosters' AND many_field = 'member'
);

COMMIT;
