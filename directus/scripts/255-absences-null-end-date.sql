-- Migration 255 — close the residual NULL end_date hole in absences
--
-- Context (DB review 2026-07-27, finding EVT-05). Migration 236 made
-- `indefinite ⇒ end_date = '2099-12-31'` a trigger-enforced invariant, but
-- only normalizes rows where indefinite IS TRUE. A row written with
-- indefinite=false AND end_date=NULL (admin UI leaving both blank, raw items
-- API, imports) still slips through with end_date NULL — and every coverage
-- evaluation keys purely on `end_date >= date` (never true for NULL), so
-- such an absence is invisible to auto-decline exactly like the pre-236
-- rows were.
--
-- Semantics: an absence with a start and no end IS an indefinite absence.
-- The trigger now normalizes BOTH directions: indefinite=true fills the
-- sentinel end_date (236 behavior, unchanged), and a NULL end_date promotes
-- the row to indefinite + sentinel.
--
-- Live count of offending rows on prod 2026-07-27: 0 — the backfill is a
-- guard for divergent clones and future imports applied before the trigger.
-- (236's step-3 participation re-override is NOT repeated here: with 0
-- affected rows there is nothing newly reachable to flip.)
--
-- Schema + data backfill; idempotent (safe to re-run).

BEGIN;

CREATE OR REPLACE FUNCTION trg_absences_normalize_indefinite()
RETURNS trigger AS $$
BEGIN
  IF NEW.end_date IS NULL THEN
    NEW.indefinite := TRUE;
  END IF;
  IF NEW.indefinite IS TRUE THEN
    NEW.end_date := DATE '2099-12-31';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Trigger itself is unchanged from 236 (BEFORE INSERT OR UPDATE); recreate
-- defensively for clones where it might be missing.
DROP TRIGGER IF EXISTS trg_absences_normalize_indefinite ON absences;
CREATE TRIGGER trg_absences_normalize_indefinite
  BEFORE INSERT OR UPDATE ON absences
  FOR EACH ROW EXECUTE FUNCTION trg_absences_normalize_indefinite();

UPDATE absences
SET indefinite = TRUE,
    end_date   = DATE '2099-12-31'
WHERE end_date IS NULL;

COMMIT;
