-- Migration 061: generalize trial-transform so a new trial collapses ANY
-- active same-date training (regular OR trial), not just a regular.
--
-- Migration 056's trg_trainings_trial_transform only collapsed a new trial
-- onto an existing REGULAR sibling (lookup had `AND is_trial = false`). When
-- the same-date sibling was already a trial (a second trial booked for the
-- same team+date, or repeat scheduling), the lookup found no regular and the
-- new trial was left standalone -> two active trials for one (team,date),
-- duplicated on the admin list AND the public team page.
--
-- Fix-forward (do NOT edit 056/060): CREATE OR REPLACE the function with the
-- `AND is_trial = false` predicate removed from the new-trial sibling lookup
-- (+ deterministic ORDER BY id). A new trial now transforms whichever active
-- same-date training already exists (regular OR trial): participations are
-- merged onto it, the newest trial's data wins (COALESCE(NEW.x, x)), and the
-- just-inserted row is deleted. Net invariant: at most one active training
-- per (team,date); a trial always wins; no cancelled ghosts.
--
-- One-time idempotent backfill collapses existing TRIAL-INVOLVED duplicate
-- (team,date) groups (>=2 active rows AND at least one is_trial). Regular-
-- regular duplicates (no trial in the group) are a separate pre-existing
-- data issue and are intentionally LEFT UNTOUCHED here.
--
-- Idempotent.

BEGIN;

-- == Fix-forward: generalized transform function ===================
CREATE OR REPLACE FUNCTION trg_trainings_trial_transform()
RETURNS trigger AS $$
DECLARE
  v_existing_id integer;
BEGIN
  IF NEW.cancelled = true OR NEW.team IS NULL OR NEW.date IS NULL THEN
    RETURN NULL;
  END IF;

  IF NEW.is_trial = true THEN
    -- Look for ANY existing active same-date sibling (regular OR trial).
    -- Migration 056 restricted this with `AND is_trial = false`; that
    -- restriction is removed here so trial-onto-trial also collapses.
    -- ORDER BY id makes the target deterministic if >1 exists pre-backfill.
    SELECT id INTO v_existing_id
    FROM trainings
    WHERE team = NEW.team
      AND date = NEW.date
      AND id <> NEW.id
      AND cancelled = false
    ORDER BY id
    LIMIT 1;

    IF v_existing_id IS NOT NULL THEN
      INSERT INTO participations (member, activity_type, activity_id, status, note, guest_count, is_staff, auto_declined_by)
      SELECT src.member, 'training', v_existing_id::text, src.status, src.note, src.guest_count, src.is_staff, src.auto_declined_by
      FROM participations src
      WHERE src.activity_type = 'training' AND src.activity_id = NEW.id::text
        AND NOT EXISTS (
          SELECT 1 FROM participations dst
          WHERE dst.activity_type = 'training' AND dst.activity_id = v_existing_id::text
            AND dst.member = src.member
        );

      DELETE FROM participations
      WHERE activity_type = 'training' AND activity_id = NEW.id::text;

      UPDATE trainings
      SET is_trial = true,
          notes = CASE WHEN NEW.notes IS NOT NULL AND NEW.notes <> ''
                       THEN NEW.notes ELSE notes END,
          min_participants = COALESCE(NEW.min_participants, min_participants),
          max_participants = COALESCE(NEW.max_participants, max_participants),
          excluded_guest_levels = COALESCE(NEW.excluded_guest_levels, excluded_guest_levels),
          require_note_if_absent = NEW.require_note_if_absent,
          recruiting_positions = COALESCE(NEW.recruiting_positions, recruiting_positions)
      WHERE id = v_existing_id;

      DELETE FROM trainings WHERE id = NEW.id;
    END IF;

  ELSE
    -- New is a regular. If a trial already covers this date, discard the
    -- new regular so the trial stays the only row. (Unchanged from 056.)
    IF EXISTS (
      SELECT 1 FROM trainings
      WHERE team = NEW.team
        AND date = NEW.date
        AND id <> NEW.id
        AND is_trial = true
        AND cancelled = false
    ) THEN
      DELETE FROM participations
      WHERE activity_type = 'training' AND activity_id = NEW.id::text;
      DELETE FROM trainings WHERE id = NEW.id;
    END IF;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- == One-time backfill: collapse trial-involved duplicates =========
-- For each (team,date) with >=2 active rows where at least one is a trial:
--   survivor = MIN(id); newest = MAX(id) (latest intent).
-- Merge participations of every other active row onto survivor (skip
-- members survivor already has), delete those rows' participations, set
-- survivor is_trial=true with the newest row's data winning, then delete
-- the non-survivor active rows. Idempotent: re-run finds no qualifying
-- groups (each (team,date) then has <=1 active row).
DO $$
DECLARE
  grp RECORD;
  v_survivor integer;
  v_newest integer;
BEGIN
  FOR grp IN
    SELECT team, date
    FROM trainings
    WHERE cancelled = false
    GROUP BY team, date
    HAVING count(*) > 1 AND bool_or(is_trial)
  LOOP
    SELECT min(id), max(id) INTO v_survivor, v_newest
    FROM trainings
    WHERE team = grp.team AND date = grp.date AND cancelled = false;

    INSERT INTO participations (member, activity_type, activity_id, status, note, guest_count, is_staff, auto_declined_by)
    SELECT src.member, 'training', v_survivor::text, src.status, src.note, src.guest_count, src.is_staff, src.auto_declined_by
    FROM participations src
    JOIN trainings t
      ON t.id::text = src.activity_id
     AND src.activity_type = 'training'
    WHERE t.team = grp.team AND t.date = grp.date AND t.cancelled = false
      AND t.id <> v_survivor
      AND NOT EXISTS (
        SELECT 1 FROM participations dst
        WHERE dst.activity_type = 'training' AND dst.activity_id = v_survivor::text
          AND dst.member = src.member
      );

    DELETE FROM participations
    WHERE activity_type = 'training'
      AND activity_id IN (
        SELECT id::text FROM trainings
        WHERE team = grp.team AND date = grp.date AND cancelled = false
          AND id <> v_survivor
      );

    UPDATE trainings s
    SET is_trial = true,
        notes = CASE WHEN n.notes IS NOT NULL AND n.notes <> ''
                     THEN n.notes ELSE s.notes END,
        min_participants = COALESCE(n.min_participants, s.min_participants),
        max_participants = COALESCE(n.max_participants, s.max_participants),
        excluded_guest_levels = COALESCE(n.excluded_guest_levels, s.excluded_guest_levels),
        require_note_if_absent = n.require_note_if_absent,
        recruiting_positions = COALESCE(n.recruiting_positions, s.recruiting_positions)
    FROM trainings n
    WHERE s.id = v_survivor AND n.id = v_newest;

    DELETE FROM trainings
    WHERE team = grp.team AND date = grp.date AND cancelled = false
      AND id <> v_survivor;
  END LOOP;
END $$;

COMMIT;
