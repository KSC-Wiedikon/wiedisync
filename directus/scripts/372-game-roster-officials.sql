-- Migration 372: per-game officials (bench staff) on the coach's match sheet.
--
-- The match sheet's officials block — C / AC1 / AC2 / P / M, as printed on the paper
-- scoresheet — used to be read-only: Volleymanager's Einsatzliste names up to three
-- (coach, assistant 1, assistant 2), and when it named none we fell back to the team's
-- `teams_coaches` rows, unlabelled. A coach could neither give someone a role nor bring
-- a physio or a club member who is not on the team's staff.
--
-- Same shape and same rule as game_rosters (migration 211):
--   * SNAPSHOT, NOT A DIFF. Rows are written the first time a coach edits the officials
--     of a game; when rows exist they ARE the officials, and a later VM re-read must not
--     silently revert the coach's correction. No rows → derive from VM / teams_coaches.
--   * NEVER pushed to Volleymanager. Physio and doctor do not exist on the Einsatzliste
--     at all; coach/assistant changes are the coach's to mirror there by hand.
--   * Name + DoB denormalised, so a VM official we hold no member for survives the
--     snapshot and the sheet stays as it was shown.
--
-- Kept in its own table rather than as a `role` column on game_rosters: every reader
-- of game_rosters treats a row as a PLAYER (numbering, captain, libero, the diverges
-- banner), and an official leaking into any of them would be a silent wrong sheet.
--
-- Schema-only + idempotent, per the migration policy.

BEGIN;

CREATE TABLE IF NOT EXISTS game_roster_officials (
  id            serial PRIMARY KEY,
  game          integer NOT NULL REFERENCES games(id) ON DELETE CASCADE,

  -- NULL = a VM-named official whose licence matches no `members` row.
  member        integer REFERENCES members(id) ON DELETE SET NULL,

  last_name     varchar(100) NOT NULL DEFAULT '',
  first_initial varchar(8)   NOT NULL DEFAULT '',
  birthdate     date,

  -- The scoresheet slots. NULL = not yet assigned (a teams_coaches fallback row).
  role          varchar(24)
                CHECK (role IS NULL OR role IN
                  ('coach', 'assistant_coach_1', 'assistant_coach_2', 'physio', 'doctor')),

  source        varchar(8) NOT NULL DEFAULT 'vm',

  -- Actor capture: written via raw knex, bypassing Directus's revision trail.
  edited_by_name  varchar(150),
  edited_by_email varchar(150),

  date_created  timestamptz NOT NULL DEFAULT now(),
  date_updated  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE game_roster_officials IS
  'Per-game officials (C/AC1/AC2/P/M) as the coach set them on the match sheet. Snapshot '
  'written on first edit; empty means "derive from the Einsatzliste / teams_coaches". '
  'Never pushed to Volleymanager.';

-- One slot, one person. Partial: unassigned (NULL-role) rows may repeat.
CREATE UNIQUE INDEX IF NOT EXISTS idx_game_roster_officials_game_role
  ON game_roster_officials (game, role) WHERE role IS NOT NULL;

-- A member sits on the bench once.
CREATE UNIQUE INDEX IF NOT EXISTS idx_game_roster_officials_game_member
  ON game_roster_officials (game, member) WHERE member IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_game_roster_officials_game ON game_roster_officials (game);

-- ── Directus registration ────────────────────────────────────────────────────

INSERT INTO directus_collections (collection, icon, note, hidden, singleton, "group", sort_field)
SELECT 'game_roster_officials', 'sports',
       'Per-game officials on the match sheet as set by the coach. Never pushed to Volleymanager.',
       false, false, NULL, NULL
WHERE NOT EXISTS (SELECT 1 FROM directus_collections WHERE collection = 'game_roster_officials');

INSERT INTO directus_fields (collection, field, interface, readonly, hidden, sort, width, note)
SELECT 'game_roster_officials', v.field, v.interface, v.readonly, false, v.sort, 'half', v.note
FROM (VALUES
  ('game',            'select-dropdown-m2o', false, 1,  'The game this sheet belongs to.'),
  ('member',          'select-dropdown-m2o', false, 2,  'NULL for a VM official whose licence matches no member.'),
  ('last_name',       'input',               false, 3,  'Denormalised so the sheet survives a rename.'),
  ('first_initial',   'input',               false, 4,  'Initial only, as on the scoresheet.'),
  ('birthdate',       'datetime',            false, 5,  'Full DoB, as on the scoresheet.'),
  ('role',            'input',               false, 6,  'coach / assistant_coach_1 / assistant_coach_2 / physio / doctor.'),
  ('source',          'input',               true,  7,  'Which source seeded the snapshot (vm / team).'),
  ('edited_by_name',  'input',               true,  8,  'Actor capture — raw-knex writes bypass the Directus revision trail.'),
  ('edited_by_email', 'input',               true,  9,  'Actor capture.'),
  ('date_created',    'datetime',            true,  10, NULL),
  ('date_updated',    'datetime',            true,  11, NULL)
) AS v(field, interface, readonly, sort, note)
WHERE NOT EXISTS (
  SELECT 1 FROM directus_fields df
  WHERE df.collection = 'game_roster_officials' AND df.field = v.field
);

INSERT INTO directus_relations (many_collection, many_field, one_collection)
SELECT 'game_roster_officials', 'game', 'games'
WHERE NOT EXISTS (
  SELECT 1 FROM directus_relations
  WHERE many_collection = 'game_roster_officials' AND many_field = 'game'
);

INSERT INTO directus_relations (many_collection, many_field, one_collection)
SELECT 'game_roster_officials', 'member', 'members'
WHERE NOT EXISTS (
  SELECT 1 FROM directus_relations
  WHERE many_collection = 'game_roster_officials' AND many_field = 'member'
);

COMMIT;
