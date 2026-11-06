-- Migration 449: an HU20 home game's second role is a Täfeler, not a Schreiber (owner, 06.11.2026).
--
-- Corrects migration 447's HU20 branch of stats_games_missing_scorer. "Missing" for
-- HU20 = referee OR Täfeler unfilled, and the label names whichever is open. Other VB
-- games and basketball are unchanged.
--
-- Schema-only + idempotent. Same columns, so CREATE OR REPLACE needs no drop.
-- Regenerate SCHEMA.sql after applying.

BEGIN;

CREATE OR REPLACE VIEW stats_games_missing_scorer WITH (security_invoker = true) AS
SELECT
  g.id                AS game_id,
  g.date              AS game_date,
  g.time              AS game_time,
  g.home_team,
  g.away_team,
  g.league,
  t.id                AS team_id,
  t.name              AS team_name,
  t.sport,
  CASE
    WHEN t.sport = 'volleyball' AND t.name = 'HU20' THEN
      CONCAT_WS(', ',
        CASE WHEN g.scoreboard_member IS NULL THEN 'Anzeiger' END,
        CASE WHEN g.referee_member IS NULL THEN 'Schiedsrichter' END
      )
    WHEN t.sport = 'volleyball' THEN
      CONCAT_WS(', ',
        CASE WHEN g.scorer_member IS NULL AND g.scorer_scoreboard_member IS NULL THEN 'Schreiber' END,
        CASE WHEN g.scoreboard_member IS NULL AND g.scorer_scoreboard_member IS NULL THEN 'Anzeiger' END
      )
    WHEN t.sport = 'basketball' THEN
      CONCAT_WS(', ',
        CASE WHEN g.bb_scorer_member IS NULL THEN 'Scorer' END,
        CASE WHEN g.bb_timekeeper_member IS NULL THEN 'Zeitnehmer' END,
        CASE WHEN g.bb_24s_official IS NULL THEN '24s' END
      )
  END                 AS missing_roles,
  COALESCE(g.scorer_duty_team, g.referee_duty_team, g.bb_duty_team) AS duty_team_id
FROM games g
JOIN teams t ON t.id = g.kscw_team
WHERE g.type = 'home'
  AND g.date >= CURRENT_DATE
  AND g.status IN ('scheduled', 'live')
  AND (
    -- HU20: referee + Täfeler, missing if either is unfilled
    (t.sport = 'volleyball' AND t.name = 'HU20'
      AND (g.referee_member IS NULL OR g.scoreboard_member IS NULL))
    OR
    -- Other VB: fully unstaffed
    (t.sport = 'volleyball' AND t.name <> 'HU20'
      AND g.scorer_member IS NULL
      AND g.scoreboard_member IS NULL
      AND g.scorer_scoreboard_member IS NULL)
    OR
    -- BB: missing any duty
    (t.sport = 'basketball'
      AND g.bb_scorer_member IS NULL
      AND g.bb_timekeeper_member IS NULL
      AND g.bb_24s_official IS NULL)
  )
ORDER BY g.date, g.time;

COMMIT;
