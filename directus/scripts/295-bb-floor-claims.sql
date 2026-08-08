-- 295-bb-floor-claims.sql
--
-- Make a double-booked hall impossible at the DATABASE level, not just in application code.
--
-- WHY
-- ---
-- `basketball-portal.js` checks A+B collisions twice — when it builds a club's free list, and
-- again inside the propose loop. Both are read-then-write: two SIMULTANEOUS requests can each
-- pass the check before either has inserted. With one planner placing games by hand that was
-- unreachable; with 64 opponent clubs self-serving through their portals it is a matter of
-- time, and the loser is a hall promised to two clubs at the same hour.
--
-- Application code cannot close this. Only the database can, because only the database can
-- make the check and the write one atomic act.
--
-- WHY A SIDE TABLE AND NOT AN EXCLUSION CONSTRAINT
-- ------------------------------------------------
-- The conflict is not "same hall" — it is "same FLOOR". 'KWI A+B' is the big court with the
-- divider open, i.e. the same concrete as A and B together, so A+B must exclude both halves
-- while KWI C excludes neither. A plain UNIQUE on (season, date, time, hall) cannot say that,
-- and an EXCLUDE constraint would need a GiST opclass over hall SETS (intarray or similar) —
-- an extension dependency for something a one-column projection expresses exactly.
--
-- So: one row per (placement, physical floor it occupies). A+B writes two rows, A writes one.
-- A UNIQUE index over (season, date, time, floor) then makes the overlap unrepresentable, and
-- concurrency is Postgres's problem rather than ours — the second transaction blocks on the
-- index and then fails with 23505.
--
--   KWI A   → A          KWI A+B → A and B
--   KWI B   → B          KWI C   → C
--
-- ⚠ A hall outside that map claims NO floor and is therefore unconstrained. That is deliberate:
-- an away game or a borrowed foreign hall is not our floor to protect. Only KWI is.
--
-- ⚠ EVERY placement claims its floor — draft, club_proposed, offered, accepted, and guest games
-- borrowing our hall alike. A draft occupies the physical court exactly as much as a confirmed
-- game; filtering by status here is what let the portal offer an occupied pitch in the first
-- place.
--
-- ⚠ Trigger name starts `trg_..._0_` on purpose: Postgres fires same-event triggers in
-- alphabetical order, and this must not land after a notify trigger (repo convention, see
-- migration 251's note).
--
-- SAFE TO APPLY: basketball_slot_plan is empty on both instances (verified 2026-08-08), so the
-- backfill below inserts nothing and cannot fail on pre-existing conflicts. The assertion at
-- the end proves the constraint actually bites rather than trusting the DDL.

BEGIN;

CREATE TABLE IF NOT EXISTS basketball_floor_claims (
  plan    integer NOT NULL REFERENCES basketball_slot_plan(id) ON DELETE CASCADE,
  season  integer NOT NULL,
  date    date    NOT NULL,
  "time"  varchar NOT NULL,
  floor   char(1) NOT NULL CHECK (floor IN ('A', 'B', 'C')),
  PRIMARY KEY (plan, floor),
  CONSTRAINT basketball_floor_claims_uniq UNIQUE (season, date, "time", floor)
);

COMMENT ON TABLE basketball_floor_claims IS
  'One row per (placement, physical KWI floor it occupies). Machinery, not data: maintained solely by trg_basketball_slot_plan_0_floor_claims. Its UNIQUE (season,date,time,floor) is what makes a double-booked hall impossible under concurrency — KWI A+B claims floors A and B, so it collides with either half. Halls outside KWI claim nothing.';

/** Which physical floors a hall name occupies. Mirrors hallsCollide() in basketball-slots.js. */
CREATE OR REPLACE FUNCTION bb_hall_floors(hall text)
RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE hall
    WHEN 'KWI A'   THEN ARRAY['A']
    WHEN 'KWI B'   THEN ARRAY['B']
    WHEN 'KWI A+B' THEN ARRAY['A', 'B']
    WHEN 'KWI C'   THEN ARRAY['C']
    ELSE ARRAY[]::text[]
  END;
$$;

CREATE OR REPLACE FUNCTION bb_slot_plan_floor_claims()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE floors text[];
BEGIN
  -- Rewrite rather than patch: the placement may have moved hall, date or time.
  DELETE FROM basketball_floor_claims WHERE plan = NEW.id;
  floors := bb_hall_floors(NEW.hall);
  IF array_length(floors, 1) IS NOT NULL THEN
    INSERT INTO basketball_floor_claims (plan, season, date, "time", floor)
    SELECT NEW.id, NEW.season, NEW.date, NEW."time", unnest(floors);
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_basketball_slot_plan_0_floor_claims ON basketball_slot_plan;
CREATE TRIGGER trg_basketball_slot_plan_0_floor_claims
  AFTER INSERT OR UPDATE OF season, date, "time", hall ON basketball_slot_plan
  FOR EACH ROW EXECUTE FUNCTION bb_slot_plan_floor_claims();

-- Backfill anything that already exists (nothing today, but a re-run on a populated instance
-- must converge rather than leave old rows unprotected).
INSERT INTO basketball_floor_claims (plan, season, date, "time", floor)
SELECT p.id, p.season, p.date, p."time", f.floor
FROM basketball_slot_plan p, unnest(bb_hall_floors(p.hall)) AS f(floor)
ON CONFLICT DO NOTHING;

-- ── Prove the constraint bites, rather than trusting the DDL ─────────────────
DO $$
DECLARE sid integer; a integer; blocked boolean := false; n_claims integer;
BEGIN
  SELECT id INTO sid FROM game_scheduling_seasons WHERE season = '2026/27';
  IF sid IS NULL THEN RAISE EXCEPTION 'migration 295: season 2026/27 not found'; END IF;

  INSERT INTO basketball_slot_plan (season, date, "time", hall, game_type, proposal_status)
  VALUES (sid, DATE '2099-01-03', '11:00', 'KWI A+B', 'home', 'draft')
  RETURNING id INTO a;

  SELECT count(*) INTO n_claims FROM basketball_floor_claims WHERE plan = a;
  IF n_claims <> 2 THEN
    RAISE EXCEPTION 'migration 295: A+B should claim 2 floors, claimed %', n_claims;
  END IF;

  -- The half must now be refused. This is the whole point of the migration.
  BEGIN
    INSERT INTO basketball_slot_plan (season, date, "time", hall, game_type, proposal_status)
    VALUES (sid, DATE '2099-01-03', '11:00', 'KWI B', 'home', 'draft');
  EXCEPTION WHEN unique_violation THEN
    blocked := true;
  END;
  IF NOT blocked THEN
    RAISE EXCEPTION 'migration 295: KWI B was accepted while KWI A+B holds that hour';
  END IF;

  -- KWI C shares no floor and must still be allowed.
  INSERT INTO basketball_slot_plan (season, date, "time", hall, game_type, proposal_status)
  VALUES (sid, DATE '2099-01-03', '11:00', 'KWI C', 'home', 'draft');

  DELETE FROM basketball_slot_plan WHERE date = DATE '2099-01-03';
  IF EXISTS (SELECT 1 FROM basketball_floor_claims WHERE date = DATE '2099-01-03') THEN
    RAISE EXCEPTION 'migration 295: claims outlived their placement — ON DELETE CASCADE is not working';
  END IF;

  RAISE NOTICE 'migration 295: floor claims enforced (A+B blocks its halves, C unaffected, cascade clean)';
END $$;

COMMIT;
