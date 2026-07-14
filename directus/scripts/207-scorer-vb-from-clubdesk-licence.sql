-- 207 — Backfill members.scorer_vb from the ClubDesk "Offiziellen Lizenz" picklist.
--
-- "VB SC" in the ClubDesk register IS the volleyball Schreiber licence. Until now
-- the mapping only ran one way: wiedisync pushed scorer_vb → "VB SC"
-- (deriveOffiziellenLizenz in clubdesk-update.js), but a licence granted directly
-- in the register never flowed back, so members showed "VB SC" in the Explorer with
-- no Scorer (VB) checkmark and were invisible to scorer assignment.
--
-- Set-true only — the same policy as the referee-group sync-down: a member dropped
-- from the licence in ClubDesk keeps the flag until it is cleared by hand, so we
-- never clobber a licence wiedisync knows about and ClubDesk has not caught up on.
--
-- The ongoing rule lives in import-clubdesk-csv.mjs (same block as the referee
-- flags); this migration only heals the rows already in the register snapshot.
-- Idempotent: the change-guard makes a re-run a no-op.

BEGIN;

UPDATE members m SET scorer_vb = true
  FROM clubdesk_export c
 WHERE btrim(c.clubdesk_id) = btrim(m.clubdesk_id)
   AND m.scorer_vb IS DISTINCT FROM true
   AND upper(btrim(c.offiziellen_lizenz)) = 'VB SC';

COMMIT;
