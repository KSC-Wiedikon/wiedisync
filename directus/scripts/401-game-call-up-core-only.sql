-- Migration 401: calling up a whole team brings its regular players only, not its guests.
--
-- WHY
-- ---
-- Migration 271 materialized a team opening ("open this game to H3") into one
-- game_guests row for EVERY member_teams row of that team, whatever its guest_level, on
-- the theory that a team's guest players are the people a coach reaches for. In practice
-- an H1 cup game opened to H3 filled the RSVP sheet with H3's guests — people who train
-- there now and then and were never meant to be asked — each one a "no response" line
-- and a push. Decided 07.10.2026: a team call-up is the team's regular players
-- (guest_level 0), automatically. A guest the coach really wants is still one search
-- away in "Or pick individual players"; that path is a deliberate pick by name and stays
-- open to everyone.
--
-- WHAT CHANGES
-- ------------
--   1. game_guest_teams_materialize() — the opening copies in guest_level 0 rows only.
--   2. member_teams_sync_game_guests() — the roster follow-up applies the same rule:
--      a regular player joining an opened team is called up, a guest joining is not;
--      and it now also fires on UPDATE, so promoting a guest to a regular player calls
--      them up and demoting a regular player to a guest withdraws the call-up. Leaving
--      the team withdraws it as before. Still bounded to games that have not happened.
--   3. Backfill — upcoming games drop the rows a team opening brought in for people who
--      are not a regular player of that team. Anyone who already said yes or maybe
--      stays: the coach may be counting on them, and removing a "yes" is not ours to do
--      silently. The game_guests delete trigger (271 §5) withdraws the dropped people's
--      RSVPs with them. Past games are a record of who was asked and are left alone.
--      Individually invited people (via_team IS NULL) are never touched.
--
-- Schema-only + idempotent, per the migration policy. No permission rows.

BEGIN;

-- ── 1. A team opening materializes its regular players only ─────────────────

CREATE OR REPLACE FUNCTION game_guest_teams_materialize() RETURNS trigger AS $$
BEGIN
  INSERT INTO game_guests (game, member, via_team, invited_by_name, invited_by_email)
  SELECT NEW.game, mt.member, NEW.team, NEW.invited_by_name, NEW.invited_by_email
  FROM member_teams mt
  WHERE mt.team = NEW.team
    AND COALESCE(mt.guest_level, 0) = 0
  ON CONFLICT (game, member) DO NOTHING;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- ── 2. Roster moves follow the same rule ─────────────────────────────────────

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

  -- Withdraw: left the team, moved off it, or went from regular player to guest.
  -- A guest-to-guest level change (1 → 2) withdraws nothing — it is not a change of
  -- standing, and it must not undo the "already said yes" rows the backfill kept.
  IF TG_OP = 'DELETE' OR moved OR (was_core AND NOT is_core) THEN
    DELETE FROM game_guests gg
    USING games g
    WHERE gg.game = g.id
      AND gg.member = OLD.member
      AND gg.via_team = OLD.team
      AND g.date >= CURRENT_DATE;
  END IF;

  -- Call up: a regular player newly on an opened team (joined, moved on, or promoted).
  IF is_core AND (TG_OP = 'INSERT' OR moved OR NOT was_core) THEN
    INSERT INTO game_guests (game, member, via_team, invited_by_name, invited_by_email)
    SELECT gt.game, NEW.member, gt.team, gt.invited_by_name, gt.invited_by_email
    FROM game_guest_teams gt
    JOIN games g ON g.id = gt.game
    WHERE gt.team = NEW.team
      AND g.date >= CURRENT_DATE
    ON CONFLICT (game, member) DO NOTHING;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_member_teams_sync_game_guests ON member_teams;
CREATE TRIGGER trg_member_teams_sync_game_guests
  AFTER INSERT OR DELETE OR UPDATE OF guest_level, member, team ON member_teams
  FOR EACH ROW EXECUTE FUNCTION member_teams_sync_game_guests();

-- ── 3. Backfill: take the guests back off upcoming team call-ups ────────────

DO $$
DECLARE
  dropped integer;
BEGIN
  WITH del AS (
    DELETE FROM game_guests gg
    USING games g
    WHERE gg.game = g.id
      AND gg.via_team IS NOT NULL
      AND g.date >= CURRENT_DATE
      AND NOT EXISTS (
        SELECT 1 FROM member_teams mt
        WHERE mt.member = gg.member
          AND mt.team = gg.via_team
          AND COALESCE(mt.guest_level, 0) = 0
      )
      AND NOT EXISTS (
        SELECT 1 FROM participations p
        WHERE p.activity_type = 'game'
          AND p.activity_id = g.id::text
          AND p.member = gg.member
          AND p.status IN ('confirmed', 'tentative')
      )
    RETURNING 1
  )
  SELECT count(*) INTO dropped FROM del;
  RAISE NOTICE 'migration 401: % guest call-up row(s) removed from upcoming games', dropped;
END $$;

COMMENT ON TABLE game_guest_teams IS
  'A coach opening one game to another team. Materializes into game_guests by trigger — '
  'the team''s regular players only (guest_level 0, migration 401). Creates NO member_teams '
  'row — the borrowed players stay off that team everywhere else.';
COMMENT ON COLUMN game_guests.via_team IS
  'The game_guest_teams opening that produced this row. NULL = invited individually, which '
  'is why closing a team opening never removes a hand-picked guest. A team opening brings '
  'that team''s regular players only (guest_level 0); its guests are invited by name or not at all.';

COMMIT;
