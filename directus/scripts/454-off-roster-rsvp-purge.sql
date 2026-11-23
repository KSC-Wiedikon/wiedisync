-- Migration 454: taking someone off a team takes away their FUTURE answers on
-- that team's trainings and games.
--
-- WHY. Team auto-confirm (features_enabled.training_auto_confirm /
-- game_auto_confirm, kscw-hooks) seeds a `confirmed` row for every roster
-- member on every upcoming training of the season the moment the trainings
-- are generated or the toggle is switched on. Nothing ever removed those rows
-- when a member LEFT the team, so a former player kept "coming" to every
-- training until the end of the season:
--
--   23.11.2026, D1 training 2371: the answer buttons said Ja 10 / Nein 6, the
--   roster modal 8 Zugesagt / 5 Abgesagt. The difference was three people who
--   had left the club, with no D1 2026/27 roster row, holding 110 future rows
--   on D1 trainings up to 14.07.2027.
--
-- On prod that day: 427 future training rows (325 confirmed) and 26 future
-- game rows from 22 people across 8 teams. The roster modal lists the roster,
-- so it never showed them, but every other tally counted them —
-- useParticipationCounts (card counters + answer buttons) and the
-- min-participants auto-cancel gate (autoCancelTrainingsUnderMin), which could
-- keep an under-strength training alive on the strength of people who left.
-- sweepGameClashDeclines pass 2 then even rewrote some of them to "declined —
-- Game <other team>", which is how 10 players of one team ended up declined on
-- another team's training.
--
-- WHAT.
--   1. A DEFERRED constraint trigger on member_teams DELETE: at COMMIT, if the
--      member no longer has ANY row on that team, delete their non-staff answers
--      on the team's trainings and games dated today or later. Deferred so a
--      delete + re-insert in one transaction (Directus M2M updates sending a
--      link without its junction PK create the new row and delete the old one)
--      keeps the answers. Past answers stay: they are attendance history.
--      Staff rows (is_staff) stay: staff hold no roster row by design, they
--      come from teams_coaches / teams_responsibles. A game guest
--      (game_guests, migration 271) keeps their answer on that game.
--   2. One-time purge of the rows that already leaked, with the same rule.
--
-- Rows are deleted, not declined: for the coach a person who left the team is
-- not "absent", they are not on the list at all — exactly what the roster
-- modal already shows. If the member is put back on the team, team
-- auto-confirm seeds their answers again (member_teams create hook).
--
-- Idempotent (safe to re-run).

BEGIN;

CREATE OR REPLACE FUNCTION trg_member_teams_purge_future_rsvps() RETURNS trigger AS $$
BEGIN
  IF OLD.member IS NULL OR OLD.team IS NULL THEN
    RETURN NULL;
  END IF;
  -- Still on the team (re-added in the same transaction, or a duplicate row)?
  IF EXISTS (SELECT 1 FROM member_teams mt WHERE mt.member = OLD.member AND mt.team = OLD.team) THEN
    RETURN NULL;
  END IF;

  DELETE FROM participations p
   USING trainings t
   WHERE p.activity_type = 'training'
     AND p.training = t.id
     AND t.team = OLD.team
     AND t.date >= CURRENT_DATE
     AND p.member = OLD.member
     AND p.is_staff = false;

  DELETE FROM participations p
   USING games g
   WHERE p.activity_type = 'game'
     AND p.activity_id = g.id::text
     AND g.kscw_team = OLD.team
     AND g.date >= CURRENT_DATE
     AND p.member = OLD.member
     AND p.is_staff = false
     AND NOT EXISTS (SELECT 1 FROM game_guests gg WHERE gg.game = g.id AND gg.member = OLD.member);

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_member_teams_purge_future_rsvps ON member_teams;
CREATE CONSTRAINT TRIGGER trg_member_teams_purge_future_rsvps
  AFTER DELETE ON member_teams
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION trg_member_teams_purge_future_rsvps();

-- ── One-time purge of the rows that already leaked ───────────────────────
DELETE FROM participations p
 USING trainings t
 WHERE p.activity_type = 'training'
   AND p.training = t.id
   AND t.team IS NOT NULL
   AND t.date >= CURRENT_DATE
   AND p.is_staff = false
   AND NOT EXISTS (SELECT 1 FROM member_teams mt WHERE mt.member = p.member AND mt.team = t.team);

DELETE FROM participations p
 USING games g
 WHERE p.activity_type = 'game'
   AND p.activity_id = g.id::text
   AND g.kscw_team IS NOT NULL
   AND g.date >= CURRENT_DATE
   AND p.is_staff = false
   AND NOT EXISTS (SELECT 1 FROM member_teams mt WHERE mt.member = p.member AND mt.team = g.kscw_team)
   AND NOT EXISTS (SELECT 1 FROM game_guests gg WHERE gg.game = g.id AND gg.member = p.member);

COMMIT;
