-- Migration 165: one reversal per native ledger entry (race backstop).
--
-- Audit 2026-07-02 (#6). POST /finance/ledger/entries/:id/reverse now rejects
-- reversing an already-reversed entry and reversing a Storno (application guard),
-- but a concurrent double-submit could still slip two Stornos past the read-check.
-- A partial UNIQUE index on reversal_of makes the second INSERT fail atomically.
--
-- Defensive: if the double-click bug already produced duplicate reversals on this
-- database, the UNIQUE index would fail to build — so we skip it (leaving the
-- application guard, which prevents NEW dupes) and emit a NOTICE listing the count
-- to clean up. Re-running after cleanup creates the index. Schema-only + idempotent.

BEGIN;

DO $$
DECLARE dup_groups int;
BEGIN
  SELECT count(*) INTO dup_groups FROM (
    SELECT reversal_of FROM finance_transactions
    WHERE reversal_of IS NOT NULL AND source = 'native'
    GROUP BY reversal_of HAVING count(*) > 1
  ) d;
  IF dup_groups > 0 THEN
    RAISE NOTICE 'finance_transactions: % entries already have multiple reversals — skipping UNIQUE(reversal_of) index. Clean up the duplicate Stornos then re-run migration 165. The application guard already prevents new duplicates.', dup_groups;
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS finance_transactions_reversal_of_uq
      ON finance_transactions (reversal_of)
      WHERE reversal_of IS NOT NULL AND source = 'native';
  END IF;
END $$;

COMMIT;
