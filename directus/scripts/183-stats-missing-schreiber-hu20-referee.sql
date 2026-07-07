-- Migration 183: make stats_games_missing_schreiber HU20-referee-aware.
--
-- HU20 home games are staffed scorer + referee (migration 182), not scorer +
-- Täfeler. The old view flagged a game only when ALL of scorer/scoreboard/combined
-- were empty and labelled the second VB role "Anzeiger" (Täfeler) — so an HU20
-- game read as "missing Anzeiger" (wrong role) and an HU20 game that had a scorer
-- but no referee wasn't flagged at all.
--
-- Fix: for HU20 games, "missing" = scorer OR referee unfilled, and the label uses
-- "Schiedsrichter" instead of "Anzeiger". All other VB games and basketball are
-- unchanged. Recreated WITH (security_invoker = true) to preserve the 004/072
-- control (a plain CASCADE recreate drops the reloption). Nothing depends on this
-- view, so the CASCADE drops nothing else.
--
-- Schema-only + idempotent. After applying, regenerate SCHEMA.sql.

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
  -- Which specific roles are missing
  CASE
    WHEN t.sport = 'volleyball' AND t.name = 'HU20' THEN
      CONCAT_WS(', ',
        CASE WHEN g.scorer_member IS NULL AND g.scorer_scoreboard_member IS NULL THEN 'Schreiber' END,
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
  -- Duty team (if a different team should provide the schreiber)
  COALESCE(g.scorer_duty_team, g.bb_duty_team) AS duty_team_id
FROM games g
JOIN teams t ON t.id = g.kscw_team
WHERE g.type = 'home'
  AND g.date >= CURRENT_DATE
  AND g.status IN ('scheduled', 'live')
  AND (
    -- HU20: scorer + referee — missing if either is unfilled
    (t.sport = 'volleyball' AND t.name = 'HU20'
      AND (g.scorer_member IS NULL OR g.referee_member IS NULL))
    OR
    -- Other VB: fully unstaffed (pre-183 behaviour)
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
