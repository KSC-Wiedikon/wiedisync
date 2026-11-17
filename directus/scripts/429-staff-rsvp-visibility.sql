-- 429 — players can read their coaches' and team responsibles' RSVPs again.
--
-- WHY
-- ---
-- A member reads a participation through SAME_TEAM_AS_ME (they share an active
-- `member_teams` row), EVENT_ROSTER_VISIBLE, or the materialised guest branch
-- (`participation_visibility`, migration 341). A coach or team responsible who is
-- NOT also on the roster matches none of them, so to their own players every one of
-- their training and game answers reads as "no answer". Reported 25.10.2026 on D1
-- (three coaches, none on the roster). The pre-26.08 policy had a coaches/TRs branch;
-- it was parked with the rest of the outage stopgap and never came back.
--
-- It cannot come back as a filter: it walks member → teams_coaches/teams_responsibles
-- → teams → member_teams → members → directus_users, i.e. another to-many sibling
-- LEFT JOIN multiplying against the branches already there (measured 3.6× in August).
-- So, like the guest branch, it is materialised into the SAME table and served by
-- the SAME one-hop policy branch (`visible_to.viewer_user = $CURRENT_USER`).
-- setup-permissions.mjs does not change.
--
-- WHAT IS ADDED
-- -------------
-- (participation, viewer) for every participation of a coach / TR of team T on a
-- training of T or a game of T (kscw_team), T active, the participant NOT on T's
-- roster (on the roster SAME_TEAM_AS_ME already shows it — no duplicate rows),
-- viewer = every member of T's roster with a login. Dev clone 26.10.2026: 947 staff
-- participations → 17,216 rows, computed in ~46 ms. Events are left alone: their
-- rosters are served by EVENT_ROSTER_VISIBLE.
--
-- Narrower than the old branch, never wider: the row is correlated to an activity of
-- the team the viewer plays on. A coach's RSVPs for another team they coach, or for a
-- team they play on, stay invisible to this team.
--
-- COST CONTROL
-- ------------
-- The table is still reconciled in full from the view (no delta logic — 341's rule).
-- What changes is WHEN:
--   · participations: was "a game row moved"; now "a game row moved OR a row of a
--     coach/TR moved". A player's training RSVP — the bulk of all writes — still
--     does not reconcile.
--   · games: was every statement (scores, duties, the sync's every-few-minutes
--     upsert); now only INSERT / DELETE / UPDATE OF kscw_team, id — the only games
--     columns the view reads. Cheaper than before, not just than with this change.
--   · the reconcile itself evaluates the view once instead of twice.
--   · trainings (new source): UPDATE OF team, id. A deleted training purges its
--     participations (trg_activity_purge_polymorphic), which reaches the
--     participations trigger; an insert has no participations yet.

BEGIN;

CREATE OR REPLACE VIEW participation_visibility_expected AS
WITH guest_games AS (
  SELECT DISTINCT game AS game_id FROM game_guests
),
audience AS (
  SELECT gg.game_id, m.id AS member_id, m."user" AS viewer_user
    FROM guest_games gg
    JOIN games g   ON g.id = gg.game_id
    JOIN member_teams mt ON mt.team = g.kscw_team
    JOIN teams t   ON t.id = mt.team AND t.active
    JOIN members m ON m.id = mt.member
  UNION
  SELECT gg.game_id, m.id, m."user"
    FROM guest_games gg
    JOIN game_guests x ON x.game = gg.game_id
    JOIN members m     ON m.id = x.member
  UNION
  SELECT gg.game_id, m.id, m."user"
    FROM guest_games gg
    JOIN games g ON g.id = gg.game_id
    JOIN teams_coaches tc ON tc.teams_id = g.kscw_team
    JOIN members m ON m.id = tc.members_id
  UNION
  SELECT gg.game_id, m.id, m."user"
    FROM guest_games gg
    JOIN games g ON g.id = gg.game_id
    JOIN teams_responsibles tr ON tr.teams_id = g.kscw_team
    JOIN members m ON m.id = tr.members_id
),
guest_rows AS (
  SELECT p.id AS participation, v.viewer_user
    FROM participations p
    JOIN audience s ON s.member_id = p.member
                   AND p.activity_type = 'game'
                   AND p.activity_id = s.game_id::varchar
    JOIN audience v ON v.game_id = s.game_id
   WHERE v.viewer_user IS NOT NULL
),
-- 429 — staff (coach / TR) of an active team, who are not on its roster.
staff AS (
  SELECT tc.teams_id AS team, tc.members_id AS member FROM teams_coaches tc
  UNION
  SELECT tr.teams_id, tr.members_id FROM teams_responsibles tr
),
team_activities AS (
  -- ⚠ id cast UP to varchar, never activity_id down to int (see 341).
  SELECT 'training'::varchar AS kind, tr.id::varchar AS activity_id, tr.team
    FROM trainings tr WHERE tr.team IS NOT NULL
  UNION ALL
  SELECT 'game', g.id::varchar, g.kscw_team
    FROM games g WHERE g.kscw_team IS NOT NULL
),
staff_rows AS (
  SELECT p.id AS participation, viewer."user" AS viewer_user
    FROM participations p
    JOIN team_activities a ON a.kind = p.activity_type AND a.activity_id = p.activity_id
    JOIN staff s           ON s.team = a.team AND s.member = p.member
    JOIN teams t           ON t.id = a.team AND t.active
    JOIN member_teams r    ON r.team = a.team
    JOIN members viewer    ON viewer.id = r.member
   WHERE viewer."user" IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM member_teams own
                      WHERE own.team = a.team AND own.member = p.member)
)
SELECT participation, viewer_user FROM guest_rows
UNION
SELECT participation, viewer_user FROM staff_rows;

-- Reconcile: compute the view ONCE (it was evaluated twice — once for the delete,
-- once for the insert). With the staff rows the view costs ~40 ms on the dev clone;
-- the old two-pass reconcile took ~115 ms, this one 55–85 ms (was ~40 ms before 429).
CREATE OR REPLACE FUNCTION refresh_participation_visibility()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  WITH e AS MATERIALIZED (
    SELECT participation, viewer_user FROM participation_visibility_expected
  ), gone AS (
    DELETE FROM participation_visibility a
     WHERE NOT EXISTS (SELECT 1 FROM e
                        WHERE e.participation = a.participation AND e.viewer_user = a.viewer_user)
  )
  INSERT INTO participation_visibility (participation, viewer_user)
  SELECT e.participation, e.viewer_user FROM e
   WHERE NOT EXISTS (SELECT 1 FROM participation_visibility a
                      WHERE a.participation = e.participation AND a.viewer_user = e.viewer_user)
  ON CONFLICT DO NOTHING;
END $$;

-- participations: also reconcile when a coach's / TR's row moved.
CREATE OR REPLACE FUNCTION kscw_pv_refresh_participations()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE touched boolean := false;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT EXISTS (
      SELECT 1 FROM new_rows r
       WHERE r.activity_type = 'game'
          OR EXISTS (SELECT 1 FROM teams_coaches tc WHERE tc.members_id = r.member)
          OR EXISTS (SELECT 1 FROM teams_responsibles tr WHERE tr.members_id = r.member)
    ) INTO touched;
  ELSIF TG_OP = 'DELETE' THEN
    SELECT EXISTS (
      SELECT 1 FROM old_rows r
       WHERE r.activity_type = 'game'
          OR EXISTS (SELECT 1 FROM teams_coaches tc WHERE tc.members_id = r.member)
          OR EXISTS (SELECT 1 FROM teams_responsibles tr WHERE tr.members_id = r.member)
    ) INTO touched;
  ELSE
    SELECT EXISTS (
      SELECT 1 FROM (SELECT activity_type, member FROM new_rows
                     UNION ALL
                     SELECT activity_type, member FROM old_rows) r
       WHERE r.activity_type = 'game'
          OR EXISTS (SELECT 1 FROM teams_coaches tc WHERE tc.members_id = r.member)
          OR EXISTS (SELECT 1 FROM teams_responsibles tr WHERE tr.members_id = r.member)
    ) INTO touched;
  END IF;

  IF touched THEN
    PERFORM refresh_participation_visibility();
  END IF;
  RETURN NULL;
END $$;

-- games: only the columns the view reads.
DROP TRIGGER IF EXISTS trg_pv_games ON games;
CREATE TRIGGER trg_pv_games
  AFTER INSERT OR DELETE OR UPDATE OF kscw_team, id ON games
  FOR EACH STATEMENT EXECUTE FUNCTION kscw_pv_refresh_trigger();

-- trainings: new source — a training moving to another team.
DROP TRIGGER IF EXISTS trg_pv_trainings ON trainings;
CREATE TRIGGER trg_pv_trainings
  AFTER UPDATE OF team, id ON trainings
  FOR EACH STATEMENT EXECUTE FUNCTION kscw_pv_refresh_trigger();

SELECT refresh_participation_visibility();

COMMIT;

-- Verify (both → 0 rows / no drift):
--   SELECT * FROM verify_participation_visibility();
--   npm run db:verify-pv:dev
