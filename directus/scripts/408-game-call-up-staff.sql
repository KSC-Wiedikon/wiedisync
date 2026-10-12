-- Migration 408: a team call-up brings the team's coaches and team responsibles too.
--
-- WHY
-- ---
-- Asked 12.10.2026: "if called up H3, why do coaches don't get called up? we call up
-- whole team + coaches. no guests" — and team responsibles as well. A team opening
-- (migration 271, narrowed by 401) copied in `member_teams` rows only, and coaches live
-- in `teams_coaches`, so they were never asked: H3's two coaches were missing from H1's
-- cup game 774, without the game on their home page, calendar or RSVP. A team
-- responsible is usually a regular player and already came along; one who is not
-- (or who is a guest player) did not.
--
-- WHAT CHANGES
-- ------------
--   1. game_guests.is_staff — the person comes as staff of the called-up team, not as
--      a player. Same meaning as a coach on their own team's game (`teamPeopleSql`):
--      they get the game, the push and the RSVP, and stay out of the player counts.
--      Someone who is both a regular player and a coach / TR comes as a player, one row.
--   2. game_guests_skip_own_roster() also skips the game's own coaches and team
--      responsibles: they are already staff on that game, and a second row would list
--      them twice. game_guests_purge_participation() likewise keeps the RSVP of a
--      member who is the game's own staff.
--   3. game_guest_teams_materialize() — the opening copies in the team's regular
--      players (guest_level 0, as since 401) AND its coaches and team responsibles.
--      Guest players still stay out.
--   4. One resync function, game_guests_resync_call_up(member, team), decides a
--      person's row on every upcoming opening of a team from their current standing:
--      regular player → player row; else coach / TR → staff row; else no row. Rows a
--      person got individually or through another team's opening are never touched.
--   5. Roster and staff moves follow it. The member_teams trigger keeps 401's
--      transitions (join / leave / promote / demote; a guest-level change 1 → 2 still
--      touches nothing) but asks the resync function what is left, so a regular
--      player who drops to guest yet still coaches the team stays called up as staff.
--      New triggers on teams_coaches and teams_responsibles: becoming coach / TR of an
--      opened team calls you up, stopping withdraws you unless you still hold the
--      other role or play. Bounded to games that have not happened, as before.
--   6. Backfill: every upcoming opening gets its coaches and team responsibles as
--      staff rows. Silent — SQL writes do not reach the items-API hook that pushes, so
--      nobody is notified about a call-up that is days or weeks old. A person who
--      already has a row on that game keeps it as it is.
--
-- Schema-only + idempotent, per the migration policy. No permission rows: game_guests
-- reads are not field-restricted, and the leader create grant takes all fields.
-- Registers the new field in directus_fields — restart the container after deploy.

BEGIN;

-- ── 1. The column ────────────────────────────────────────────────────────────

ALTER TABLE game_guests ADD COLUMN IF NOT EXISTS is_staff boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN game_guests.is_staff IS
  'Called up as staff (coach or team responsible of the via_team that is not a regular '
  'player of it), migration 408. Staff get the game and answer it, but are not counted '
  'as players — the same rule as a coach on their own team''s game.';

INSERT INTO directus_fields (collection, field, special, interface, options, readonly, hidden, sort, width, note)
SELECT 'game_guests', 'is_staff', 'cast-boolean', 'boolean', NULL::json, true, false, 4, 'half',
       'Called up as staff (coach / team responsible) rather than as a player. Set by trigger.'
WHERE NOT EXISTS (
  SELECT 1 FROM directus_fields WHERE collection = 'game_guests' AND field = 'is_staff'
);

-- ── 2. The game's own people never become its guests ────────────────────────

CREATE OR REPLACE FUNCTION game_guests_skip_own_roster() RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM games g
    WHERE g.id = NEW.game
      AND (
        EXISTS (SELECT 1 FROM member_teams mt
                WHERE mt.team = g.kscw_team AND mt.member = NEW.member)
        OR EXISTS (SELECT 1 FROM teams_coaches tc
                   WHERE tc.teams_id = g.kscw_team AND tc.members_id = NEW.member)
        OR EXISTS (SELECT 1 FROM teams_responsibles tr
                   WHERE tr.teams_id = g.kscw_team AND tr.members_id = NEW.member)
      )
  ) THEN
    RETURN NULL;  -- BEFORE INSERT returning NULL = skip this row, keep the statement
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION game_guests_purge_participation() RETURNS trigger AS $$
BEGIN
  DELETE FROM participations p
  WHERE p.activity_type = 'game'
    AND p.activity_id   = OLD.game::text
    AND p.member        = OLD.member
    AND NOT EXISTS (
      SELECT 1
      FROM games g
      WHERE g.id = OLD.game
        AND (
          EXISTS (SELECT 1 FROM member_teams mt
                  WHERE mt.team = g.kscw_team AND mt.member = OLD.member)
          OR EXISTS (SELECT 1 FROM teams_coaches tc
                     WHERE tc.teams_id = g.kscw_team AND tc.members_id = OLD.member)
          OR EXISTS (SELECT 1 FROM teams_responsibles tr
                     WHERE tr.teams_id = g.kscw_team AND tr.members_id = OLD.member)
        )
    );
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- ── 3. A team opening brings regular players + coaches + team responsibles ───

CREATE OR REPLACE FUNCTION game_guest_teams_materialize() RETURNS trigger AS $$
BEGIN
  INSERT INTO game_guests (game, member, via_team, is_staff, invited_by_name, invited_by_email)
  SELECT NEW.game, p.member, NEW.team, NOT bool_or(p.is_player), NEW.invited_by_name, NEW.invited_by_email
  FROM (
    SELECT mt.member, true AS is_player
    FROM member_teams mt
    WHERE mt.team = NEW.team AND COALESCE(mt.guest_level, 0) = 0
    UNION ALL
    SELECT tc.members_id, false FROM teams_coaches tc WHERE tc.teams_id = NEW.team
    UNION ALL
    SELECT tr.members_id, false FROM teams_responsibles tr WHERE tr.teams_id = NEW.team
  ) p
  WHERE p.member IS NOT NULL
  GROUP BY p.member
  ON CONFLICT (game, member) DO NOTHING;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- ── 4. One person's standing on one team → their rows on its upcoming openings ─

CREATE OR REPLACE FUNCTION game_guests_resync_call_up(p_member integer, p_team integer) RETURNS void AS $$
DECLARE
  v_player boolean;
  v_staff  boolean;
BEGIN
  IF p_member IS NULL OR p_team IS NULL THEN
    RETURN;
  END IF;

  v_player := EXISTS (
    SELECT 1 FROM member_teams
    WHERE member = p_member AND team = p_team AND COALESCE(guest_level, 0) = 0
  );
  v_staff := NOT v_player AND (
    EXISTS (SELECT 1 FROM teams_coaches WHERE teams_id = p_team AND members_id = p_member)
    OR EXISTS (SELECT 1 FROM teams_responsibles WHERE teams_id = p_team AND members_id = p_member)
  );

  IF NOT v_player AND NOT v_staff THEN
    DELETE FROM game_guests gg
    USING games g
    WHERE gg.game = g.id
      AND gg.member = p_member
      AND gg.via_team = p_team
      AND g.date >= CURRENT_DATE;
    RETURN;
  END IF;

  -- The conflict update only touches a row this team's opening produced: a person
  -- invited individually, or through another team, keeps that row as it is.
  INSERT INTO game_guests (game, member, via_team, is_staff, invited_by_name, invited_by_email)
  SELECT gt.game, p_member, gt.team, v_staff, gt.invited_by_name, gt.invited_by_email
  FROM game_guest_teams gt
  JOIN games g ON g.id = gt.game
  WHERE gt.team = p_team
    AND g.date >= CURRENT_DATE
  ON CONFLICT (game, member) DO UPDATE SET is_staff = EXCLUDED.is_staff
    WHERE game_guests.via_team = EXCLUDED.via_team
      AND game_guests.is_staff IS DISTINCT FROM EXCLUDED.is_staff;
END;
$$ LANGUAGE plpgsql;

-- ── 5a. Roster moves: 401's transitions, resolved through the resync function ─

CREATE OR REPLACE FUNCTION member_teams_sync_game_guests() RETURNS trigger AS $$
DECLARE
  moved     boolean := false;
  was_core  boolean := false;
  is_core   boolean := false;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    was_core := COALESCE(OLD.guest_level, 0) = 0;
  END IF;
  IF TG_OP <> 'DELETE' THEN
    is_core := COALESCE(NEW.guest_level, 0) = 0;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    moved := NEW.member IS DISTINCT FROM OLD.member OR NEW.team IS DISTINCT FROM OLD.team;
  END IF;

  -- Left the team, moved off it, or went from regular player to guest: withdrawn,
  -- unless they still coach / are TR of the team (then they stay, as staff). A
  -- guest-to-guest level change (1 → 2) still touches nothing.
  IF TG_OP = 'DELETE' OR moved OR (was_core AND NOT is_core) THEN
    PERFORM game_guests_resync_call_up(OLD.member, OLD.team);
  END IF;

  -- Newly a regular player of an opened team (joined, moved on, or promoted): called
  -- up as a player — a staff row of theirs on that opening becomes a player row.
  IF is_core AND (TG_OP = 'INSERT' OR moved OR NOT was_core) THEN
    PERFORM game_guests_resync_call_up(NEW.member, NEW.team);
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- The trigger itself (AFTER INSERT OR DELETE OR UPDATE OF guest_level, member, team)
-- is unchanged since 401.

-- ── 5b. Staff moves: coaches and team responsibles ───────────────────────────
-- Keys are DB-immutable on both junctions (migration 389), so INSERT and DELETE are
-- the only moves there are.

CREATE OR REPLACE FUNCTION teams_staff_sync_game_guests() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM game_guests_resync_call_up(OLD.members_id, OLD.teams_id);
  ELSE
    PERFORM game_guests_resync_call_up(NEW.members_id, NEW.teams_id);
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_teams_coaches_sync_game_guests ON teams_coaches;
CREATE TRIGGER trg_teams_coaches_sync_game_guests
  AFTER INSERT OR DELETE ON teams_coaches
  FOR EACH ROW EXECUTE FUNCTION teams_staff_sync_game_guests();

DROP TRIGGER IF EXISTS trg_teams_responsibles_sync_game_guests ON teams_responsibles;
CREATE TRIGGER trg_teams_responsibles_sync_game_guests
  AFTER INSERT OR DELETE ON teams_responsibles
  FOR EACH ROW EXECUTE FUNCTION teams_staff_sync_game_guests();

-- ── 6. Backfill: staff onto the upcoming openings ────────────────────────────

DO $$
DECLARE
  added integer;
BEGIN
  WITH ins AS (
    INSERT INTO game_guests (game, member, via_team, is_staff, invited_by_name, invited_by_email)
    SELECT DISTINCT gt.game, s.members_id, gt.team, true, gt.invited_by_name, gt.invited_by_email
    FROM game_guest_teams gt
    JOIN games g ON g.id = gt.game
    JOIN (
      SELECT teams_id, members_id FROM teams_coaches
      UNION
      SELECT teams_id, members_id FROM teams_responsibles
    ) s ON s.teams_id = gt.team
    WHERE g.date >= CURRENT_DATE
      AND s.members_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM member_teams mt
        WHERE mt.team = gt.team AND mt.member = s.members_id AND COALESCE(mt.guest_level, 0) = 0
      )
    ON CONFLICT (game, member) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO added FROM ins;
  RAISE NOTICE 'migration 408: % coach / team responsible row(s) added to upcoming call-ups', added;
END $$;

COMMENT ON TABLE game_guest_teams IS
  'A coach opening one game to another team. Materializes into game_guests by trigger — '
  'the team''s regular players (guest_level 0, migration 401) plus its coaches and team '
  'responsibles as staff (migration 408). Creates NO member_teams row — the borrowed '
  'people stay off that team everywhere else.';
COMMENT ON COLUMN game_guests.via_team IS
  'The game_guest_teams opening that produced this row. NULL = invited individually, which '
  'is why closing a team opening never removes a hand-picked guest. A team opening brings '
  'that team''s regular players (guest_level 0) and its coaches / team responsibles '
  '(is_staff); its guest players are invited by name or not at all.';

COMMIT;
