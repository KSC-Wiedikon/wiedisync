-- Migration 153: prepayment/creditors account for auto-posting overpayments.
-- When a payment exceeds the open receivable, the excess is "received in advance"
-- (a liability), not negative A/R. The auto-poster clamps the Debitoren leg to the
-- open balance and routes the excess to this account. Optional — if unset, the
-- overpayment stays on Debitoren (a credit balance) as before.
--
-- Schema-only + idempotent.

BEGIN;

ALTER TABLE finance_ledger_settings
  ADD COLUMN IF NOT EXISTS prepayment_account integer REFERENCES finance_accounts(id) ON DELETE SET NULL;

COMMIT;
