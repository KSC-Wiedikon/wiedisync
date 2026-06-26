-- Migration 151: extend the native-ledger immutability trigger to INSERT.
--
-- Migration 150 guarded UPDATE/DELETE only, so a native INSERT into a CLOSED fiscal
-- year (a stray items-API insert, a future auto-posting hook, a mis-targeted script)
-- slipped through. Now INSERT is guarded too. The year-end close is unaffected: it
-- inserts the Abschluss legs while the year is still 'open' and flips status to
-- 'closed' afterward, so those inserts see an open year and are allowed; the
-- Eröffnung legs land in the next (open) year. ClubDesk-mirror rows (source!='native')
-- are never guarded, so the nightly importer keeps working.
--
-- Schema-only + idempotent.

BEGIN;

CREATE OR REPLACE FUNCTION finance_native_txn_lock() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE fy_status text;
DECLARE r finance_transactions;
BEGIN
  r := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  IF r.source = 'native' THEN
    SELECT status INTO fy_status FROM finance_fiscal_years WHERE id = r.fiscal_year;
    IF fy_status = 'closed' THEN
      RAISE EXCEPTION 'Cannot % a native ledger entry in a closed fiscal year — post a reversal in an open year instead', lower(TG_OP);
    END IF;
  END IF;
  RETURN r;
END;
$$;

DROP TRIGGER IF EXISTS trg_finance_native_txn_lock ON finance_transactions;
CREATE TRIGGER trg_finance_native_txn_lock
  BEFORE INSERT OR UPDATE OR DELETE ON finance_transactions
  FOR EACH ROW EXECUTE FUNCTION finance_native_txn_lock();

COMMIT;
