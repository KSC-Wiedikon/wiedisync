-- Migration 456: team training auto-confirm no longer answers for guests.
--
-- WHY. With `features_enabled.training_auto_confirm` on, every auto-confirm
-- path seeded a `confirmed` row for the whole roster, guests (member_teams.
-- guest_level 1-3) included. A guest who never opened the app showed as coming
-- to every training, and the coach had to set them to "no" by hand, training
-- after training (reported 24.11.2026 on a women's team: four guests "coming"
-- to a training none of them had answered). Games never had this: game
-- auto-confirm has always required guest_level = 0.
--
-- WHAT. The code side (kscw-hooks autoConfirmTraining, the team-toggle
-- backfill, autoConfirmJoiner, kscw-endpoints sweepTrainingAutoConfirm) now
-- applies the team setting to guest_level 0 only. A guest who turned on
-- `members.auto_confirm_trainings` themselves is still auto-confirmed.
--
-- This migration deletes the rows that already leaked: future, non-staff,
-- `confirmed` training rows of guests on that team that nobody ever touched
-- (no status edit, no note, no extra guests, no absence marker) and whose
-- member has no personal opt-in. Deleted, not declined: the guest simply has
-- not answered yet, which is what they see again. Past rows stay (history).
-- On prod 27.11.2026 this matched 177 rows, 7 guests, 2 teams.
--
-- Idempotent (safe to re-run).

BEGIN;

DELETE FROM participations p
 USING trainings t, member_teams mt, members m
 WHERE p.activity_type = 'training'
   AND p.training = t.id
   AND t.date >= CURRENT_DATE
   AND mt.member = p.member AND mt.team = t.team AND mt.guest_level > 0
   AND m.id = p.member AND m.auto_confirm_trainings IS NOT TRUE
   AND p.status = 'confirmed'
   AND p.is_staff = false
   AND p.auto_declined_by IS NULL
   AND p.last_status_edited_by IS NULL AND p.last_status_edited_at IS NULL
   AND COALESCE(p.note, '') = ''
   AND COALESCE(p.guest_count, 0) = 0;

COMMIT;
