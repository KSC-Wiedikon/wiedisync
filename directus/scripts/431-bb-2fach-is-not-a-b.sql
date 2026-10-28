-- Migration 431: Basketplan's "2fach" games hold KWI A, not KWI A+B.
--
-- WHY
-- ---
-- bp-sync mapped the Basketplan venue "Kantonsschule Wiedikon 2fach" to the whole
-- double hall: hall = KWI A, additional_halls = [KWI B]. But Basketplan has no venue
-- for Halle A alone, so EVERY KWI A game is listed there — single-court games too.
-- 07.11.2026 16:00 has DU18 at "2fach" and HU18 at "1fach Halle B"; 22.11.2026 10:00
-- has three games at once (2fach, 1fach Halle B, 1fach Halle C). The club's
-- basketball planning puts 15 of the 20 planned "2fach" games on KWI A alone.
--
-- Effect: the Hallenplan and the basketball planner drew those games across A+B,
-- basketball_game_floor_claims (migration 351) took KWI B away from volleyball for
-- them, and game-training-shorten cut KWI B trainings under them.
--
-- WHAT CHANGES
-- ------------
-- bp-sync now maps "2fach" to KWI A and adds KWI B only when the planning places that
-- team's home game that day on 'KWI A+B' — or, with no placement, when the row
-- already carries KWI B (set by hand in the game editor). That last rule would keep
-- the KWI B the old mapping wrote, so this clears it: every Basketplan row at KWI A
-- with KWI B in additional_halls and no 'KWI A+B' placement for its team that day
-- goes back to '[]'. Rows the planning does put on A+B keep [KWI B]; the next sync
-- re-derives all of them anyway.
--
-- Hall-only updates are silent (trg_games_notify only announces date/time changes);
-- trg_games_0_bb_floor_claims rewrites the floor claims; game-training-shorten's
-- RESTORE pass gives KWI B trainings back their full time on its next run.
-- date_updated is left alone: a repair, not a fixture change.
--
-- Data backfill only, idempotent.

BEGIN;

WITH kwi AS (
  SELECT (SELECT id FROM halls WHERE name = 'KWI A') AS a,
         (SELECT id FROM halls WHERE name = 'KWI B') AS b
)
UPDATE games g
SET additional_halls = '[]'::json
FROM kwi
WHERE g.source = 'basketplan'
  AND g.hall = kwi.a
  AND g.additional_halls IS NOT NULL
  AND json_typeof(g.additional_halls) = 'array'
  AND EXISTS (
    SELECT 1 FROM json_array_elements_text(g.additional_halls) e
    WHERE e.value = kwi.b::text
  )
  AND NOT EXISTS (
    SELECT 1 FROM basketball_slot_plan p
    WHERE p.kscw_team = g.kscw_team
      AND p.date = g.date
      AND p.game_type = 'home'
      AND p.proposal_status <> 'declined'
      AND p.hall = 'KWI A+B'
  );

COMMIT;
