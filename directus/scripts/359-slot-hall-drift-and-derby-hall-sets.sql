-- 359 — Repair two hall-assignment defects surfaced on 10.09.2026.
--
-- Both were found chasing a D4 player's question: "why are we playing in Hall C
-- when we usually train in Hall A?" The answer was that they genuinely were —
-- KWI C had reached VolleyManager on the Züri Cup tie of 22.10.2026.
--
-- (A) Stale Terminplanung slot inventory. The slot generator read every
--     hall_slot ever assigned to a team with NO validity filter, so a block that
--     had already expired kept minting scheduling slots forever. Three teams
--     moved hall at the 2026/27 rollover and the generator never noticed:
--       D4      Thursday 19:30  KWI C      -> KWI A       (block expired 27.06.2026)
--       HU20    Tuesday  19:00  Döltschi 1 -> Döltschi 2  (   "        "        )
--       HU23-1  Tuesday  20:30  Döltschi 1 -> Döltschi 2  (   "        "        )
--     Every D4 home booking was then pushed to VolleyManager with KWI C.
--     The generator is fixed in game-scheduling.js (`slotLiveOn`).
--
--     ⚠ SCOPE: this migration repairs only the BOOKED and BLOCKED rows. The
--     `available` ones are left to slot regeneration — see the long note on the
--     _drift filter below for why hand-repairing them here would be wrong. The
--     inventory is NOT fully correct after this migration runs; regeneration is
--     still required, and the drift is wider than hall alone (several teams also
--     changed slot TIME at the rollover).
--
--     ⚠ Two shapes of repair are needed even within that scope, because the
--     Döltschi teams draw from the SHARED junior pool: for them the old and the
--     new block are BOTH in the pool, so the generator emitted a stale row *and*
--     a correct row for the same evening. Repointing those would collide. So a
--     drifted row is repointed only when no correct-hall row exists for that
--     team/date/time; otherwise the redundant one of the pair is dropped. Which
--     one is decided by status (booked > blocked > available) so a booking is
--     never deleted and a declared block is never silently lifted.
--
-- (B) Derby hall sets with a self-reference. An intra-club fixture keeps TWO
--     `games` rows, one per KSCW team, and both must describe the same physical
--     space — KWI A+B, i.e. hall = KWI A + additional_halls = [KWI B]. Two rows
--     instead carried additional_halls = [KWI A], the same court as `hall`.
--     The union across the pair still renders correctly on the Hallenplan, which
--     is why nobody saw it, but resolveVmHall() would dedupe such a row to a
--     single court — so a VM push off that row books half the space the club
--     reserved and reports success. See vm-halls.mjs.
--
-- Idempotent: on a second run the drift set is empty and every statement no-ops.

BEGIN;

-- ─── (A) Scheduling slots that disagree with their live hall_slot ───────────
--
-- Keyed on (team, weekday, start_time) — the same key the generator builds a
-- candidate from. `hall_slots.day_of_week` is 0=Mon; Postgres EXTRACT(dow) is
-- 0=Sun, hence the (+6) % 7 rotation.
--
-- Only rows whose live hall_slot resolves to exactly ONE hall are considered. A
-- team holding two live blocks at the same weekday+time in different halls is
-- left alone rather than resolved arbitrarily.

CREATE TEMP TABLE _drift ON COMMIT DROP AS
WITH live AS (
  SELECT gs.id,
         min(hs.hall)            AS hall,
         count(DISTINCT hs.hall) AS n_halls
  FROM game_scheduling_slots gs
  JOIN hall_slots_teams hst ON hst.teams_id = gs.kscw_team
  JOIN hall_slots hs        ON hs.id = hst.hall_slots_id
  WHERE gs.source = 'hall_slot'
    AND hs.day_of_week = ((EXTRACT(dow FROM gs.date)::int + 6) % 7)
    AND hs.start_time = gs.start_time
    AND hs.valid_from <= gs.date
    AND (hs.indefinite OR hs.valid_until >= gs.date)
  GROUP BY gs.id
)
SELECT gs.id, gs.kscw_team, gs.date, gs.start_time, gs.status, live.hall AS correct_hall
FROM game_scheduling_slots gs
JOIN live ON live.id = gs.id
WHERE live.n_halls = 1
  AND live.hall IS DISTINCT FROM gs.hall
  -- ⚠ booked/blocked ONLY, deliberately. `available` rows are left to slot
  -- regeneration, which rebuilds them from scratch with the fixed generator.
  -- Hand-repairing them here would mean reimplementing the generator's pool
  -- rules (junior Döltschi pool, Spielhalle fallback, Friday alternation) in
  -- SQL — a second copy of the logic, guaranteed to rot. Regeneration also
  -- catches the drift THIS statement cannot see: several teams changed slot
  -- TIME as well as hall at the rollover (D2 Tue 19:30->20:00, H1 19:30->19:45),
  -- and a row at the wrong time has no live hall_slot to be re-pointed at.
  --
  -- These rows are repaired here because regeneration deliberately preserves
  -- booked/blocked rows, and a stale one is not inert: vm-push-game.mjs reads
  -- slot.hall, so a "Retry" on such a booking re-sends the wrong hall to
  -- VolleyManager — which is how KWI C got there in the first place.
  --
  -- ⚠⚠ A booked row is a record of a fixture that was AGREED and pushed. Rewriting
  -- one is only safe when the new value provably matches reality, so the join
  -- above is deliberately narrow — the team's OWN live block, unambiguous. The 13
  -- rows it selects today are each independently safe:
  --   · D4 (7)  — all 8 D4 home fixtures were read back from VolleyManager on
  --               10.09.2026 and every one says Kantonsschule Wiedikon A. Our
  --               booked slots said KWI C. VM is right; this aligns us to it.
  --   · HU20 + HU23-1 (6) — Döltschi 1 and Döltschi 2 share ONE vm_hall_id
  --               (5a80a35c-…), so VM cannot tell them apart and nothing that was
  --               ever pushed changes meaning. Our Hallenplan can, and was wrong.
  --
  -- It deliberately does NOT touch the other stale booked rows in the table (D2
  -- Tue 19:30, and the Friday Spielhalle 19:30 rows for D3/H1/H3/DU23-1, whose
  -- slot TIME moved at the rollover). Those encode agreed fixtures whose correct
  -- value depends on what was actually pushed to VM per fixture — a judgement
  -- call, not a mechanical one. They are listed in DEVLOG for a human pass.
  AND gs.status IN ('booked', 'blocked');

-- Drifted rows that already have a correct-hall twin. One of the pair has to go;
-- the stronger status wins, and two booked rows are left for a human.
CREATE TEMP TABLE _merge ON COMMIT DROP AS
WITH ranked AS (
  SELECT d.id AS drift_id, s.id AS sib_id,
         CASE d.status WHEN 'booked' THEN 3 WHEN 'blocked' THEN 2 ELSE 1 END AS d_rank,
         CASE s.status  WHEN 'booked' THEN 3 WHEN 'blocked' THEN 2 ELSE 1 END AS s_rank
  FROM _drift d
  JOIN game_scheduling_slots s
    ON s.kscw_team = d.kscw_team
   AND s.date       = d.date
   AND s.start_time = d.start_time
   AND s.hall       = d.correct_hall
)
SELECT
  CASE WHEN d_rank >  s_rank THEN sib_id   ELSE drift_id END AS victim,
  CASE WHEN d_rank >  s_rank THEN drift_id ELSE sib_id   END AS survivor
FROM ranked
WHERE NOT (d_rank = 3 AND s_rank = 3);   -- both booked → leave alone

-- Re-point any proposal that named a row about to be deleted at its survivor.
-- `proposed_slot_*` carries no foreign key, so a bare delete would leave a
-- dangling id in the offer history rather than erroring. The survivor is the
-- same team, date and time — only the hall label differs — so the record of what
-- was offered stays truthful.
UPDATE game_scheduling_bookings b SET proposed_slot_1 = m.survivor
  FROM _merge m WHERE b.proposed_slot_1 = m.victim;
UPDATE game_scheduling_bookings b SET proposed_slot_2 = m.survivor
  FROM _merge m WHERE b.proposed_slot_2 = m.victim;
UPDATE game_scheduling_bookings b SET proposed_slot_3 = m.survivor
  FROM _merge m WHERE b.proposed_slot_3 = m.victim;
UPDATE game_scheduling_bookings b SET slot = m.survivor
  FROM _merge m WHERE b.slot = m.victim;

DELETE FROM game_scheduling_slots gs USING _merge m WHERE gs.id = m.victim;

-- Everything still standing: no twin existed, or this row won the merge.
UPDATE game_scheduling_slots gs
SET hall = d.correct_hall
FROM _drift d
WHERE d.id = gs.id
  AND gs.id NOT IN (SELECT victim FROM _merge);

-- ─── (B) Drop the self-reference from derby hall sets ───────────────────────
--
-- The correct additional_halls for such a row is the rest of the hall set the
-- fixture actually occupies — derived from the sibling row sharing its game_id,
-- never invented. A row with no sibling contributing a second court is left
-- alone (the union would collapse to a single hall, and emptying
-- additional_halls would be a guess, not a repair).

WITH occupied AS (
  SELECT game_id, hall AS h
    FROM games
   WHERE hall IS NOT NULL
  UNION
  SELECT game_id, (jsonb_array_elements_text(additional_halls::jsonb))::int
    FROM games
   WHERE additional_halls IS NOT NULL
),
fix AS (
  SELECT g.id, to_json(array_agg(DISTINCT o.h ORDER BY o.h)) AS halls
  FROM games g
  JOIN occupied o ON o.game_id = g.game_id AND o.h <> g.hall
  WHERE g.additional_halls IS NOT NULL
    AND (g.additional_halls::jsonb) @> to_jsonb(g.hall)   -- the defect
  GROUP BY g.id
)
UPDATE games g
SET additional_halls = fix.halls
FROM fix
WHERE fix.id = g.id;

COMMIT;
