-- 351-bb-home-games-hold-the-floor.sql
--
-- A basketball HOME game recorded in `games` must take the KWI floor away from
-- volleyball, exactly as a `basketball_slot_plan` placement does.
--
-- WHY
-- ---
-- Basketball home games reach the database by two different roads and only one of
-- them holds a floor:
--
--   basketball_slot_plan  → migration 295 projects each placement onto the physical
--                           floors it occupies (basketball_floor_claims), and
--                           migration 346 taught the volleyball side to ask.
--   games                 → the fixture table. A planner adding a home game from the
--                           Spielplanung editor writes here, and so does the
--                           Basketplan scraper (bp-sync.js) once the season is set.
--                           It claims NOTHING.
--
-- So prod carries `games` 585 — KSCW Lions D1 vs RJ Lakers, 19.09.2026 20:00, hall
-- KWI A + additional_halls [KWI B], i.e. the whole big court — while every volleyball
-- slot in KWI A and KWI B that evening is still offered as `available`, to the
-- opponent portals included. The planner's own basketball calendar does not show it
-- either (fixed in the same release, frontend side). Nothing but memory stands
-- between that row and two games on one floor.
--
-- WHAT
-- ----
-- The mirror of migration 295, for the other road:
--
--   basketball_game_floor_claims  — one row per (basketball home game, physical KWI
--                                   floor it occupies), maintained by trigger.
--   bb_floor_claims_all           — the union of BOTH claim sources, which is what
--                                   game-scheduling.js reads from now on.
--
-- ⚠⚠ NO UNIQUE CONSTRAINT HERE, and that is the whole design decision.
-- Migration 295's claims table is hard-unique on (season, date, time, floor) because
-- two placements on one floor are always a mistake. Here they are not: the NORMAL
-- lifecycle of a single game is a placement first (planning) and a `games` row later
-- (Basketplan confirms it), and both describe the same 2 hours of the same floor. A
-- unique index spanning both sources would make bp-sync abort with 23505 on every
-- game the planner had correctly pre-placed — turning a working sync into a broken
-- one to protect against a conflict that does not exist. These claims are therefore a
-- READ-side projection: they remove volleyball slots, they never refuse a write.
--
-- ⚠ Only `type = 'home'` and only basketball teams. An away game is played in the
-- opponent's gym and is not our floor (same rule basketball-slots.js already states
-- for `basketball_slot_plan`); a volleyball game is the other sport's own business —
-- it books `game_scheduling_slots`, which basketball already reads.
--
-- ⚠ A NULL/unparseable tip-off is stored as '' on purpose. bb_vb_time_overlap()
-- returns TRUE for it (migration 346's documented fail-safe contract), so a home game
-- with no time yet blocks its floor for the whole day rather than silently freeing it.
--
-- ⚠ The floors come from vb_slot_floors(hall, additional_halls) — migration 346's
-- function, already the single place that knows an A+B combo booking holds both
-- halves. `games` stores a combo exactly that way (hall = KWI A, additional_halls =
-- [KWI B]), so reusing it is what keeps the two roads agreeing about A+B.
--
-- ⚠ Trigger name starts `trg_..._0_` per the repo convention (migrations 251/295):
-- same-event triggers fire in alphabetical order and this must land before
-- trg_games_notify.
--
-- Schema-only + idempotent per the CLAUDE.md migration policy. No permission rows:
-- the table is machinery like basketball_floor_claims, unregistered in Directus, and
-- read only by the endpoint's own knex connection.

BEGIN;

CREATE TABLE IF NOT EXISTS basketball_game_floor_claims (
  game   integer NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  date   date    NOT NULL,
  "time" varchar NOT NULL,
  floor  char(1) NOT NULL CHECK (floor IN ('A', 'B', 'C')),
  PRIMARY KEY (game, floor)
);

CREATE INDEX IF NOT EXISTS basketball_game_floor_claims_date_idx
  ON basketball_game_floor_claims (date, floor);

COMMENT ON TABLE basketball_game_floor_claims IS
  'One row per (basketball home game in `games`, physical KWI floor it occupies). Machinery, not data: maintained solely by trg_games_0_bb_floor_claims. Deliberately NOT unique on (date,time,floor) — a placement and the Basketplan row for the SAME game legitimately claim one floor twice; see migration 351. Read through the bb_floor_claims_all view.';

/**
 * Rewrite this game's floor claims.
 *
 * Delete-then-insert rather than patch: the game may have moved date, time, hall or
 * side (an away game corrected to home is exactly the case this release ships for).
 */
CREATE OR REPLACE FUNCTION bb_game_floor_claims()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  floors text[];
  is_bb  boolean;
BEGIN
  DELETE FROM basketball_game_floor_claims WHERE game = NEW.id;

  IF NEW.type IS DISTINCT FROM 'home' OR NEW.date IS NULL OR NEW.kscw_team IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT (t.sport = 'basketball') INTO is_bb FROM teams t WHERE t.id = NEW.kscw_team;
  IF NOT COALESCE(is_bb, false) THEN RETURN NULL; END IF;

  floors := vb_slot_floors(NEW.hall, NEW.additional_halls::jsonb);
  IF array_length(floors, 1) IS NULL THEN RETURN NULL; END IF;  -- not a KWI floor

  INSERT INTO basketball_game_floor_claims (game, date, "time", floor)
  SELECT NEW.id, NEW.date, COALESCE(to_char(NEW."time", 'HH24:MI'), ''), unnest(floors);
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_games_0_bb_floor_claims ON games;
CREATE TRIGGER trg_games_0_bb_floor_claims
  AFTER INSERT OR UPDATE OF type, date, "time", hall, additional_halls, kscw_team ON games
  FOR EACH ROW EXECUTE FUNCTION bb_game_floor_claims();

-- ── The union both roads are read through ────────────────────────────────────
-- Column names are the ones game-scheduling.js's bbFloorConflict() already selects,
-- so the refusal keeps naming the court and the team ("KWI B is taken by KSCW
-- Herren 2 vs …") whichever road the game came down.
DROP VIEW IF EXISTS bb_floor_claims_all;
CREATE VIEW bb_floor_claims_all AS
  SELECT
    'plan'::text                                AS source,
    p.id                                        AS ref_id,
    fc.date,
    fc."time",
    fc.floor,
    p.hall                                      AS bb_hall,
    COALESCE(t.name, p.kscw_team_label)         AS bb_team,
    p.opponent                                  AS bb_opponent
  FROM basketball_floor_claims fc
  JOIN basketball_slot_plan p ON p.id = fc.plan
  LEFT JOIN teams t ON t.id = p.kscw_team
UNION ALL
  SELECT
    'game'::text,
    g.id,
    gc.date,
    gc."time",
    gc.floor,
    -- A+B is stored as hall + additional_halls; say so rather than naming half of it.
    CASE WHEN f.floors @> ARRAY['A', 'B'] THEN 'KWI A+B' ELSE h.name END,
    t.name,
    g.away_team
  FROM basketball_game_floor_claims gc
  JOIN games g ON g.id = gc.game
  LEFT JOIN teams t ON t.id = g.kscw_team
  LEFT JOIN halls h ON h.id = g.hall
  CROSS JOIN LATERAL (SELECT vb_slot_floors(g.hall, g.additional_halls::jsonb) AS floors) f;

COMMENT ON VIEW bb_floor_claims_all IS
  'Every physical KWI floor basketball holds, from BOTH roads: basketball_slot_plan placements (migration 295) and basketball home games in `games` (migration 351). The volleyball side (game-scheduling.js) reads this, never either table directly — a slot must disappear whichever road took the court.';

-- Backfill the games that already exist. Idempotent: the PK swallows a re-run.
INSERT INTO basketball_game_floor_claims (game, date, "time", floor)
SELECT g.id, g.date, COALESCE(to_char(g."time", 'HH24:MI'), ''), f.floor
FROM games g
JOIN teams t ON t.id = g.kscw_team AND t.sport = 'basketball',
LATERAL unnest(vb_slot_floors(g.hall, g.additional_halls::jsonb)) AS f(floor)
WHERE g.type = 'home' AND g.date IS NOT NULL
ON CONFLICT DO NOTHING;

-- ── Prove it bites, rather than trusting the DDL ─────────────────────────────
DO $$
DECLARE
  bb_team integer; hall_a integer; hall_b integer; hall_c integer;
  gid integer; n integer; hit boolean;
BEGIN
  SELECT id INTO bb_team FROM teams WHERE sport = 'basketball' ORDER BY id LIMIT 1;
  SELECT id INTO hall_a FROM halls WHERE name = 'KWI A';
  SELECT id INTO hall_b FROM halls WHERE name = 'KWI B';
  SELECT id INTO hall_c FROM halls WHERE name = 'KWI C';
  IF bb_team IS NULL OR hall_a IS NULL OR hall_b IS NULL OR hall_c IS NULL THEN
    RAISE NOTICE 'migration 351: no basketball team / KWI halls here — assertions skipped';
    RETURN;
  END IF;

  -- The notify trigger must not queue push notifications for a throwaway row
  -- (migration 095's silencer; transaction-local).
  PERFORM set_config('kscw.skip_games_notify', 'on', true);

  INSERT INTO games (game_id, home_team, away_team, kscw_team, type, date, "time", hall, additional_halls, source, status)
  VALUES ('mig351_probe', 'KSCW probe', 'Opponent probe', bb_team, 'home',
          DATE '2099-01-05', TIME '20:00', hall_a, to_json(ARRAY[hall_b])::json, 'manual', 'scheduled')
  RETURNING id INTO gid;

  SELECT count(*) INTO n FROM basketball_game_floor_claims WHERE game = gid;
  IF n <> 2 THEN
    RAISE EXCEPTION 'migration 351: a KWI A + additional [B] home game must claim 2 floors, claimed %', n;
  END IF;

  -- The volleyball-side predicate must now see it through the union view.
  SELECT EXISTS (
    SELECT 1 FROM bb_floor_claims_all fc
    WHERE fc.date = DATE '2099-01-05'
      AND fc.floor = ANY (vb_slot_floors(hall_b, NULL))
      AND bb_vb_time_overlap('19:30', '21:30', fc."time")
  ) INTO hit;
  IF NOT hit THEN RAISE EXCEPTION 'migration 351: KWI B must be blocked by an A+B home game'; END IF;

  SELECT EXISTS (
    SELECT 1 FROM bb_floor_claims_all fc
    WHERE fc.date = DATE '2099-01-05'
      AND fc.floor = ANY (vb_slot_floors(hall_c, NULL))
      AND bb_vb_time_overlap('19:30', '21:30', fc."time")
  ) INTO hit;
  IF hit THEN RAISE EXCEPTION 'migration 351: KWI C shares no floor with A or B and must stay free'; END IF;

  -- The A+B label survives the union (the refusal message names the whole court).
  IF NOT EXISTS (SELECT 1 FROM bb_floor_claims_all WHERE ref_id = gid AND bb_hall = 'KWI A+B') THEN
    RAISE EXCEPTION 'migration 351: an A+B home game must report its hall as KWI A+B';
  END IF;

  -- Correcting the side must give the floor back — the bug this release exists for.
  UPDATE games SET type = 'away' WHERE id = gid;
  SELECT count(*) INTO n FROM basketball_game_floor_claims WHERE game = gid;
  IF n <> 0 THEN
    RAISE EXCEPTION 'migration 351: an away game holds no KWI floor, still claimed %', n;
  END IF;

  UPDATE games SET type = 'home' WHERE id = gid;   -- and back again
  SELECT count(*) INTO n FROM basketball_game_floor_claims WHERE game = gid;
  IF n <> 2 THEN
    RAISE EXCEPTION 'migration 351: home again must re-claim both floors, claimed %', n;
  END IF;

  DELETE FROM games WHERE id = gid;
  IF EXISTS (SELECT 1 FROM basketball_game_floor_claims WHERE game = gid) THEN
    RAISE EXCEPTION 'migration 351: claims outlived their game — ON DELETE CASCADE is not working';
  END IF;

  RAISE NOTICE 'migration 351: basketball home games hold their KWI floor (A+B claims both, away claims none, cascade clean)';
END $$;

COMMIT;
