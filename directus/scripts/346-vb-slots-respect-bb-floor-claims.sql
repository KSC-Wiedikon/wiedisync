-- 346-vb-slots-respect-bb-floor-claims.sql
--
-- Teach the VOLLEYBALL side that basketball holds a KWI floor.
--
-- WHY
-- ---
-- Cross-sport hall coordination is currently one-way. Basketball reads volleyball:
-- `basketball-slots.js` + `hallOccupancy.ts` drop a basketball pitch whose court a
-- booked volleyball match occupies (changeover included). Volleyball reads NOTHING
-- back — `basketball_slot_plan` reaches the Spielplanung season overview as a chip
-- and nowhere else.
--
-- So on Fri 06.11.2026 the placed KSCW Herren 2 (BB) game holds KWI B at 20:00 while
-- every volleyball slot in KWI B that evening is still offered as `available`, to the
-- opponent portal included. Nothing but the planner's memory stands between that and
-- two games on one court.
--
-- Migration 295 already built the authoritative projection: `basketball_floor_claims`,
-- one row per (placement, physical floor), maintained by trigger. This migration adds
-- the two functions that let a volleyball query ASK it, and nothing else — the call
-- sites live in game-scheduling.js (offer filters + booking guards) and in
-- hallOccupancy.ts (the planner's calendar).
--
-- ⚠ THE ARITHMETIC IS MIRRORED, NOT INVENTED. `bb_vb_time_overlap` is the same
-- predicate `vbBlocksSlot()` computes in src/modules/gameScheduling/utils/hallOccupancy.ts,
-- with the arguments swapped: a volleyball booking occupies start−30 … end+30
-- (VB_CHANGEOVER_MINUTES either side, for nets, poles and the scorer's table), a
-- basketball game occupies tip-off … +120 (BB_GAME_MINUTES), and they collide on a
-- strict half-open overlap. Change one, change all three — the whole point is that
-- both sports agree on who owns the floor, so a disagreement is worse than no check.
--
-- ⚠ EVERY placement blocks, draft included — that is migration 295's contract
-- ("a draft occupies the physical court exactly as much as a confirmed game") and the
-- claims table carries no status to filter on anyway. A stale draft therefore quietly
-- removes volleyball slots; what stops that being invisible is the "Home game (BB)"
-- chip on the same calendar, which now names the floor it takes.
--
-- ⚠ Only KWI floors exist. `bb_hall_floors` maps KWI A/B/C/A+B and returns an empty
-- array for anything else, so Döltschi, Rebhügel and every other hall are untouched by
-- construction, not by an exclusion list that could go stale.
--
-- Schema-only + idempotent per the CLAUDE.md migration policy. No permission rows.

BEGIN;

-- ── Do a volleyball slot's window and a basketball tip-off fight over the floor? ──
-- p_vb_end NULL or corrupt (<= start) → VB_DEFAULT_MINUTES, never a zero-width window
-- that blocks nothing. p_vb_start NULL or an unparseable tip-off → TRUE: an unknown
-- window must fail SAFE (busy), exactly as vbBusyWindow()'s null contract does on the
-- basketball side. A slot with no start time is unbookable for other reasons anyway.
CREATE OR REPLACE FUNCTION bb_vb_time_overlap(p_vb_start time, p_vb_end time, p_bb_time text)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  vb_s int;   -- volleyball window start, minutes since midnight
  vb_e int;   -- volleyball window end
  bb_s int;   -- basketball tip-off
BEGIN
  IF p_vb_start IS NULL THEN RETURN true; END IF;
  IF p_bb_time IS NULL OR p_bb_time !~ '^[0-9]{1,2}:[0-9]{2}' THEN RETURN true; END IF;

  bb_s := split_part(p_bb_time, ':', 1)::int * 60
        + substring(split_part(p_bb_time, ':', 2) from 1 for 2)::int;

  vb_s := (EXTRACT(EPOCH FROM p_vb_start) / 60)::int;
  vb_e := CASE WHEN p_vb_end IS NULL THEN NULL ELSE (EXTRACT(EPOCH FROM p_vb_end) / 60)::int END;
  IF vb_e IS NULL OR vb_e <= vb_s THEN vb_e := vb_s + 120; END IF;  -- VB_DEFAULT_MINUTES

  -- Minutes, not `time + interval`: 23:00 + 120 min wraps past midnight and would
  -- silently free the court. VB_CHANGEOVER_MINUTES = 30, BB_GAME_MINUTES = 120.
  RETURN (vb_s - 30) < (bb_s + 120) AND bb_s < (vb_e + 30);
END $$;

COMMENT ON FUNCTION bb_vb_time_overlap(time, time, text) IS
  'Does a volleyball slot (start, end) collide with a basketball tip-off on the same floor? Mirrors vbBlocksSlot() in hallOccupancy.ts: VB occupies start-30..end+30, BB occupies tip..tip+120, strict overlap. NULL/unparseable input fails SAFE (true).';

-- ── Which physical KWI floors a volleyball slot occupies ─────────────────────
-- The primary hall plus every court in `additional_halls` (migration 221's combo
-- booking: an A+B derby holds both halves, and only this column says so). Hall IDs,
-- resolved to names because bb_hall_floors — migration 295's single source for the
-- A+B ↔ A/B identity — speaks the ProBasket name vocabulary.
CREATE OR REPLACE FUNCTION vb_slot_floors(p_hall integer, p_additional jsonb)
RETURNS text[] LANGUAGE sql STABLE AS $$
  WITH ids AS (
    SELECT p_hall AS id
    UNION
    SELECT e::int
    FROM jsonb_array_elements_text(
           CASE WHEN jsonb_typeof(p_additional) = 'array' THEN p_additional ELSE '[]'::jsonb END
         ) AS e
    -- Defensive: the column is plain `json`, so a hand-edited row could hold
    -- anything. A non-numeric entry is dropped rather than aborting the query.
    WHERE e ~ '^[0-9]+$'
  )
  SELECT COALESCE(array_agg(DISTINCT f), ARRAY[]::text[])
  FROM ids
  JOIN halls h ON h.id = ids.id,
  LATERAL unnest(bb_hall_floors(h.name)) AS f;
$$;

COMMENT ON FUNCTION vb_slot_floors(integer, jsonb) IS
  'The physical KWI floors a volleyball slot occupies: its hall plus additional_halls (migration 221 combo bookings), mapped through bb_hall_floors. Empty array for halls outside KWI — they are not our floor to protect.';

-- ── Prove both functions bite, rather than trusting the DDL ──────────────────
-- Uses a throwaway 2099 placement so the trigger from migration 295 produces real
-- claim rows; removed again below. Skipped on an instance without the KWI halls or a
-- season (a fresh install runs SCHEMA.sql, where there is nothing to assert against).
DO $$
DECLARE
  sid integer; plan_id integer;
  hall_a integer; hall_b integer; hall_c integer;
  hit boolean;
BEGIN
  SELECT id INTO sid FROM game_scheduling_seasons ORDER BY id LIMIT 1;
  SELECT id INTO hall_a FROM halls WHERE name = 'KWI A';
  SELECT id INTO hall_b FROM halls WHERE name = 'KWI B';
  SELECT id INTO hall_c FROM halls WHERE name = 'KWI C';
  IF sid IS NULL OR hall_a IS NULL OR hall_b IS NULL OR hall_c IS NULL THEN
    RAISE NOTICE 'migration 346: no season / KWI halls on this instance — assertions skipped';
    RETURN;
  END IF;

  -- Pure time arithmetic first (no rows involved).
  IF NOT bb_vb_time_overlap('19:30', '21:30', '20:00') THEN
    RAISE EXCEPTION 'migration 346: a 20:00 tip-off must collide with 19:30-21:30';
  END IF;
  IF bb_vb_time_overlap('19:30', '21:30', '16:00') THEN
    RAISE EXCEPTION 'migration 346: 16:00 + 2h ends at 18:00, before the 19:00 changeover — must NOT collide';
  END IF;
  IF NOT bb_vb_time_overlap('19:30', NULL, '20:00') THEN
    RAISE EXCEPTION 'migration 346: a missing end_time must fall back to 2h, not to zero width';
  END IF;
  IF NOT bb_vb_time_overlap(NULL, NULL, '20:00') THEN
    RAISE EXCEPTION 'migration 346: an unknown volleyball window must fail SAFE (busy)';
  END IF;
  -- 13:30-15:30 volleyball occupies 13:00-16:00, so it takes the 13:30 pitch and
  -- leaves 11:00 and 16:00 free — the exact case hallOccupancy.ts documents.
  IF bb_vb_time_overlap('13:30', '15:30', '16:00') THEN
    RAISE EXCEPTION 'migration 346: 16:00 must survive a 13:30-15:30 volleyball match';
  END IF;
  IF NOT bb_vb_time_overlap('13:30', '15:30', '13:30') THEN
    RAISE EXCEPTION 'migration 346: 13:30 must not survive a 13:30-15:30 volleyball match';
  END IF;

  INSERT INTO basketball_slot_plan (season, date, "time", hall, game_type, proposal_status)
  VALUES (sid, DATE '2099-01-04', '20:00', 'KWI B', 'home', 'draft')
  RETURNING id INTO plan_id;

  SELECT EXISTS (
    SELECT 1 FROM basketball_floor_claims fc
    WHERE fc.date = DATE '2099-01-04'
      AND fc.floor = ANY (vb_slot_floors(hall_b, NULL))
      AND bb_vb_time_overlap('19:30', '21:30', fc."time")
  ) INTO hit;
  IF NOT hit THEN RAISE EXCEPTION 'migration 346: KWI B must be blocked by a KWI B placement'; END IF;

  SELECT EXISTS (
    SELECT 1 FROM basketball_floor_claims fc
    WHERE fc.date = DATE '2099-01-04'
      AND fc.floor = ANY (vb_slot_floors(hall_a, NULL))
      AND bb_vb_time_overlap('19:30', '21:30', fc."time")
  ) INTO hit;
  IF hit THEN RAISE EXCEPTION 'migration 346: KWI A is a different floor and must stay free'; END IF;

  SELECT EXISTS (
    SELECT 1 FROM basketball_floor_claims fc
    WHERE fc.date = DATE '2099-01-04'
      AND fc.floor = ANY (vb_slot_floors(hall_c, NULL))
      AND bb_vb_time_overlap('19:30', '21:30', fc."time")
  ) INTO hit;
  IF hit THEN RAISE EXCEPTION 'migration 346: KWI C never collides with A or B'; END IF;

  -- The combo case: an A+B volleyball game claims B too, so it must be blocked.
  SELECT EXISTS (
    SELECT 1 FROM basketball_floor_claims fc
    WHERE fc.date = DATE '2099-01-04'
      AND fc.floor = ANY (vb_slot_floors(hall_a, to_jsonb(ARRAY[hall_b])))
      AND bb_vb_time_overlap('19:30', '21:30', fc."time")
  ) INTO hit;
  IF NOT hit THEN RAISE EXCEPTION 'migration 346: an A+B volleyball booking must see the KWI B claim'; END IF;

  DELETE FROM basketball_slot_plan WHERE id = plan_id;   -- claims cascade
END $$;

COMMIT;
