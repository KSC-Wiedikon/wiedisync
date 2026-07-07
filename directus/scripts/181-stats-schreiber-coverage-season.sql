-- Migration 181: add a `season` dimension to stats_schreiber_coverage.
--
-- Problem: the Club-stats "Schreiber coverage" view aggregated home games and
-- their duty assignments across ALL seasons (FROM teams LEFT JOIN games … with
-- no season/date filter, GROUP BY team only). At the 2026/27 season start the
-- games table holds ~196 completed 2025/26 home games + ~80 scheduled 2026/27
-- home games, so the coverage numbers were dominated by the finished season —
-- the page read as "old season data".
--
-- Fix: expose `g.season` as a column and add it to GROUP BY so the view yields
-- one row per (team, season). The Club-stats page then filters to a selected
-- season (default = current). stats_game_results already carries `season`.
--
-- Shape change: teams with games in >1 season now return one row per season; a
-- team with no home games returns a single row with season = NULL,
-- total_home_games = 0 (the page hides zero-game rows and season = NULL).
--
-- Recreated WITH (security_invoker = true) to preserve the control set by
-- migrations 004/072 (a CASCADE recreate would otherwise drop the reloption and
-- silently revert to security_definer). Nothing depends on this view, so the
-- CASCADE drops nothing else.
--
-- Schema-only + idempotent (DROP IF EXISTS … then CREATE). After applying,
-- regenerate SCHEMA.sql (`npm run db:baseline:prod`).

BEGIN;

DROP VIEW IF EXISTS stats_schreiber_coverage CASCADE;

CREATE VIEW stats_schreiber_coverage WITH (security_invoker = true) AS
SELECT
  t.id                                                AS team_id,
  t.name                                              AS team_name,
  t.sport,
  g.season                                            AS season,
  -- Total home games (schreiber duty is for home games)
  COUNT(DISTINCT g.id)                                AS total_home_games,

  -- === VOLLEYBALL duties ===
  COUNT(DISTINCT g.id) FILTER (
    WHERE t.sport = 'volleyball' AND g.scorer_member IS NOT NULL
  )                                                   AS vb_scorer_assigned,
  COUNT(DISTINCT g.id) FILTER (
    WHERE t.sport = 'volleyball' AND g.scoreboard_member IS NOT NULL
  )                                                   AS vb_scoreboard_assigned,
  COUNT(DISTINCT g.id) FILTER (
    WHERE t.sport = 'volleyball' AND g.scorer_scoreboard_member IS NOT NULL
  )                                                   AS vb_scorer_scoreboard_assigned,
  -- VB: games with ANY schreiber duty set
  COUNT(DISTINCT g.id) FILTER (
    WHERE t.sport = 'volleyball' AND (
      g.scorer_member IS NOT NULL
      OR g.scoreboard_member IS NOT NULL
      OR g.scorer_scoreboard_member IS NOT NULL
    )
  )                                                   AS vb_any_duty_assigned,
  -- VB: games MISSING all duties
  COUNT(DISTINCT g.id) FILTER (
    WHERE t.sport = 'volleyball'
      AND g.scorer_member IS NULL
      AND g.scoreboard_member IS NULL
      AND g.scorer_scoreboard_member IS NULL
  )                                                   AS vb_no_duty_assigned,

  -- === BASKETBALL duties ===
  COUNT(DISTINCT g.id) FILTER (
    WHERE t.sport = 'basketball' AND g.bb_scorer_member IS NOT NULL
  )                                                   AS bb_scorer_assigned,
  COUNT(DISTINCT g.id) FILTER (
    WHERE t.sport = 'basketball' AND g.bb_timekeeper_member IS NOT NULL
  )                                                   AS bb_timekeeper_assigned,
  COUNT(DISTINCT g.id) FILTER (
    WHERE t.sport = 'basketball' AND g.bb_24s_official IS NOT NULL
  )                                                   AS bb_24s_assigned,
  -- BB: games with ANY duty set
  COUNT(DISTINCT g.id) FILTER (
    WHERE t.sport = 'basketball' AND (
      g.bb_scorer_member IS NOT NULL
      OR g.bb_timekeeper_member IS NOT NULL
      OR g.bb_24s_official IS NOT NULL
    )
  )                                                   AS bb_any_duty_assigned,
  -- BB: games MISSING all duties
  COUNT(DISTINCT g.id) FILTER (
    WHERE t.sport = 'basketball'
      AND g.bb_scorer_member IS NULL
      AND g.bb_timekeeper_member IS NULL
      AND g.bb_24s_official IS NULL
  )                                                   AS bb_no_duty_assigned

FROM teams t
LEFT JOIN games g ON g.kscw_team = t.id AND g.type = 'home'
WHERE t.active = true
GROUP BY t.id, t.name, t.sport, g.season;

COMMIT;
