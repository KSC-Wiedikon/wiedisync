-- Migration 164: close the closed-year immutability BYPASS via fiscal_year re-point.
--
-- Audit 2026-07-02 (#19). Migration 151's finance_native_txn_lock() checks only
-- the row's *current* fiscal_year — for UPDATE it inspects NEW.fiscal_year. So a
-- native entry sitting in a CLOSED year could be edited (or effectively unlocked)
-- by an UPDATE that re-points `fiscal_year` to an OPEN year: NEW.fiscal_year is
-- open → the check passes → a closed book is mutated after the fact.
--
-- Fix: on UPDATE guard BOTH the OLD and NEW year — you may neither edit a row that
-- LIVES in a closed year nor move a row INTO or OUT OF one. INSERT still guards the
-- target (NEW) year; DELETE still guards the current (OLD) year. The year-end close
-- is unaffected (it inserts Abschluss/Eröffnung legs while the years are still open,
-- then flips status). ClubDesk-mirror rows (source != 'native') are never guarded.
--
-- Schema-only + idempotent (CREATE OR REPLACE; the migration-151 trigger binding is
-- unchanged and picks up the new function body).

BEGIN;

CREATE OR REPLACE FUNCTION finance_native_txn_lock() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE new_status text; DECLARE old_status text;
BEGIN
  -- Target year (INSERT/UPDATE): cannot write into a closed year.
  IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.source = 'native' THEN
    SELECT status INTO new_status FROM finance_fiscal_years WHERE id = NEW.fiscal_year;
    IF new_status = 'closed' THEN
      RAISE EXCEPTION 'Cannot % a native ledger entry in a closed fiscal year — post a reversal in an open year instead', lower(TG_OP);
    END IF;
  END IF;
  -- Current year (UPDATE/DELETE): cannot touch a row that belongs to a closed
  -- year — this is what blocks the fiscal_year re-point bypass.
  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.source = 'native' THEN
    SELECT status INTO old_status FROM finance_fiscal_years WHERE id = OLD.fiscal_year;
    IF old_status = 'closed' THEN
      RAISE EXCEPTION 'Cannot % a native ledger entry that belongs to a closed fiscal year — post a reversal in an open year instead', lower(TG_OP);
    END IF;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

COMMIT;
