-- Migration 426: waive the deadline-sweep fines that went to guest players.
--
-- WHY
-- ---
-- The no-response deadline sweep (migration 352, kscw-hooks
-- sweepDeadlineNoResponses) declines everyone on a training who never answered
-- and auto-issues a late_signin fine. Its training branch keeps guest players
-- (member_teams.guest_level > 0) in, because a guest may answer a training —
-- so it fined them too. A guest is invited to the team's trainings, not
-- expected at them; on prod 30 of the first 50 auto fines (CHF 232) were
-- guests'. From this release the sweep still declines a silent guest but no
-- longer fines them (kscw-hooks, same commit).
--
-- WHAT CHANGES
-- ------------
-- Every OPEN, auto-issued late_signin fine whose member is a guest on the
-- fine's team is set to waived, with a reason. Paid fines are left alone (money
-- already changed hands — a refund is the team's call), and manual fines are
-- left alone (a leader chose to issue those).
--
-- Raw SQL, so the `fines.items.update` action does not run: no "fine waived"
-- push or bell entry. The fine simply shows as waived in the member's list.
--
-- Data backfill only, idempotent (a second run finds nothing open).

BEGIN;

UPDATE fines f
SET status        = 'waived',
    waived_at     = now(),
    waived_reason = 'Guest player: late sign-in fines do not apply to guests (migration 426)',
    date_updated  = now()
WHERE f.status = 'open'
  AND f.auto_issued = true
  AND f.category = 'late_signin'
  AND f.member IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM member_teams mt
    WHERE mt.member = f.member
      AND mt.team = f.team
      AND COALESCE(mt.guest_level, 0) > 0
  );

COMMIT;
