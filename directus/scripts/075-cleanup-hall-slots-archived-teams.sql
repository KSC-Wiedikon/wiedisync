-- Migration 075: drop archived-team links left on recurring hall_slots by the
-- season rollover.
--
-- The /game-scheduling rollover clones each old team into a new-season team and
-- then copies the recurring hall-plan links to the new team via
-- `cloneJunction('hall_slots_teams', ...)` — but it ADDS the new team's junction
-- row without REMOVING the old one, then archives the old teams (active=false).
-- Result after the 2026-06-01 rollover: 48 of 52 hall_slots are dual-linked
-- `[old archived team, new active team]`, with the archived team sorting first
-- (lower id). The calendar resolves a slot's name/sport from its first team and
-- only loads active teams, so every recurring slot rendered grey + nameless and
-- the VB/BB sport filter classified nothing.
--
-- The rollover endpoint is fixed forward to re-point instead of duplicate (see
-- game-scheduling.js), so future rollovers won't reintroduce this. This migration
-- cleans up the rows already written on dev/prod.
--
-- Fix: delete every hall_slots_teams row whose team is archived (active=false),
-- but only when the same slot still carries an active team — so no slot is ever
-- left with zero teams. Verified on prod: 0 slots reference only archived teams,
-- so this drops exactly the redundant links and nothing else.
--
-- Idempotent: once the archived links are gone, the DELETE matches no rows on
-- re-run. Data-only cleanup — no schema or permission changes.

BEGIN;

DELETE FROM hall_slots_teams hst
USING teams t
WHERE hst.teams_id = t.id
  AND t.active = false
  AND EXISTS (
    SELECT 1
    FROM hall_slots_teams hst2
    JOIN teams t2 ON t2.id = hst2.teams_id
    WHERE hst2.hall_slots_id = hst.hall_slots_id
      AND t2.active = true
  );

COMMIT;
