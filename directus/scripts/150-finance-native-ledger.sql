-- Migration 150: native double-entry ledger — the WRITE path on finance_transactions.
--
-- finance_transactions is already a two-leg double-entry table (debit_account /
-- credit_account / amount_chf), so a native journal entry is ONE balanced row with
-- source='native' — debit = credit by construction (single amount, one debit, one
-- credit). This adds: actor capture, a reversal link (corrections are reversal
-- entries, never edits of a closed entry), a native Beleg sequence, fiscal-year
-- close metadata, and an IMMUTABILITY trigger.
--
-- Immutability model (Swiss Miliz-friendly): native rows in a CLOSED fiscal year
-- cannot be updated or deleted — corrections must be posted as reversal entries.
-- Open-period native rows stay editable so the treasurer can fix mistakes before
-- the year-end close. ClubDesk-mirror rows are NOT touched by the trigger (the
-- nightly importer's delete+reinsert manages them).
--
-- Schema-only + idempotent.

BEGIN;

ALTER TABLE finance_transactions
  ADD COLUMN IF NOT EXISTS created_by_name  varchar(255),
  ADD COLUMN IF NOT EXISTS created_by_email varchar(255),
  ADD COLUMN IF NOT EXISTS reversal_of      integer REFERENCES finance_transactions(id) ON DELETE SET NULL;

CREATE SEQUENCE IF NOT EXISTS finance_native_entry_seq START 1;
CREATE INDEX IF NOT EXISTS finance_transactions_native_fy_idx ON finance_transactions (fiscal_year) WHERE source = 'native';

ALTER TABLE finance_fiscal_years
  ADD COLUMN IF NOT EXISTS closed_on       date,
  ADD COLUMN IF NOT EXISTS closed_by_name  varchar(255),
  ADD COLUMN IF NOT EXISTS closed_by_email varchar(255);

-- Lock native postings once their fiscal year is closed (reversal-only corrections).
CREATE OR REPLACE FUNCTION finance_native_txn_lock() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE fy_status text;
DECLARE r finance_transactions;
BEGIN
  r := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  IF r.source = 'native' THEN
    SELECT status INTO fy_status FROM finance_fiscal_years WHERE id = r.fiscal_year;
    IF fy_status = 'closed' THEN
      RAISE EXCEPTION 'Cannot modify a native ledger entry in a closed fiscal year — post a reversal entry instead';
    END IF;
  END IF;
  RETURN r;
END;
$$;

DROP TRIGGER IF EXISTS trg_finance_native_txn_lock ON finance_transactions;
CREATE TRIGGER trg_finance_native_txn_lock
  BEFORE UPDATE OR DELETE ON finance_transactions
  FOR EACH ROW EXECUTE FUNCTION finance_native_txn_lock();

COMMENT ON COLUMN finance_transactions.reversal_of IS 'For a native correction: the entry this one reverses (debit/credit swapped). NULL for normal postings.';

-- Directus field metadata for the new columns.
INSERT INTO directus_fields (collection, field, interface, readonly, sort, width)
SELECT 'finance_transactions', 'created_by_name', 'input', true, 80, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_transactions' AND field = 'created_by_name');
INSERT INTO directus_fields (collection, field, special, interface, display, readonly, sort, width)
SELECT 'finance_transactions', 'reversal_of', 'm2o', 'select-dropdown-m2o', 'related-values', true, 81, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_transactions' AND field = 'reversal_of');
INSERT INTO directus_fields (collection, field, interface, readonly, sort, width)
SELECT 'finance_fiscal_years', 'closed_on', 'datetime', true, 60, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_fiscal_years' AND field = 'closed_on');
INSERT INTO directus_relations (many_collection, many_field, one_collection, one_field, one_collection_field, one_allowed_collections, junction_field, sort_field, one_deselect_action)
SELECT 'finance_transactions', 'reversal_of', 'finance_transactions', NULL, NULL, NULL, NULL, NULL, 'nullify'
WHERE NOT EXISTS (SELECT 1 FROM directus_relations WHERE many_collection = 'finance_transactions' AND many_field = 'reversal_of');

COMMIT;
