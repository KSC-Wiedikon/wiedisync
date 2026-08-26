-- 341 — participation_visibility: materialise the guest branch instead of walking it.
--
-- WHY THIS EXISTS
-- ---------------
-- `SAME_GAME_AS_ME` (migration 271) let a called-up guest and their host team read
-- each other's game RSVPs. As a POLICY FILTER it cost 254× — measured 26.08.2026 on
-- the dev clone, 302 driving rows:
--
--     full rule (271 + 333)          148,915,476 intermediate rows   6,700×
--     minus EVENT_ROSTER_VISIBLE       5,625,450                       254×  ← this branch
--     minus SAME_GAME_AS_ME              622,853                        28×
--     team-scope only                     22,175                         1×
--
-- Directus compiles a policy `_or` into flat SIBLING LEFT JOINs — one per relation
-- hop — and re-evaluates the whole predicate inside COUNT(CASE WHEN …) once per
-- selected field. Sibling joins CROSS-MULTIPLY, so branches do not add. The two
-- game-guest branches walk
--     member → game_guests → game → kscw_team → member_teams → members → directus_users
--     member → member_teams → team → games → guests → members → directus_users
-- i.e. every game of every team you are on, for every participation row considered.
-- That is the 254×, and it is paid on EVERY read whether or not any guest exists.
--
-- ⚠⚠ THE PUNCHLINE: the club has **22 guest rows on exactly ONE game** (572, H1,
-- 17.09.2026). A quarter-million-fold join amplification, permanently, to serve one
-- fixture. Materialised, the same truth is **429 rows**.
--
-- WHAT THIS TABLE IS
-- ------------------
-- One row per (participation, person who may read it) arising FROM A GUEST
-- RELATIONSHIP. It does NOT restate `SAME_TEAM_AS_ME` or `EVENT_ROSTER_VISIBLE` —
-- those stay as (cheap) policy filters. This table exists only to replace the branch
-- that cannot be expressed cheaply as a filter.
--
-- The policy branch it enables is ONE hop with a LOCAL comparison column:
--     { visible_to: { viewer_user: { _eq: '$CURRENT_USER' } } }
-- so there is no second-level walk to multiply against, and the fanout is
-- data-dependent: rows on games with no guests join to nothing.
--
-- ⚠ It is also NARROWER, and deliberately so. The old filter granted "all of that
-- person's game RSVPs" because a Directus filter cannot join `activity_id` (a
-- varchar, not an FK) back to `games` — the breadth was a LIMITATION, not an intent
-- (see the comment on SAME_GAME_AS_ME in setup-permissions.mjs). This table is
-- row-correlated per fixture: being lent a player for one Saturday shows you that
-- Saturday's roster and nothing else. Narrowing cannot leak.
--
-- ⚠⚠ NO DELTA LOGIC ANYWHERE. Every trigger does a full set-based reconcile against
-- the `participation_visibility_expected` view, which is the single source of truth.
-- Delta maintenance is how a table like this grows a silent leak — someone leaves a
-- team, one code path forgets to revoke, and nobody notices because the failure is
-- "can still read" rather than "error". At 429 rows a full reconcile costs ~15 ms, so
-- there is no reason to be clever. The only residual risk is a missed trigger SOURCE,
-- which is exactly what verify_participation_visibility() is for — wire it into
-- db:smoke and a nightly check.

BEGIN;

CREATE TABLE IF NOT EXISTS participation_visibility (
  participation integer NOT NULL REFERENCES participations(id) ON DELETE CASCADE,
  viewer_user   uuid    NOT NULL REFERENCES directus_users(id) ON DELETE CASCADE,
  PRIMARY KEY (participation, viewer_user)
);

-- The policy filter compares viewer_user to $CURRENT_USER, so that is the leading
-- column for the lookup; the PK already covers the (participation, …) direction.
CREATE INDEX IF NOT EXISTS participation_visibility_viewer_idx
  ON participation_visibility (viewer_user);

-- ── Single source of truth ──────────────────────────────────────────────────
-- Refresh AND verify both read this view. If they could drift apart, the verifier
-- would be verifying its own bug.
CREATE OR REPLACE VIEW participation_visibility_expected AS
WITH guest_games AS (
  SELECT DISTINCT game AS game_id FROM game_guests
),
audience AS (
  -- The host team's active roster.
  -- ⚠ teams.active is load-bearing: member_teams rows are never deleted on rollover,
  -- so without it an archived team's roster would keep granting reads forever.
  SELECT gg.game_id, m.id AS member_id, m."user" AS viewer_user
    FROM guest_games gg
    JOIN games g   ON g.id = gg.game_id
    JOIN member_teams mt ON mt.team = g.kscw_team
    JOIN teams t   ON t.id = mt.team AND t.active
    JOIN members m ON m.id = mt.member
  UNION
  -- The called-up guests themselves.
  SELECT gg.game_id, m.id, m."user"
    FROM guest_games gg
    JOIN game_guests x ON x.game = gg.game_id
    JOIN members m     ON m.id = x.member
  UNION
  -- Coaches of the host team (the LEADER-policy half of the same branch).
  SELECT gg.game_id, m.id, m."user"
    FROM guest_games gg
    JOIN games g ON g.id = gg.game_id
    JOIN teams_coaches tc ON tc.teams_id = g.kscw_team
    JOIN members m ON m.id = tc.members_id
  UNION
  -- Team responsibles of the host team.
  SELECT gg.game_id, m.id, m."user"
    FROM guest_games gg
    JOIN games g ON g.id = gg.game_id
    JOIN teams_responsibles tr ON tr.teams_id = g.kscw_team
    JOIN members m ON m.id = tr.members_id
)
SELECT DISTINCT p.id AS participation, v.viewer_user
  FROM participations p
  -- ⚠ Compare by casting the INT game id up to varchar, never activity_id down to
  -- int: activity_id is a free varchar and a non-numeric value would raise. Same
  -- hazard migration 101 fixed in trg_participations_guest_block.
  JOIN audience s ON s.member_id = p.member
                 AND p.activity_type = 'game'
                 AND p.activity_id = s.game_id::varchar
  JOIN audience v ON v.game_id = s.game_id
 WHERE v.viewer_user IS NOT NULL;

-- ── Verifier (built BEFORE the triggers, on purpose) ────────────────────────
-- Returns nothing when the stored table matches the view. Any row it returns is a
-- real defect: 'missing' = someone cannot read what they should (annoying);
-- 'extra'   = someone CAN read what they should not (a leak — treat as urgent).
CREATE OR REPLACE FUNCTION verify_participation_visibility()
RETURNS TABLE (kind text, participation integer, viewer_user uuid)
LANGUAGE sql STABLE AS $$
  SELECT 'missing'::text, e.participation, e.viewer_user
    FROM participation_visibility_expected e
    LEFT JOIN participation_visibility a
           ON a.participation = e.participation AND a.viewer_user = e.viewer_user
   WHERE a.participation IS NULL
  UNION ALL
  SELECT 'extra'::text, a.participation, a.viewer_user
    FROM participation_visibility a
    LEFT JOIN participation_visibility_expected e
           ON e.participation = a.participation AND e.viewer_user = a.viewer_user
   WHERE e.participation IS NULL;
$$;

-- ── Full reconcile ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION refresh_participation_visibility()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM participation_visibility a
   WHERE NOT EXISTS (
     SELECT 1 FROM participation_visibility_expected e
      WHERE e.participation = a.participation AND e.viewer_user = a.viewer_user);

  INSERT INTO participation_visibility (participation, viewer_user)
  SELECT e.participation, e.viewer_user FROM participation_visibility_expected e
  ON CONFLICT DO NOTHING;
END $$;

-- ── Triggers ────────────────────────────────────────────────────────────────
-- Every source that can change the answer. A missed one is caught by the verifier,
-- not by users.
CREATE OR REPLACE FUNCTION kscw_pv_refresh_trigger()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM refresh_participation_visibility();
  RETURN NULL;                       -- AFTER STATEMENT trigger
END $$;

-- `participations` fires on every RSVP in the club, so it gets a narrower guard:
-- rebuild only when a GAME row moved. Trainings and events cannot affect this table.
-- ⚠ Postgres allows OLD TABLE only on DELETE/UPDATE and NEW TABLE only on
-- INSERT/UPDATE, so the three triggers cannot share one REFERENCING clause. The
-- function branches on TG_OP; plpgsql resolves a transition table lazily, so each
-- branch only touches the one its own operation actually defines.
CREATE OR REPLACE FUNCTION kscw_pv_refresh_participations()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE touched boolean := false;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT EXISTS (SELECT 1 FROM new_rows WHERE activity_type = 'game') INTO touched;
  ELSIF TG_OP = 'DELETE' THEN
    SELECT EXISTS (SELECT 1 FROM old_rows WHERE activity_type = 'game') INTO touched;
  ELSE
    SELECT EXISTS (SELECT 1 FROM new_rows WHERE activity_type = 'game')
        OR EXISTS (SELECT 1 FROM old_rows WHERE activity_type = 'game') INTO touched;
  END IF;

  IF touched THEN
    PERFORM refresh_participation_visibility();
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_pv_participations_ins ON participations;
CREATE TRIGGER trg_pv_participations_ins
  AFTER INSERT ON participations
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION kscw_pv_refresh_participations();

DROP TRIGGER IF EXISTS trg_pv_participations_upd ON participations;
CREATE TRIGGER trg_pv_participations_upd
  AFTER UPDATE ON participations
  REFERENCING NEW TABLE AS new_rows OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION kscw_pv_refresh_participations();

DROP TRIGGER IF EXISTS trg_pv_participations_del ON participations;
CREATE TRIGGER trg_pv_participations_del
  AFTER DELETE ON participations
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION kscw_pv_refresh_participations();

DO $$
DECLARE src text;
BEGIN
  FOREACH src IN ARRAY ARRAY[
    'game_guests',          -- who is called up
    'games',                -- a fixture's kscw_team can move
    'member_teams',         -- the host roster
    'teams',                -- teams.active gates the roster
    'teams_coaches',        -- LEADER half
    'teams_responsibles',   -- LEADER half
    'members'               -- members.user: a login being linked or unlinked
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_pv_%1$s ON %1$I', src);
    EXECUTE format(
      'CREATE TRIGGER trg_pv_%1$s AFTER INSERT OR UPDATE OR DELETE ON %1$I '
      'FOR EACH STATEMENT EXECUTE FUNCTION kscw_pv_refresh_trigger()', src);
  END LOOP;
END $$;

-- ── Backfill ────────────────────────────────────────────────────────────────
SELECT refresh_participation_visibility();

-- ── Register with Directus so a policy filter can walk the alias ────────────
-- ⚠⚠ A raw-SQL directus_fields insert does NOT bust the schema cache. The container
-- MUST be restarted after this migration or `visible_to` reads back as a phantom
-- alias and a policy filter on it will not behave. (Learned the hard way on 334.)
INSERT INTO directus_collections (collection, icon, note, hidden, singleton)
SELECT 'participation_visibility', 'visibility', 'Derived from game_guests by trigger — do not edit. Verify with verify_participation_visibility().', true, false
WHERE NOT EXISTS (SELECT 1 FROM directus_collections WHERE collection = 'participation_visibility');

INSERT INTO directus_fields (collection, field, special, interface, readonly, sort, width, note)
SELECT 'participation_visibility', 'participation', NULL, 'select-dropdown-m2o', true, 1, 'half', 'Derived — do not edit.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'participation_visibility' AND field = 'participation');

INSERT INTO directus_fields (collection, field, special, interface, readonly, sort, width, note)
SELECT 'participation_visibility', 'viewer_user', NULL, 'select-dropdown-m2o', true, 2, 'half', 'Derived — do not edit.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'participation_visibility' AND field = 'viewer_user');

-- The o2m alias on participations that the policy branch walks.
INSERT INTO directus_fields (collection, field, special, interface, readonly, sort, width, note)
SELECT 'participations', 'visible_to', 'o2m', 'list-o2m', true, 91, 'full', 'Derived from game_guests by trigger — do not edit.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'participations' AND field = 'visible_to');

INSERT INTO directus_relations (many_collection, many_field, one_collection, one_field, one_deselect_action)
SELECT 'participation_visibility', 'participation', 'participations', 'visible_to', 'delete'
WHERE NOT EXISTS (SELECT 1 FROM directus_relations WHERE many_collection = 'participation_visibility' AND many_field = 'participation');

INSERT INTO directus_relations (many_collection, many_field, one_collection, one_field, one_deselect_action)
SELECT 'participation_visibility', 'viewer_user', 'directus_users', NULL, 'delete'
WHERE NOT EXISTS (SELECT 1 FROM directus_relations WHERE many_collection = 'participation_visibility' AND many_field = 'viewer_user');

COMMIT;
