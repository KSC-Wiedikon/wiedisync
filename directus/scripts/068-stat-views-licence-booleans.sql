-- Migration 068: rewrite stat views to use boolean licence columns
--
-- Migration 067 added six boolean columns alongside the legacy `licences`
-- (json) column. The stats views from 003-stat-views.sql still query the
-- JSON column via `licences::jsonb @>`. This migration replaces those
-- predicates with bare boolean column reads.
--
-- Three views touched: stats_members, stats_team_roster, stats_club_overview.
-- The other five views in 003-stat-views.sql do not reference licences and
-- are left in place.
--
-- Idempotent: DROP VIEW IF EXISTS … CASCADE then CREATE VIEW. The CASCADE
-- is defensive — these views are leaf views (no dependents) but matching
-- 003-stat-views.sql's pattern keeps the migration safe on re-runs.

BEGIN;

-- ============================================================
-- stats_members — global counts by licence, role, status
-- ============================================================
DROP VIEW IF EXISTS stats_members CASCADE;
CREATE VIEW stats_members AS
SELECT
  COUNT(*)                                                        AS total_members,
  COUNT(*) FILTER (WHERE wiedisync_active = true)                 AS active_wiedisync,
  COUNT(*) FILTER (WHERE shell = true)                            AS shell_accounts,
  COUNT(*) FILTER (WHERE shell = false AND wiedisync_active = true) AS registered_users,
  -- Licences (migration 067: boolean columns, no more JSON predicates)
  COUNT(*) FILTER (WHERE scorer_vb)                               AS licence_scorer_vb,
  COUNT(*) FILTER (WHERE referee_vb)                              AS licence_referee_vb,
  COUNT(*) FILTER (WHERE otr1_bb)                                 AS licence_otr1_bb,
  COUNT(*) FILTER (WHERE otr2_bb)                                 AS licence_otr2_bb,
  -- Roles still live in members.role (json)
  COUNT(*) FILTER (WHERE role::jsonb @> '"superuser"')            AS role_superuser,
  COUNT(*) FILTER (WHERE role::jsonb @> '"admin"')                AS role_admin,
  COUNT(*) FILTER (WHERE role::jsonb @> '"vb_admin"')             AS role_vb_admin,
  COUNT(*) FILTER (WHERE role::jsonb @> '"bb_admin"')             AS role_bb_admin,
  COUNT(*) FILTER (WHERE role::jsonb @> '"vorstand"')             AS role_vorstand
FROM members;

-- ============================================================
-- stats_team_roster — per team: member count, coaches, leadership
-- ============================================================
DROP VIEW IF EXISTS stats_team_roster CASCADE;
CREATE VIEW stats_team_roster AS
SELECT
  t.id                                    AS team_id,
  t.name                                  AS team_name,
  t.sport,
  t.league,
  t.active                                AS team_active,
  COUNT(DISTINCT mt.member)
    FILTER (WHERE mt.guest_level = 0)     AS roster_size,
  COUNT(DISTINCT mt.member)
    FILTER (WHERE mt.guest_level = 0
      AND m.wiedisync_active = true)      AS active_roster_size,
  COUNT(DISTINCT mt.member)
    FILTER (WHERE mt.guest_level > 0)     AS guest_count,
  -- VB licences (migration 067)
  COUNT(DISTINCT mt.member)
    FILTER (WHERE mt.guest_level = 0 AND m.scorer_vb)     AS lic_scorer_vb,
  COUNT(DISTINCT mt.member)
    FILTER (WHERE mt.guest_level = 0 AND m.referee_vb)    AS lic_referee_vb,
  -- BB licences (migration 067)
  COUNT(DISTINCT mt.member)
    FILTER (WHERE mt.guest_level = 0 AND m.otr1_bb)       AS lic_otr1_bb,
  COUNT(DISTINCT mt.member)
    FILTER (WHERE mt.guest_level = 0 AND m.otr2_bb)       AS lic_otr2_bb,
  COUNT(DISTINCT mt.member)
    FILTER (WHERE mt.guest_level = 0 AND m.referee_bb)    AS lic_referee_bb,
  -- Leadership
  (SELECT COUNT(*) FROM teams_coaches tc WHERE tc.teams_id = t.id)              AS coach_count,
  CASE WHEN t.captain IS NOT NULL THEN 1 ELSE 0 END                            AS captain_count,
  (SELECT COUNT(*) FROM teams_responsibles tc WHERE tc.teams_id = t.id)        AS team_responsible_count
FROM teams t
LEFT JOIN member_teams mt ON mt.team = t.id
LEFT JOIN members m ON m.id = mt.member
WHERE t.active = true
GROUP BY t.id, t.name, t.sport, t.league, t.active;

-- ============================================================
-- stats_club_overview — single-row dashboard summary
-- ============================================================
DROP VIEW IF EXISTS stats_club_overview CASCADE;
CREATE VIEW stats_club_overview AS
SELECT
  (SELECT COUNT(*) FROM members WHERE wiedisync_active = true)    AS active_members,
  (SELECT COUNT(DISTINCT mt.member) FROM member_teams mt
    JOIN teams t ON t.id = mt.team AND t.active = true AND t.sport = 'volleyball'
    JOIN members m ON m.id = mt.member AND m.wiedisync_active = true
    WHERE mt.guest_level = 0)                                     AS vb_active_members,
  (SELECT COUNT(DISTINCT mt.member) FROM member_teams mt
    JOIN teams t ON t.id = mt.team AND t.active = true AND t.sport = 'basketball'
    JOIN members m ON m.id = mt.member AND m.wiedisync_active = true
    WHERE mt.guest_level = 0)                                     AS bb_active_members,
  (SELECT COUNT(DISTINCT mt.member) FROM member_teams mt
    JOIN teams t ON t.id = mt.team AND t.active = true AND t.sport = 'volleyball'
    WHERE mt.guest_level = 0)                                     AS vb_total_members,
  (SELECT COUNT(DISTINCT mt.member) FROM member_teams mt
    JOIN teams t ON t.id = mt.team AND t.active = true AND t.sport = 'basketball'
    WHERE mt.guest_level = 0)                                     AS bb_total_members,
  (SELECT COUNT(*) FROM teams WHERE active = true)                AS active_teams,
  (SELECT COUNT(*) FROM teams WHERE active = true AND sport = 'volleyball')  AS vb_teams,
  (SELECT COUNT(*) FROM teams WHERE active = true AND sport = 'basketball')  AS bb_teams,
  (SELECT COUNT(*) FROM games WHERE date >= CURRENT_DATE AND status = 'scheduled') AS upcoming_games,
  (SELECT COUNT(*) FROM games g JOIN teams t ON t.id = g.kscw_team
    WHERE g.date >= CURRENT_DATE AND g.status = 'scheduled' AND t.sport = 'volleyball') AS vb_upcoming_games,
  (SELECT COUNT(*) FROM games g JOIN teams t ON t.id = g.kscw_team
    WHERE g.date >= CURRENT_DATE AND g.status = 'scheduled' AND t.sport = 'basketball') AS bb_upcoming_games,
  (SELECT COUNT(*) FROM games WHERE status = 'completed')         AS completed_games,
  (SELECT COUNT(*) FROM games g JOIN teams t ON t.id = g.kscw_team
    WHERE g.status = 'completed' AND t.sport = 'volleyball')      AS vb_completed_games,
  (SELECT COUNT(*) FROM games g JOIN teams t ON t.id = g.kscw_team
    WHERE g.status = 'completed' AND t.sport = 'basketball')      AS bb_completed_games,
  (SELECT COUNT(*) FROM trainings WHERE date >= CURRENT_DATE AND cancelled = false) AS upcoming_trainings,
  (SELECT COUNT(*) FROM events WHERE start_date >= NOW())         AS upcoming_events,
  (SELECT COUNT(DISTINCT m.id) FROM member_teams mt
    JOIN teams t ON t.id = mt.team AND t.active = true AND t.sport = 'volleyball'
    JOIN members m ON m.id = mt.member WHERE mt.guest_level = 0
    AND m.shell = false AND m.wiedisync_active = true)             AS vb_registered,
  (SELECT COUNT(DISTINCT m.id) FROM member_teams mt
    JOIN teams t ON t.id = mt.team AND t.active = true AND t.sport = 'basketball'
    JOIN members m ON m.id = mt.member WHERE mt.guest_level = 0
    AND m.shell = false AND m.wiedisync_active = true)             AS bb_registered,
  (SELECT COUNT(DISTINCT m.id) FROM member_teams mt
    JOIN teams t ON t.id = mt.team AND t.active = true AND t.sport = 'volleyball'
    JOIN members m ON m.id = mt.member WHERE mt.guest_level = 0
    AND m.shell = true)                                            AS vb_shell,
  (SELECT COUNT(DISTINCT m.id) FROM member_teams mt
    JOIN teams t ON t.id = mt.team AND t.active = true AND t.sport = 'basketball'
    JOIN members m ON m.id = mt.member WHERE mt.guest_level = 0
    AND m.shell = true)                                            AS bb_shell,
  -- Licences per sport (migration 067 booleans)
  (SELECT COUNT(DISTINCT m.id) FROM member_teams mt
    JOIN teams t ON t.id = mt.team AND t.active = true AND t.sport = 'volleyball'
    JOIN members m ON m.id = mt.member WHERE mt.guest_level = 0
    AND m.scorer_vb)                                               AS vb_lic_scorer,
  (SELECT COUNT(DISTINCT m.id) FROM member_teams mt
    JOIN teams t ON t.id = mt.team AND t.active = true AND t.sport = 'volleyball'
    JOIN members m ON m.id = mt.member WHERE mt.guest_level = 0
    AND m.referee_vb)                                              AS vb_lic_referee,
  (SELECT COUNT(DISTINCT m.id) FROM member_teams mt
    JOIN teams t ON t.id = mt.team AND t.active = true AND t.sport = 'basketball'
    JOIN members m ON m.id = mt.member WHERE mt.guest_level = 0
    AND m.otr1_bb)                                                 AS bb_lic_otr1,
  (SELECT COUNT(DISTINCT m.id) FROM member_teams mt
    JOIN teams t ON t.id = mt.team AND t.active = true AND t.sport = 'basketball'
    JOIN members m ON m.id = mt.member WHERE mt.guest_level = 0
    AND m.otr2_bb)                                                 AS bb_lic_otr2,
  -- Roles per sport (still json)
  (SELECT COUNT(DISTINCT m.id) FROM member_teams mt
    JOIN teams t ON t.id = mt.team AND t.active = true AND t.sport = 'volleyball'
    JOIN members m ON m.id = mt.member WHERE mt.guest_level = 0
    AND m.role::jsonb @> '"vorstand"')                              AS vb_vorstand,
  (SELECT COUNT(DISTINCT m.id) FROM member_teams mt
    JOIN teams t ON t.id = mt.team AND t.active = true AND t.sport = 'basketball'
    JOIN members m ON m.id = mt.member WHERE mt.guest_level = 0
    AND m.role::jsonb @> '"vorstand"')                              AS bb_vorstand,
  (SELECT COUNT(DISTINCT m.id) FROM member_teams mt
    JOIN teams t ON t.id = mt.team AND t.active = true AND t.sport = 'volleyball'
    JOIN members m ON m.id = mt.member WHERE mt.guest_level = 0
    AND (m.role::jsonb @> '"admin"' OR m.role::jsonb @> '"superuser"')) AS vb_admins,
  (SELECT COUNT(DISTINCT m.id) FROM member_teams mt
    JOIN teams t ON t.id = mt.team AND t.active = true AND t.sport = 'basketball'
    JOIN members m ON m.id = mt.member WHERE mt.guest_level = 0
    AND (m.role::jsonb @> '"admin"' OR m.role::jsonb @> '"superuser"')) AS bb_admins,
  (SELECT COUNT(*) FROM games
    WHERE type = 'home' AND date >= CURRENT_DATE AND status = 'scheduled') AS upcoming_home_games,
  (SELECT COUNT(*) FROM games g
    JOIN teams t ON t.id = g.kscw_team
    WHERE g.type = 'home' AND g.date >= CURRENT_DATE AND g.status = 'scheduled'
    AND (
      (t.sport = 'volleyball' AND g.scorer_member IS NULL AND g.scoreboard_member IS NULL AND g.scorer_scoreboard_member IS NULL)
      OR (t.sport = 'basketball' AND g.bb_scorer_member IS NULL AND g.bb_timekeeper_member IS NULL AND g.bb_24s_official IS NULL)
    )
  ) AS upcoming_home_games_no_schreiber;

COMMIT;
