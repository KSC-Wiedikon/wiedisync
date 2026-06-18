-- Migration 115: finance_transactions.amount_chf — drop NOT NULL.
--
-- Fix-forward on 114. ClubDesk's Buchhaltung export includes collective-invoice
-- HEADER rows (Typ = 'Rechnung (Sammel)') that carry no amount — the amounts
-- live on the child 'Rechnung (Sammelposition)' rows. A faithful ledger mirror
-- must store those header rows too, so amount_chf is nullable. Dashboard sums
-- already ignore NULL amounts. Idempotent (DROP NOT NULL is a no-op if already
-- nullable).

BEGIN;

ALTER TABLE finance_transactions ALTER COLUMN amount_chf DROP NOT NULL;

COMMENT ON COLUMN finance_transactions.amount_chf IS
  'Amount in CHF (nullable). ClubDesk exports Swiss-formatted (1''234.56) — the importer strips the apostrophe. NULL on collective-invoice header rows (Typ ''Rechnung (Sammel)''), which carry no amount; the postings are on the Sammelposition child rows.';

COMMIT;
