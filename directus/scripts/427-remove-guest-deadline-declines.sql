-- Migration 427: take guest players' deadline declines back off the trainings.
--
-- WHY
-- ---
-- From 2026-10-25 the no-response deadline sweep (kscw-hooks
-- sweepDeadlineNoResponses, migration 352) leaves guest players
-- (member_teams.guest_level > 0) alone on trainings as it already did on games:
-- a guest is invited, not expected, so not answering is neither a decline nor a
-- fine. Migration 426 waived the fines; this removes the `declined` rows the
-- sweep wrote for them, so their trainings show them as "no response" like any
-- guest who simply did not answer, and the "No" count is the people who said no.
--
-- WHAT CHANGES
-- ------------
-- Deletes training participations that are still system-owned deadline
-- declines (`auto_declined_deadline = true`, which the BEFORE UPDATE trigger
-- clears the moment anyone touches the status) of a member who is a guest on
-- that training's team. A row a person has changed since is kept.
--
-- Data backfill only, idempotent (a second run finds nothing).

BEGIN;

DELETE FROM participations p
USING trainings t, member_teams mt
WHERE p.activity_type = 'training'
  AND p.activity_id = t.id::text
  AND p.auto_declined_deadline = true
  AND p.status = 'declined'
  AND mt.member = p.member
  AND mt.team = t.team
  AND COALESCE(mt.guest_level, 0) > 0;

COMMIT;
