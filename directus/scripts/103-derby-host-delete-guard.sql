-- Migration 103: a confirmed derby must never end up with a NULL host.
--
-- `game_scheduling_derbies.leg1_home_team` / `leg2_home_team` reference
-- `teams(id) ON DELETE SET NULL` (migration 090). Deleting a team that hosts a
-- leg of a CONFIRMED derby would therefore null its host column while leaving
-- `confirmed = true` — a confirmed anchor with no home team. The Art. 27 slot
-- clamping (game-scheduling.js) reads confirmed derbies to push every other
-- home-slot offer / away-date for BOTH teams to after the relevant derby date
-- per half; a confirmed-but-hostless row is a malformed anchor that would clamp
-- against a missing team and break the feed.
--
-- A confirmed derby losing one of its two teams is no longer a valid anchor, so:
-- a BEFORE DELETE trigger on `teams` un-confirms (`confirmed = false`) any derby
-- row where the deleted team is leg1_home_team or leg2_home_team, and nulls those
-- host columns to match the FK's ON DELETE SET NULL (so the FK has nothing left
-- to null after the row is no longer confirmed). The spielplaner then re-detects
-- + re-confirms the derby for the surviving team pair if still applicable.
--
-- Fires alongside the migration-003 `trg_teams_protect_delete` guard (which
-- aborts the delete entirely if the team still has member_teams rows). Both run
-- in the same statement's transaction, so if the protect guard aborts, this
-- UPDATE rolls back with it — the un-confirm only persists when the delete
-- actually proceeds.
--
-- Idempotent: CREATE OR REPLACE FUNCTION + DROP/CREATE TRIGGER. search_path
-- pinned. Schema-only, no permission changes.
--
-- Apply on dev:  npm run db:migrate:dev
-- Apply on prod: npm run db:migrate:prod

CREATE OR REPLACE FUNCTION trg_teams_release_derby_host()
RETURNS trigger AS $$
BEGIN
  -- The team being deleted hosts a leg of one or more derbies — un-confirm them
  -- and clear the host pointer (matching the FK's ON DELETE SET NULL). A derby
  -- that loses a team is no longer a valid Art. 27 anchor.
  UPDATE game_scheduling_derbies
  SET confirmed = false,
      leg1_home_team = CASE WHEN leg1_home_team = OLD.id THEN NULL ELSE leg1_home_team END,
      leg2_home_team = CASE WHEN leg2_home_team = OLD.id THEN NULL ELSE leg2_home_team END,
      date_updated = now()
  WHERE leg1_home_team = OLD.id OR leg2_home_team = OLD.id;

  RETURN OLD;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS trg_teams_release_derby_host ON teams;
CREATE TRIGGER trg_teams_release_derby_host
  BEFORE DELETE ON teams
  FOR EACH ROW EXECUTE FUNCTION trg_teams_release_derby_host();
