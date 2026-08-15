-- Migration 322: derive trainings.respond_by from the team's
-- `training_respond_by_days`, for every writer
--
-- Context (2026-08-15). `respond_by` is the RSVP deadline: the app shows it,
-- the 07:00 cron sends `deadline_reminder` off it, `auto_decline_tentative`
-- flips maybes past it, and `auto_cancel_on_min` reads it. Seven active teams
-- have `features_enabled.training_respond_by_days` configured.
--
-- It was set on 14 of 1,333 trainings ever. Only `TrainingForm` — the manual
-- admin dialog — applies the team offset; slot-cascade, which generates
-- essentially every training the club runs, inserts via raw knex and never
-- touched the column. So a setting seven teams deliberately configured has
-- been inert since it shipped, and no generated training has ever produced a
-- deadline reminder.
--
-- A trigger rather than JS in slot-cascade, because slot-cascade is not the
-- only writer that skips the hooks: the nightly top-up, the slot-update fill,
-- the items API and hand-written SQL all reach this table, and the column has
-- to be right for all of them. This is the same reasoning as the other
-- integrity triggers in 001.
--
-- ── Semantics, which are not obvious ────────────────────────────────────────
-- `respond_by` is timestamptz and the FRONTEND reads a bare midnight specially:
-- `getDeadlineDate()` (src/utils/dateHelpers.ts) treats a Zurich time-of-day of
-- exactly 00:00:00 as "no time given" and substitutes the training's
-- `start_time`. So midnight is not a neutral value — it is a sentinel.
--
-- We therefore write (date - N days) at the training's OWN start_time, in
-- Europe/Zurich. Two reasons:
--   1. It matches what TrainingForm already produces (`respondByTime ||
--      startTime || '23:59'`), so hand-made and generated trainings agree.
--   2. ⚠ Midnight Zurich would be WRONG for the crons. They compare
--      `respond_by::date`, which casts in the session zone (Etc/UTC on this
--      server): midnight Zurich on 01.09 stores as 31.08 22:00+00, so
--      `::date` = 31.08 — a day EARLY, and the deadline reminder would fire on
--      the wrong day. With start_time 20:00 it stores 01.09 18:00+00 and
--      `::date` = 01.09, which is the day meant. Verified on prod before this
--      was written.
-- `start_time` NULL falls back to 23:59 (TrainingForm's own last resort), which
-- casts to the right day too.
--
-- ⚠ `training_respond_by_days = 0` is a real value ("respond before it starts",
-- DU18 Fire) and must not be read as unset. The guard is IS NULL / < 0, never
-- a truthiness test — the exact trap bp-sync's `days > 0` falls into on the
-- games side.
--
-- ⚠ On UPDATE the deadline follows the activity ONLY when it was derived. A
-- coach who set a deadline by hand keeps it: we re-derive just when the stored
-- value still equals what the OLD date/start_time would have produced (or was
-- NULL). An explicit `respond_by` in the same statement always wins, so
-- sv-sync / bp-sync style writers are never fought.
--
-- ── What this does and does not switch on ───────────────────────────────────
-- Turns on: the deadline shown in the app, `deadline_reminder`, and
-- `auto_decline_tentative` for the 3 teams that enabled it (3 tentative RSVPs
-- on future trainings at the time of writing).
-- Does NOT turn on `auto_cancel_on_min`: that gate also needs per-training
-- `min_participants > 0` AND `auto_cancel_on_min = true`, and slot-cascade sets
-- neither — 0 of all future trainings carry either. Measured before shipping:
-- 0 trainings would be cancelled. Deriving THOSE from the team defaults is a
-- separate decision, deliberately not taken here.
--
-- ⚠ The backfill is FUTURE-DEADLINE-ONLY. A `respond_by` in the past renders as
-- `deadlinePassed` → `isLocked` in TrainingDetailModal, which disables the RSVP
-- buttons. Stamping an already-expired deadline onto trainings people can still
-- attend would lock them out of answering — worse than the NULL it replaced.
--
-- Schema (trigger) + bounded backfill; idempotent.

BEGIN;

CREATE OR REPLACE FUNCTION trg_trainings_fill_respond_by()
RETURNS trigger AS $$
DECLARE
  v_days_txt text;
  v_days     int;
BEGIN
  IF NEW.team IS NULL OR NEW.date IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT NULLIF(features_enabled->>'training_respond_by_days', '')
    INTO v_days_txt
    FROM teams WHERE id = NEW.team;

  -- Tolerate junk in the JSON rather than aborting the write: an unparsable
  -- setting means "no deadline", not "no training".
  IF v_days_txt IS NULL OR v_days_txt !~ '^[0-9]+$' THEN
    RETURN NEW;
  END IF;
  v_days := v_days_txt::int;

  IF TG_OP = 'INSERT' THEN
    IF NEW.respond_by IS NULL THEN
      NEW.respond_by := ((NEW.date - v_days) + COALESCE(NEW.start_time, '23:59'::time))
                        AT TIME ZONE 'Europe/Zurich';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE: follow a moved date/time, but only for a derived deadline, and only
  -- when this statement is not setting one itself.
  IF (NEW.date IS DISTINCT FROM OLD.date OR NEW.start_time IS DISTINCT FROM OLD.start_time)
     AND NEW.respond_by IS NOT DISTINCT FROM OLD.respond_by
     AND (
       OLD.respond_by IS NULL
       OR OLD.respond_by = ((OLD.date - v_days) + COALESCE(OLD.start_time, '23:59'::time))
                           AT TIME ZONE 'Europe/Zurich'
     )
  THEN
    NEW.respond_by := ((NEW.date - v_days) + COALESCE(NEW.start_time, '23:59'::time))
                      AT TIME ZONE 'Europe/Zurich';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS trg_trainings_fill_respond_by ON trainings;
CREATE TRIGGER trg_trainings_fill_respond_by
  BEFORE INSERT OR UPDATE ON trainings
  FOR EACH ROW EXECUTE FUNCTION trg_trainings_fill_respond_by();

COMMENT ON FUNCTION trg_trainings_fill_respond_by() IS
  'Fills trainings.respond_by from teams.features_enabled.training_respond_by_days: (date - N days) at the training start_time, Europe/Zurich. Only when NULL on insert; on update only when the date/time moved AND the stored value was the derived one. Midnight is NOT used — getDeadlineDate() reads it as a sentinel and respond_by::date would land a day early in UTC.';

-- ── Backfill: existing future trainings whose deadline has not passed ────────
UPDATE trainings tr
SET respond_by = ((tr.date - (t.features_enabled->>'training_respond_by_days')::int)
                  + COALESCE(tr.start_time, '23:59'::time)) AT TIME ZONE 'Europe/Zurich'
FROM teams t
WHERE t.id = tr.team
  AND tr.respond_by IS NULL
  AND tr.cancelled = false
  AND tr.date >= CURRENT_DATE
  AND t.features_enabled->>'training_respond_by_days' ~ '^[0-9]+$'
  AND ((tr.date - (t.features_enabled->>'training_respond_by_days')::int)
       + COALESCE(tr.start_time, '23:59'::time)) AT TIME ZONE 'Europe/Zurich' > now();

COMMIT;
