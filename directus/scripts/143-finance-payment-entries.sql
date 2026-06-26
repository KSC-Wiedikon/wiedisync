-- Migration 143: payment ENTRY TYPES — partial payments, cash, credit notes,
-- refunds, write-offs.
--
-- finance_payments becomes the single settlement ledger for a NATIVE invoice: a
-- shared recompute (finance-recompute.js) re-derives amount_paid / open_amount /
-- overpaid_amount / written_off_amount / status from the SUM of its entries,
-- replacing the all-or-nothing UPDATE in /confirm and the camt applyNative.
--
--   entry_type: payment (cash/twint/bank/camt — money in) | credit_note (reduces
--   what's owed, non-cash) | writeoff (uncollectable) | refund (money returned).
-- Existing camt rows have NULL entry_type → treated as 'payment' (DEFAULT).
-- finance_invoices.status gains the free-text value 'partial' (no DDL — varchar).
--
-- Schema-only + idempotent.

BEGIN;

ALTER TABLE finance_payments
  ADD COLUMN IF NOT EXISTS entry_type       varchar(16) NOT NULL DEFAULT 'payment',
  ADD COLUMN IF NOT EXISTS note             varchar(255),
  ADD COLUMN IF NOT EXISTS created_by_name  varchar(255),
  ADD COLUMN IF NOT EXISTS created_by_email varchar(255),
  ADD COLUMN IF NOT EXISTS payout           integer REFERENCES finance_payouts(id) ON DELETE SET NULL;

DO $$ BEGIN
  ALTER TABLE finance_payments
    ADD CONSTRAINT finance_payments_entry_type_check
    CHECK (entry_type IN ('payment', 'credit_note', 'refund', 'writeoff'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS finance_payments_invoice_idx ON finance_payments (invoice);

COMMENT ON COLUMN finance_payments.entry_type IS
  'payment (money in: cash/twint/bank/camt) | credit_note (non-cash reduction) | writeoff (uncollectable) | refund (money returned). NULL legacy rows = payment.';

INSERT INTO directus_fields (collection, field, interface, options, sort, width, note)
SELECT 'finance_payments', 'entry_type', 'select-dropdown',
  '{"choices":[{"text":"Payment","value":"payment"},{"text":"Credit note","value":"credit_note"},{"text":"Refund","value":"refund"},{"text":"Write-off","value":"writeoff"}]}'::json,
  20, 'half', 'Kind of ledger entry.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_payments' AND field = 'entry_type');
INSERT INTO directus_fields (collection, field, interface, sort, width)
SELECT 'finance_payments', 'note', 'input', 21, 'full'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_payments' AND field = 'note');
INSERT INTO directus_fields (collection, field, interface, readonly, sort, width)
SELECT 'finance_payments', 'created_by_name', 'input', true, 22, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_payments' AND field = 'created_by_name');
INSERT INTO directus_fields (collection, field, special, interface, display, readonly, sort, width)
SELECT 'finance_payments', 'payout', 'm2o', 'select-dropdown-m2o', 'related-values', true, 23, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_payments' AND field = 'payout');

INSERT INTO directus_relations (many_collection, many_field, one_collection, one_field, one_collection_field, one_allowed_collections, junction_field, sort_field, one_deselect_action)
SELECT 'finance_payments', 'payout', 'finance_payouts', NULL, NULL, NULL, NULL, NULL, 'nullify'
WHERE NOT EXISTS (SELECT 1 FROM directus_relations WHERE many_collection = 'finance_payments' AND many_field = 'payout');

COMMIT;
