-- Migration 233: indefinite absences must carry a real upper-bound end_date
--
-- Background. Every absence-coverage evaluation in the codebase keys purely on
-- `end_date` (`a.end_date::date >= <activity date>`):
--   • autoDeclineForAbsence            (kscw-hooks index.js — bails at
--                                       `if (!startDate || !endDate) return`)
--   • applyTrainingAutoRSVP / games.items.create / events.items.create
--   • reEvalActivityAutoDeclines
--   • the participations.items.create filter
--   • the frontend absenceCoversActivity() overlay
-- None of them consults the `indefinite` boolean.
--
-- `absences.end_date` is NULLABLE. The app forms paper over this by writing the
-- sentinel `end_date = '2099-12-31'` whenever `indefinite` is ticked, but any
-- row NOT created through those forms — Directus admin UI (staff tick
-- "indefinite" and leave end_date blank), the raw items API, or older/imported
-- data — lands with `end_date = NULL`. For such a row `a.end_date >= date`
-- evaluates to NULL (never true), so the member is INVISIBLE to auto-decline:
-- an indefinite absentee is never signed out of trainings/games, and when a
-- fresh training is generated inside the window applyTrainingAutoRSVP even
-- AUTO-CONFIRMS them. (Symptom reported 2026-07-25: D4 / Celina Paulsson had an
-- indefinite absence yet showed as "in" for the 17.08 training.) This is
-- unrelated to the `blocking` flag, which only gates game-scheduling
-- availability, not participation.
--
-- Fix. Make `indefinite ⇒ end_date = '2099-12-31'` a hard invariant enforced by
-- a BEFORE INSERT/UPDATE trigger (catches every write path — admin UI, API,
-- imports, hooks), backfill the existing offending rows, then re-run the
-- migration-038 hard-override so participations that were wrongly left
-- confirmed/tentative/waitlisted get flipped to declined.
--
-- Schema + data backfill; idempotent (safe to re-run).

BEGIN;

-- ── (1) Enforce the invariant on every write ─────────────────────────────
-- Mirrors the trg_slot_claims_validate / trg_members_shell_convert pattern in
-- 001-postgres-triggers.sql. An indefinite absence has no meaningful end date;
-- the far-future sentinel keeps the existing end_date-keyed coverage SQL and
-- the frontend forms (which already treat 2099 / indefinite as "no end")
-- working without touching a dozen queries.
CREATE OR REPLACE FUNCTION trg_absences_normalize_indefinite()
RETURNS trigger AS $$
BEGIN
  IF NEW.indefinite IS TRUE THEN
    NEW.end_date := DATE '2099-12-31';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS trg_absences_normalize_indefinite ON absences;
CREATE TRIGGER trg_absences_normalize_indefinite
  BEFORE INSERT OR UPDATE ON absences
  FOR EACH ROW EXECUTE FUNCTION trg_absences_normalize_indefinite();

-- ── (2) Backfill existing indefinite rows to the sentinel ────────────────
UPDATE absences
SET end_date = DATE '2099-12-31'
WHERE indefinite IS TRUE
  AND end_date IS DISTINCT FROM DATE '2099-12-31';

-- ── (3) Re-run the migration-038 hard-override ───────────────────────────
-- Now that the indefinite rows carry a real upper bound, the coverage joins
-- finally match. Flip any confirmed / tentative / waitlisted participation an
-- absence covers to declined, attaching auto_declined_by. Only touches rows
-- newly reachable via step (2); already-declined rows are skipped (idempotent).
-- The BEFORE UPDATE marker trigger (038) preserves auto_declined_by because the
-- same statement sets both status and marker.
--
-- days_of_week is Mon=0..Sun=6; Postgres EXTRACT(DOW) is Sun=0..Sat=6 — bridge
-- with (pg_dow + 6) % 7.

-- Trainings
WITH covered AS (
  SELECT p.id AS pid, a.id AS aid, COALESCE(a.reason, '') AS reason
  FROM participations p
  JOIN trainings t ON p.activity_type = 'training' AND p.activity_id = t.id::text
  JOIN absences a ON a.member = p.member
  WHERE p.status IN ('confirmed', 'tentative', 'waitlisted')
    AND t.cancelled = false
    AND t.date >= a.start_date::date AND t.date <= a.end_date::date
    AND (a.affects::jsonb @> '"all"' OR a.affects::jsonb @> '"trainings"')
    AND (a.type != 'weekly' OR a.days_of_week::jsonb @> to_jsonb((EXTRACT(DOW FROM t.date)::int + 6) % 7))
)
UPDATE participations p
SET status = 'declined',
    note = covered.reason,
    auto_declined_by = covered.aid
FROM covered
WHERE p.id = covered.pid;

-- Games
WITH covered AS (
  SELECT p.id AS pid, a.id AS aid, COALESCE(a.reason, '') AS reason
  FROM participations p
  JOIN games g ON p.activity_type = 'game' AND p.activity_id = g.id::text
  JOIN absences a ON a.member = p.member
  WHERE p.status IN ('confirmed', 'tentative', 'waitlisted')
    AND g.kscw_team IS NOT NULL
    AND COALESCE(g.status, '') NOT IN ('completed', 'postponed', 'cancelled')
    AND g.date >= a.start_date::date AND g.date <= a.end_date::date
    AND (a.affects::jsonb @> '"all"' OR a.affects::jsonb @> '"games"')
    AND (a.type != 'weekly' OR a.days_of_week::jsonb @> to_jsonb((EXTRACT(DOW FROM g.date)::int + 6) % 7))
)
UPDATE participations p
SET status = 'declined',
    note = covered.reason,
    auto_declined_by = covered.aid
FROM covered
WHERE p.id = covered.pid;

-- Events
WITH covered AS (
  SELECT p.id AS pid, a.id AS aid, COALESCE(a.reason, '') AS reason
  FROM participations p
  JOIN events e ON p.activity_type = 'event' AND p.activity_id = e.id::text
  JOIN absences a ON a.member = p.member
  WHERE p.status IN ('confirmed', 'tentative', 'waitlisted')
    AND e.start_date::date >= a.start_date::date AND e.start_date::date <= a.end_date::date
    AND (a.affects::jsonb @> '"all"' OR a.affects::jsonb @> '"events"')
    AND (a.type != 'weekly' OR a.days_of_week::jsonb @> to_jsonb((EXTRACT(DOW FROM e.start_date::date)::int + 6) % 7))
)
UPDATE participations p
SET status = 'declined',
    note = covered.reason,
    auto_declined_by = covered.aid
FROM covered
WHERE p.id = covered.pid;

COMMIT;
