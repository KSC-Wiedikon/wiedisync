-- Migration 062: heal duplicate training participations from migration 061's backfill.
--
-- Migration 061's one-time backfill merged participations from every
-- non-survivor row in a trial-involved duplicate (team,date) group onto the
-- survivor. Its NOT EXISTS dedupe checked only the survivor, so a member who
-- had a participation on TWO OR MORE non-survivor rows got duplicate
-- (activity_type='training', activity_id=survivor, member) rows inserted —
-- there is no unique constraint on participations to backstop this. 061 is
-- already applied (apply-once, sha-locked: it cannot be edited), so this
-- fixes forward with an idempotent de-duplication of TRAINING participations.
--
-- Keeps the newest RSVP per (activity_id, member) — highest participations.id,
-- consistent with migration 061's "newest intent wins" semantics — and
-- deletes the older duplicate rows. Scoped to activity_type='training'
-- (the only path 061's backfill touched). Idempotent: a second run finds
-- every group at row_number()=1 and deletes nothing. Schema-unrelated data
-- repair; no trigger/DDL changes (061's generalized trigger is correct and
-- its single-source merge has no duplication path).
--
-- Idempotent.

BEGIN;

WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY activity_type, activity_id, member
           ORDER BY id DESC
         ) AS rn
  FROM participations
  WHERE activity_type = 'training'
)
DELETE FROM participations p
USING ranked
WHERE p.id = ranked.id
  AND ranked.rn > 1;

COMMIT;
