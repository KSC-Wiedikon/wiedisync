-- Migration 107: re-point completed/orphaned games from archived teams to their
-- rolled-over active equivalents.
--
-- Sibling of migration 075 (hall_slots). The /game-scheduling season rollover
-- clones each team into the new season (active=true) and archives the old team
-- (active=false), but it intentionally does NOT re-point SYNCED games — future
-- fixtures re-sync from Swiss Volley / Basketplan onto the active team daily
-- (kscw_team is in their COMPARE_FIELDS, see game-scheduling.js). Past, already
-- COMPLETED fixtures never re-sync, so they stay pointed at the now-archived team.
--
-- The public role can only read teams WHERE active = true, so on the public site
-- (kscw-website Recent Results: team chips + sport icons) those completed games
-- resolve kscw_team -> NULL: no team name, no colour, and the sport icon falls
-- back to volleyball. After the 2026 rollover every completed basketball game
-- (and any completed game whose team was archived) renders nameless with the
-- wrong icon.
--
-- Fix: re-point each game whose kscw_team is an archived team to the active team
-- that is its rolled-over equivalent — same sport, matched by the external key
-- (team_id, else bb_source_id) and falling back to name. Only re-point when the
-- active match is UNAMBIGUOUS (exactly one), so a renamed/duplicated team is left
-- untouched for manual review rather than mis-linked.
--
-- Status-agnostic on purpose (like 075): re-pointing an upcoming game to the
-- active team is exactly what the daily sync would do anyway, so it never
-- conflicts; completed games are the ones that would otherwise stay stranded.
--
-- Idempotent: after the update those games point at active teams, so the join on
-- archived teams matches nothing on re-run. Data-only — no schema or permission
-- changes. The rollover endpoint is unchanged; this cleans up data already on
-- dev/prod. (To stop this recurring each season, the rollover could also
-- re-point completed games — tracked separately.)

BEGIN;

UPDATE games g
SET kscw_team = m.new_id
FROM (
  SELECT old_t.id AS old_id,
         MIN(new_t.id) AS new_id
  FROM teams old_t
  JOIN teams new_t
    ON new_t.active = true
   AND new_t.sport  = old_t.sport
   AND (
        (NULLIF(old_t.team_id, '')      IS NOT NULL AND new_t.team_id      = old_t.team_id)
     OR (NULLIF(old_t.bb_source_id, '') IS NOT NULL AND new_t.bb_source_id = old_t.bb_source_id)
     OR (new_t.name = old_t.name)
   )
  WHERE old_t.active = false
  GROUP BY old_t.id
  HAVING COUNT(DISTINCT new_t.id) = 1   -- only unambiguous matches
) m
WHERE g.kscw_team = m.old_id;

COMMIT;

-- ── Verification ───────────────────────────────────────────────────────────
-- Run BEFORE to preview the blast radius, AFTER to confirm there are no orphans
-- left (other than any ambiguous teams the second query reports).
--
--   -- 1. Games still pointing at an archived team (expect 0 after, minus any
--   --    teams listed by query 2):
--   SELECT g.id, g.game_id, g.status, t.id AS archived_team, t.name, t.sport
--   FROM games g JOIN teams t ON t.id = g.kscw_team
--   WHERE t.active = false
--   ORDER BY g.date DESC;
--
--   -- 2. Archived teams that have games but NO single active match (skipped by
--   --    the migration — review/relink by hand):
--   SELECT old_t.id, old_t.name, old_t.sport, old_t.team_id, old_t.bb_source_id,
--          COUNT(DISTINCT new_t.id) AS active_matches
--   FROM teams old_t
--   LEFT JOIN teams new_t
--     ON new_t.active = true AND new_t.sport = old_t.sport
--    AND ( (NULLIF(old_t.team_id,'')      IS NOT NULL AND new_t.team_id      = old_t.team_id)
--       OR (NULLIF(old_t.bb_source_id,'') IS NOT NULL AND new_t.bb_source_id = old_t.bb_source_id)
--       OR (new_t.name = old_t.name) )
--   WHERE old_t.active = false
--     AND EXISTS (SELECT 1 FROM games g WHERE g.kscw_team = old_t.id)
--   GROUP BY old_t.id
--   HAVING COUNT(DISTINCT new_t.id) <> 1;
