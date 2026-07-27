-- Migration 259 — remove the empty duplicate DU23-2 team row (id 96)
--
-- Context (DB review 2026-07-27 follow-up, GAMES-04/ri-12 residue). Two
-- teams rows share team_id 'vb_14040' (DU23-2): id 10 is the real 2025/26
-- team (11 roster rows, 11 trainings, the re-attached season games); id 96
-- is an inactive duplicate with NO roster, NO games, NO junctions — and
-- exactly ONE training (403, 01.06.2026, 10 RSVPs) mis-attributed to it.
-- The training's date is season 2025/26 and every participant is on team
-- 10's roster → re-point it to 10, then drop the duplicate. The 247 FK
-- (trainings.team → teams ON DELETE CASCADE) would otherwise cascade a real
-- attended training away with the duplicate row.
--
-- trg_protect_team_delete only blocks teams with member_teams rows (96 has
-- none). Guards make a re-run — and the nightly dev clone — a no-op.
--
-- Data repair; idempotent (safe to re-run).

BEGIN;

-- Re-point the one real training to the real DU23-2 (id resolved like
-- migration 247: min(id) over the shared team_id — deterministic 10).
UPDATE trainings t
   SET team = (SELECT min(id) FROM teams WHERE team_id = 'vb_14040')
 WHERE t.id = 403
   AND t.team IN (SELECT id FROM teams WHERE team_id = 'vb_14040')
   AND t.team <> (SELECT min(id) FROM teams WHERE team_id = 'vb_14040');

-- Drop the duplicate: only if it is the NON-minimal vb_14040 row and nothing
-- references it anymore.
DELETE FROM teams x
 WHERE x.team_id = 'vb_14040'
   AND x.id <> (SELECT min(id) FROM teams WHERE team_id = 'vb_14040')
   AND x.active = false
   AND NOT EXISTS (SELECT 1 FROM member_teams mt WHERE mt.team = x.id)
   AND NOT EXISTS (SELECT 1 FROM trainings t WHERE t.team = x.id)
   AND NOT EXISTS (SELECT 1 FROM games g WHERE g.kscw_team = x.id);

COMMIT;
