-- Migration 188: HU20 games need ONLY a referee (no scorer / Täfeler).
--
-- Supersedes migration 183's HU20 branch. HU20 home games are now staffed with a
-- referee alone, so "missing" = referee unfilled (183 also required a scorer, which
-- HU20 games no longer have → every HU20 game read as missing). Label is just
-- "Schiedsrichter". Other VB games and basketball are unchanged.
--
-- Recreated WITH (security_invoker = true) to preserve the 004/072 control.
-- Nothing depends on this view. Schema-only + idempotent. Regenerate SCHEMA.sql
-- after applying.

BEGIN;

DROP VIEW IF EXISTS stats_games_missing_schreiber CASCADE;

CREATE VIEW stats_games_missing_schreiber WITH (security_invoker = true) AS
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
    WHEN t.sport = 'volleyball' AND t.name = 'HU20' THEN 'Schiedsrichter'
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
    -- HU20: referee only
    (t.sport = 'volleyball' AND t.name = 'HU20' AND g.referee_member IS NULL)
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
