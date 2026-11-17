-- Migration 453: `participations.training` — a REAL foreign key behind the
-- polymorphic `activity_id` for training RSVPs, so a Directus policy filter can
-- join an RSVP back to the training (and its team) it belongs to.
--
-- WHY. A coach may edit the RSVPs of "their own people", which the policy
-- (setup-permissions.mjs → COACH_OR_TR_OF_PARTICIPATION) expresses member-side:
-- "is this row's member on a team I coach?". A player borrowed from another team
-- for one training is on no team of the host coach, so the host coach is refused
-- when he sets that player's answer:
--
--   17.11.2026: the D1 coach set an H1 player's RSVP on D1's training of 18.11 →
--   Directus 403 "You don't have permissions to perform "update" for the
--   field(s) "status", "last_status_edited_by", "last_status_edited_at" …".
--
-- On prod 1780 of 13423 training RSVPs (13%) are on someone outside the
-- training's team, so this is not a one-off. Games got a guest branch in
-- migration 271 and events got `participations.event` in migration 333;
-- trainings had neither because `activity_id` is a varchar Directus cannot join.
--
-- WHAT. `training` is a derived mirror of activity_id, never hand-written: a
-- BEFORE INSERT/UPDATE trigger sets it to activity_id::int for training rows and
-- NULL for everything else. (activity_type, activity_id) stay the source of truth
-- and keep their unique indexes. Same shape as migration 333 (`event`).
--
-- ON DELETE CASCADE matches what already happens: trg_trainings_0_purge_polymorphic
-- (migration 246) deletes exactly these rows when a training is deleted.
--
-- Schema-only + idempotent. The permission change that USES this column lives in
-- setup-permissions.mjs (never in a numbered migration — CLAUDE.md §1).

BEGIN;

ALTER TABLE participations
  ADD COLUMN IF NOT EXISTS training integer;

COMMENT ON COLUMN participations.training IS
  'Derived mirror of activity_id when activity_type = ''training'' (NULL otherwise). Maintained by trg_participations_sync_training — never write it by hand. Exists so policy filters can join an RSVP to its training; (activity_type, activity_id) remain the source of truth.';

CREATE OR REPLACE FUNCTION trg_participations_sync_training() RETURNS trigger AS $$
BEGIN
  IF NEW.activity_type = 'training' AND NEW.activity_id ~ '^[0-9]+$' THEN
    NEW.training := NEW.activity_id::int;
  ELSE
    NEW.training := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_participations_sync_training ON participations;
CREATE TRIGGER trg_participations_sync_training
  BEFORE INSERT OR UPDATE ON participations
  FOR EACH ROW EXECUTE FUNCTION trg_participations_sync_training();

-- Backfill. Defensive (non-numeric id, missing training) so dev clones and fresh
-- installs do not depend on today's data being clean; prod has 0 of either.
UPDATE participations p
   SET training = p.activity_id::int
 WHERE p.activity_type = 'training'
   AND p.activity_id ~ '^[0-9]+$'
   AND p.training IS DISTINCT FROM p.activity_id::int
   AND EXISTS (SELECT 1 FROM trainings t WHERE t.id = p.activity_id::int);

DO $$ BEGIN
  ALTER TABLE participations
    ADD CONSTRAINT participations_training_foreign
    FOREIGN KEY (training) REFERENCES trainings(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Partial: only training rows carry it, and every query that uses it is already
-- scoped to activity_type = 'training'.
CREATE INDEX IF NOT EXISTS participations_training_idx
  ON participations (training) WHERE training IS NOT NULL;

INSERT INTO directus_fields (collection, field, special, interface, display, readonly, sort, width, note)
SELECT 'participations', 'training', 'm2o', 'select-dropdown-m2o', 'related-values', true, 91, 'half',
       'Derived from activity_id by trigger — do not edit.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'participations' AND field = 'training');

INSERT INTO directus_relations (many_collection, many_field, one_collection, one_field, one_collection_field, one_allowed_collections, junction_field, sort_field, one_deselect_action)
SELECT 'participations', 'training', 'trainings', NULL, NULL, NULL, NULL, NULL, 'delete'
WHERE NOT EXISTS (SELECT 1 FROM directus_relations WHERE many_collection = 'participations' AND many_field = 'training');

COMMIT;
