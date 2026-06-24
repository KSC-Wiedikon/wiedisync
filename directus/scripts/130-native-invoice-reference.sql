-- Migration 130: Structured payment reference on native invoices (L1).
--
-- Native invoices get a machine-matchable reference carried on their QR-bill, so
-- a later camt.054 import can auto-reconcile them (and cross-check ClubDesk).
--   * reference_type: NON (legacy / no ref) | SCOR (ISO-11649 Creditor Reference,
--     works on the club's REGULAR IBAN — no bank change) | QRR (27-digit, needs a
--     QR-IBAN — generator stubbed until one exists).
--   * The reference VALUE reuses the existing `reference` column.
-- ClubDesk-mirror rows keep `reference_type` NULL (their `reference` is whatever
-- ClubDesk exported). Schema-only + idempotent.

BEGIN;

ALTER TABLE finance_invoices
  ADD COLUMN IF NOT EXISTS reference_type varchar(8);

COMMENT ON COLUMN finance_invoices.reference_type IS
  'Native invoices: payment-reference scheme on the QR-bill — NON | SCOR (ISO-11649, regular IBAN) | QRR (needs QR-IBAN). NULL for ClubDesk-mirror rows.';

INSERT INTO directus_fields (collection, field, interface, options, readonly, sort, width, note)
SELECT 'finance_invoices', 'reference_type', 'select-dropdown',
  '{"choices":[{"text":"None","value":"NON"},{"text":"SCOR (creditor reference)","value":"SCOR"},{"text":"QRR (QR-IBAN)","value":"QRR"}]}'::json,
  true, 37, 'half', 'Payment-reference scheme for native-invoice reconciliation.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_invoices' AND field = 'reference_type');

COMMIT;
