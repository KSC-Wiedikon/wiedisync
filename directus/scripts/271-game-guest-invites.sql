-- Migration 271: open a game to another team or to individual players ("guests").
--
-- WHY
-- ---
-- A cup game is filed against exactly one KSCW team (`games.kscw_team`), but the squad
-- that turns up is often wider than that team's roster — H1 plays the cup with two H3
-- players, a junior is pulled up for a Saturday, a libero covers across teams. Today the
-- only way to make that game appear on the borrowed player's home page / calendar is to
-- put them in `member_teams`, which makes them a permanent member of that team
-- everywhere (trainings, absences, attendance stats, ClubDesk groups). That is a
-- season-wide change to answer a one-Saturday question.
--
-- So the invitation lives here instead: scoped to one `games` row, touching nothing else.
--
-- TWO TABLES, ON PURPOSE
-- ---------------------
--   game_guest_teams — the coach's INTENT ("open this game to H3"). One row per opened
--                      team. This is what the UI renders as a removable chip.
--   game_guests      — the MATERIALIZED invitee set, one row per person. Written by
--                      trigger from game_guest_teams, plus hand-added individuals.
--
-- The materialization is deliberate and mirrors `announcement_recipients` (migration
-- 219). Directus row filters cannot AND two expressions through the same M2M alias
-- (CLAUDE.md → "M2M deep filter + policy walk = silent empty"), and every consumer here
-- — the visibility filters, the participations read policy, the notification cron, the
-- roster — wants the flat question "is member X invited to game Y?". A junction walked
-- live would answer that through three levels of alias every time. A flat row answers it
-- with one FK.
--
-- `via_team` records WHICH opening produced a materialized row, so closing an opening
-- removes exactly its own rows and leaves hand-invited individuals alone. NULL means
-- "invited as an individual" and therefore survives any team opening being closed.
--
-- WHAT A GUEST IS NOT
-- -------------------
-- A guest is invited, not rostered. They are deliberately absent from:
--   * member_teams — no team membership is created, so trainings/absences/stats/ClubDesk
--     are all untouched.
--   * the auto-confirm sweep — being lent to a game is not consent to play it; the guest
--     must answer for themselves. (Absence auto-decline DOES cover them: someone marked
--     absent that day should not sit in the roster as "no response".)
--
-- Schema-only + idempotent, per the migration policy. Permissions live in
-- setup-permissions.mjs and are NOT written here.

BEGIN;

-- ── 1. Tables ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS game_guest_teams (
  id               serial PRIMARY KEY,
  game             integer NOT NULL REFERENCES games(id)  ON DELETE CASCADE,
  team             integer NOT NULL REFERENCES teams(id)  ON DELETE CASCADE,

  -- Actor capture. The UI writes these through the items API (which Directus
  -- revision-logs on its own), but the trigger-materialized child rows copy them
  -- down so `game_guests` can name who opened the door without a join.
  invited_by_name  varchar(150),
  invited_by_email varchar(150),

  date_created     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT game_guest_teams_unique UNIQUE (game, team)
);

CREATE TABLE IF NOT EXISTS game_guests (
  id               serial PRIMARY KEY,
  game             integer NOT NULL REFERENCES games(id)   ON DELETE CASCADE,
  member           integer NOT NULL REFERENCES members(id) ON DELETE CASCADE,

  -- NULL = invited as an individual (survives any team opening being closed).
  -- Non-NULL = materialized from the game_guest_teams row for that team.
  via_team         integer REFERENCES teams(id) ON DELETE CASCADE,

  invited_by_name  varchar(150),
  invited_by_email varchar(150),

  date_created     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT game_guests_unique UNIQUE (game, member)
);

COMMENT ON TABLE game_guest_teams IS
  'A coach opening one game to another team. Materializes into game_guests by trigger. '
  'Creates NO member_teams row — the borrowed players stay off that team everywhere else.';
COMMENT ON TABLE game_guests IS
  'Who is invited to a game beyond its own roster. One row per person. Drives the game''s '
  'visibility on their home/calendar, their right to RSVP, and their line in the roster.';
COMMENT ON COLUMN game_guests.via_team IS
  'The game_guest_teams opening that produced this row. NULL = invited individually, which '
  'is why closing a team opening never removes a hand-picked guest.';

CREATE INDEX IF NOT EXISTS idx_game_guests_game        ON game_guests (game);
CREATE INDEX IF NOT EXISTS idx_game_guests_member      ON game_guests (member);
CREATE INDEX IF NOT EXISTS idx_game_guests_via_team    ON game_guests (via_team);
CREATE INDEX IF NOT EXISTS idx_game_guest_teams_game   ON game_guest_teams (game);
CREATE INDEX IF NOT EXISTS idx_game_guest_teams_team   ON game_guest_teams (team);

-- ── 2. Guard: a guest is someone from OUTSIDE the game's own roster ──────────
-- Inviting a player who is already on games.kscw_team would give them two lines in the
-- merged roster and two claims on the same RSVP row. Silently skipped rather than
-- raised: the picker filters them out already, and a team opening that happens to
-- overlap (a player in both H1 and H3) must not abort the whole opening.

CREATE OR REPLACE FUNCTION game_guests_skip_own_roster() RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM games g
    JOIN member_teams mt ON mt.team = g.kscw_team AND mt.member = NEW.member
    WHERE g.id = NEW.game
  ) THEN
    RETURN NULL;  -- BEFORE INSERT returning NULL = skip this row, keep the statement
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_game_guests_0_skip_own_roster ON game_guests;
CREATE TRIGGER trg_game_guests_0_skip_own_roster
  BEFORE INSERT ON game_guests
  FOR EACH ROW EXECUTE FUNCTION game_guests_skip_own_roster();

-- ── 3. Materialize a team opening into per-person rows ──────────────────────
-- Every member_teams row of the opened team, whatever their guest_level: being invited
-- is not the same as being auto-confirmed, and a team's own guest players are exactly
-- the people a coach reaches for. ON CONFLICT DO NOTHING because an individually-invited
-- member (via_team NULL) must keep that stronger claim.

CREATE OR REPLACE FUNCTION game_guest_teams_materialize() RETURNS trigger AS $$
BEGIN
  INSERT INTO game_guests (game, member, via_team, invited_by_name, invited_by_email)
  SELECT NEW.game, mt.member, NEW.team, NEW.invited_by_name, NEW.invited_by_email
  FROM member_teams mt
  WHERE mt.team = NEW.team
  ON CONFLICT (game, member) DO NOTHING;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_game_guest_teams_materialize ON game_guest_teams;
CREATE TRIGGER trg_game_guest_teams_materialize
  AFTER INSERT ON game_guest_teams
  FOR EACH ROW EXECUTE FUNCTION game_guest_teams_materialize();

-- Closing an opening removes only the rows that opening created. Individually-invited
-- guests (via_team IS NULL) are untouched by design.
CREATE OR REPLACE FUNCTION game_guest_teams_unmaterialize() RETURNS trigger AS $$
BEGIN
  DELETE FROM game_guests
  WHERE game = OLD.game AND via_team = OLD.team;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_game_guest_teams_unmaterialize ON game_guest_teams;
CREATE TRIGGER trg_game_guest_teams_unmaterialize
  AFTER DELETE ON game_guest_teams
  FOR EACH ROW EXECUTE FUNCTION game_guest_teams_unmaterialize();

-- ── 4. Keep team openings honest as the roster moves ────────────────────────
-- A player joining H3 after H1's cup game was opened to H3 should still be invited;
-- one leaving H3 should stop being. Bounded to games that have not happened yet — a
-- past game's invitee list is a record of who was asked and must not be rewritten.

CREATE OR REPLACE FUNCTION member_teams_sync_game_guests() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO game_guests (game, member, via_team, invited_by_name, invited_by_email)
    SELECT gt.game, NEW.member, gt.team, gt.invited_by_name, gt.invited_by_email
    FROM game_guest_teams gt
    JOIN games g ON g.id = gt.game
    WHERE gt.team = NEW.team
      AND g.date >= CURRENT_DATE
    ON CONFLICT (game, member) DO NOTHING;
  ELSE
    DELETE FROM game_guests gg
    USING games g
    WHERE gg.game = g.id
      AND gg.member = OLD.member
      AND gg.via_team = OLD.team
      AND g.date >= CURRENT_DATE;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_member_teams_sync_game_guests ON member_teams;
CREATE TRIGGER trg_member_teams_sync_game_guests
  AFTER INSERT OR DELETE ON member_teams
  FOR EACH ROW EXECUTE FUNCTION member_teams_sync_game_guests();

-- ── 5. Un-inviting withdraws the RSVP ───────────────────────────────────────
-- A guest's participation row is only legitimate while the invitation stands; leaving it
-- behind would keep a stranger in the roster and in the RSVP counts with no way for
-- anyone to see why. Scoped to guests: a member who is ALSO on the game's own roster
-- owns their RSVP outright and must keep it.

CREATE OR REPLACE FUNCTION game_guests_purge_participation() RETURNS trigger AS $$
BEGIN
  DELETE FROM participations p
  WHERE p.activity_type = 'game'
    AND p.activity_id   = OLD.game::text
    AND p.member        = OLD.member
    AND NOT EXISTS (
      SELECT 1
      FROM games g
      JOIN member_teams mt ON mt.team = g.kscw_team AND mt.member = OLD.member
      WHERE g.id = OLD.game
    );
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_game_guests_purge_participation ON game_guests;
CREATE TRIGGER trg_game_guests_purge_participation
  AFTER DELETE ON game_guests
  FOR EACH ROW EXECUTE FUNCTION game_guests_purge_participation();

-- ── 6. Directus registration ────────────────────────────────────────────────
-- Without these the items API and the admin dashboard cannot see the collections.

INSERT INTO directus_collections (collection, icon, note, hidden, singleton, "group", sort_field)
SELECT 'game_guest_teams', 'group_add',
       'A game opened to another team. Materializes into game_guests by trigger.',
       false, false, NULL, NULL
WHERE NOT EXISTS (SELECT 1 FROM directus_collections WHERE collection = 'game_guest_teams');

INSERT INTO directus_collections (collection, icon, note, hidden, singleton, "group", sort_field)
SELECT 'game_guests', 'person_add',
       'Players invited to a game from outside its own roster. Creates no team membership.',
       false, false, NULL, NULL
WHERE NOT EXISTS (SELECT 1 FROM directus_collections WHERE collection = 'game_guests');

INSERT INTO directus_fields (collection, field, interface, readonly, hidden, sort, width, note)
SELECT 'game_guest_teams', v.field, v.interface, v.readonly, false, v.sort, 'half', v.note
FROM (VALUES
  ('game',             'select-dropdown-m2o', false, 1, 'The game being opened.'),
  ('team',             'select-dropdown-m2o', false, 2, 'The team it is opened to. Same sport as the game''s team.'),
  ('invited_by_name',  'input',               true,  3, 'Actor capture — copied down onto the materialized game_guests rows.'),
  ('invited_by_email', 'input',               true,  4, 'Actor capture.'),
  ('date_created',     'datetime',            true,  5, NULL)
) AS v(field, interface, readonly, sort, note)
WHERE NOT EXISTS (
  SELECT 1 FROM directus_fields df
  WHERE df.collection = 'game_guest_teams' AND df.field = v.field
);

INSERT INTO directus_fields (collection, field, interface, readonly, hidden, sort, width, note)
SELECT 'game_guests', v.field, v.interface, v.readonly, false, v.sort, 'half', v.note
FROM (VALUES
  ('game',             'select-dropdown-m2o', false, 1, 'The game this person is invited to.'),
  ('member',           'select-dropdown-m2o', false, 2, 'The invited player. NOT added to member_teams.'),
  ('via_team',         'select-dropdown-m2o', false, 3, 'Which team opening produced this row. NULL = invited individually.'),
  ('invited_by_name',  'input',               true,  4, 'Actor capture.'),
  ('invited_by_email', 'input',               true,  5, 'Actor capture.'),
  ('date_created',     'datetime',            true,  6, NULL)
) AS v(field, interface, readonly, sort, note)
WHERE NOT EXISTS (
  SELECT 1 FROM directus_fields df
  WHERE df.collection = 'game_guests' AND df.field = v.field
);

INSERT INTO directus_relations (many_collection, many_field, one_collection)
SELECT v.mc, v.mf, v.oc
FROM (VALUES
  ('game_guest_teams', 'game',     'games'),
  ('game_guest_teams', 'team',     'teams'),
  ('game_guests',      'game',     'games'),
  ('game_guests',      'member',   'members'),
  ('game_guests',      'via_team', 'teams')
) AS v(mc, mf, oc)
WHERE NOT EXISTS (
  SELECT 1 FROM directus_relations r WHERE r.many_collection = v.mc AND r.many_field = v.mf
);

-- ── 7. Reverse (o2m) aliases the row filters traverse ───────────────────────
-- Metadata-only, same shape as migrations 032/033 which added teams.members and
-- members.member_teams for exactly this reason. Each one exists to make a specific
-- permission filter in setup-permissions.mjs expressible:
--
--   games.guests        → "a game I am invited to"                (guest reads the roster)
--   members.game_guests → "this member is a guest of one of my teams' games"
--                                                                 (own team reads the guest)
--   teams.games         → "a team that plays a game I am invited to"
--
-- Without them Directus has no path from the one-side back to the many-side and the
-- filters silently match nothing.

INSERT INTO directus_fields (collection, field, special, interface, hidden)
SELECT v.collection, v.field, 'o2m', 'list-o2m', false
FROM (VALUES
  ('games',   'guests'),
  ('members', 'game_guests'),
  ('teams',   'games')
) AS v(collection, field)
WHERE NOT EXISTS (
  SELECT 1 FROM directus_fields df WHERE df.collection = v.collection AND df.field = v.field
);

UPDATE directus_relations SET one_field = 'guests'
WHERE many_collection = 'game_guests' AND many_field = 'game';

UPDATE directus_relations SET one_field = 'game_guests'
WHERE many_collection = 'game_guests' AND many_field = 'member';

UPDATE directus_relations SET one_field = 'games'
WHERE many_collection = 'games' AND many_field = 'kscw_team';

COMMIT;
