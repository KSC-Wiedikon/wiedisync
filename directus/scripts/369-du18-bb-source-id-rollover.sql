-- 369-du18-bb-source-id-rollover.sql
--
-- Corrects teams.bb_source_id for the two DU18 basketball squads (72 "DU18
-- Fire", 73 "DU18 Spark") for the 2026/27 season. Basketplan issued NEW team
-- entities for both squads at the season rollover; the ids migration 283
-- verified on 2026-08-05 (72->7182, 73->5697) are stale as of 2026-09-22:
--
--   * id 5697 is now Basketplan's "KSC Wiedikon DU18 Fire" (was Spark).
--   * id 7182 now resolves to "KSC Wiedikon DU16" with ZERO games this
--     season -- a different, unrelated squad (verified live against
--     findTeamById.do; migration 283's note that 7182 legitimately played
--     under the DU16 label was true THEN, for the team that held that id at
--     the time -- Basketplan has since detached it).
--   * Spark's real 2026/27 id is 7829 (16 games scheduled), not registered
--     against any team row before this migration.
--
-- Effect discovered via next Monday's DU18 Spark/Fire derby (2026-09-28,
-- Basketplan gameNumber 26-06206): bp-sync's parseGames() computes `isHome`/
-- `isGuestOurs` by checking the feed's homeTeamId/guestTeamId against our
-- bb_source_id set (teamIdSet). With 73 mapped to the WRONG id, the derby's
-- real homeTeamId (7829, Spark) matched nothing, so buildGameIntents() never
-- took the intra-club (two-row, home+away, shared hall) branch used for VB
-- derbies -- it wrote a single row (type='away', hall=NULL) under kscw_team
-- 73. Same root cause made team 72 (Fire) sync ZERO real Basketplan fixtures
-- all season (bb_source_id 7182 is empty), leaving it on 5 hand-entered
-- manual placeholders (source='manual') that the "superseded manual" sweep
-- could never retire, and made every fixture bp-sync fetched "for Spark"
-- under id 5697 actually be Fire's real schedule, mislabeled.
--
-- This migration only repoints the id. The next `bp-sync` run (cron 06:05
-- UTC, or POST /kscw/admin/bp-sync) does the actual resync: correct fixtures
-- land under the correct team, the derby becomes two rows sharing one
-- game_id with type home/away and a shared KWI hall (mirroring sv-sync's
-- volleyball derby handling), and the 5 stale manual rows for team 72 are
-- superseded once their replacement fixtures are in range.
--
-- Idempotent: guarded by current value, safe to re-run.

BEGIN;

UPDATE teams SET bb_source_id = '5697' WHERE id = 72 AND bb_source_id IS DISTINCT FROM '5697';
UPDATE teams SET bb_source_id = '7829' WHERE id = 73 AND bb_source_id IS DISTINCT FROM '7829';

DO $$
DECLARE
  bad_count integer;
BEGIN
  SELECT count(*) INTO bad_count FROM teams
    WHERE (id = 72 AND bb_source_id IS DISTINCT FROM '5697')
       OR (id = 73 AND bb_source_id IS DISTINCT FROM '7829');
  IF bad_count > 0 THEN
    RAISE EXCEPTION 'migration 369: expected teams 72/73 to carry the 2026/27 Basketplan ids (5697/7829), % row(s) still wrong', bad_count;
  END IF;
END $$;

COMMIT;
