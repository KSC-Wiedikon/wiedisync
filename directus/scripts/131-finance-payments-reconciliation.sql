-- Migration 131: extend finance_payments into the camt reconciliation ledger (L2/L3).
--
-- finance_payments (migration 114) already had invoice/payment_date/amount/method/
-- camt_reference/source/import_batch. Add the fields the camt.054 importer needs:
-- the bank's structured/unstructured reference, debtor, currency, a match status,
-- and a fuzzy "this might be ClubDesk invoice X" guess (never auto-applied).
-- Unique camt_reference makes re-importing the same file idempotent.
-- Schema-only + idempotent.

BEGIN;

ALTER TABLE finance_payments
  ADD COLUMN IF NOT EXISTS currency       varchar(8),
  ADD COLUMN IF NOT EXISTS reference      varchar(140),
  ADD COLUMN IF NOT EXISTS unstructured   text,
  ADD COLUMN IF NOT EXISTS debtor_name    varchar(255),
  ADD COLUMN IF NOT EXISTS match_status   varchar(16),
  ADD COLUMN IF NOT EXISTS clubdesk_guess integer REFERENCES finance_invoices(id) ON DELETE SET NULL;

COMMENT ON COLUMN finance_payments.match_status IS
  'How the camt credit was reconciled: native (matched a native invoice by SCOR/QRR ref → auto-confirmed) | clubdesk_guess (fuzzy candidate flagged, NOT applied) | unmatched.';

-- Dedup: one payment row per bank entry/transaction id → re-import is a no-op.
CREATE UNIQUE INDEX IF NOT EXISTS finance_payments_camt_reference_uidx
  ON finance_payments (camt_reference) WHERE camt_reference IS NOT NULL;
CREATE INDEX IF NOT EXISTS finance_payments_match_status_idx ON finance_payments (match_status);

-- ── Directus field metadata ────────────────────────────────────────────
INSERT INTO directus_fields (collection, field, interface, readonly, sort, width)
SELECT 'finance_payments', 'currency', 'input', true, 8, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection='finance_payments' AND field='currency');
INSERT INTO directus_fields (collection, field, interface, readonly, sort, width, note)
SELECT 'finance_payments', 'reference', 'input', true, 9, 'half', 'Structured reference (QRR/SCOR) from the camt entry.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection='finance_payments' AND field='reference');
INSERT INTO directus_fields (collection, field, interface, readonly, sort, width)
SELECT 'finance_payments', 'unstructured', 'input-multiline', true, 10, 'full'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection='finance_payments' AND field='unstructured');
INSERT INTO directus_fields (collection, field, interface, readonly, sort, width)
SELECT 'finance_payments', 'debtor_name', 'input', true, 11, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection='finance_payments' AND field='debtor_name');
INSERT INTO directus_fields (collection, field, interface, options, readonly, sort, width)
SELECT 'finance_payments', 'match_status', 'select-dropdown',
  '{"choices":[{"text":"Native (auto-confirmed)","value":"native"},{"text":"ClubDesk guess","value":"clubdesk_guess"},{"text":"Unmatched","value":"unmatched"}]}'::json,
  true, 12, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection='finance_payments' AND field='match_status');
INSERT INTO directus_fields (collection, field, special, interface, display, readonly, sort, width, note)
SELECT 'finance_payments', 'clubdesk_guess', 'm2o', 'select-dropdown-m2o', 'related-values', true, 13, 'half', 'Fuzzy ClubDesk-invoice candidate (flag only, not applied).'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection='finance_payments' AND field='clubdesk_guess');

INSERT INTO directus_relations (many_collection, many_field, one_collection, one_field, one_collection_field, one_allowed_collections, junction_field, sort_field, one_deselect_action)
SELECT 'finance_payments', 'clubdesk_guess', 'finance_invoices', NULL, NULL, NULL, NULL, NULL, 'nullify'
WHERE NOT EXISTS (SELECT 1 FROM directus_relations WHERE many_collection='finance_payments' AND many_field='clubdesk_guess');

COMMIT;
