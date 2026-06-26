-- Migration 152: make the native ledger SELF-FUNCTIONING — auto-posting config +
-- idempotency keys so each A/R event (invoice issued, payment, credit note, refund,
-- write-off, per-team entry) posts exactly one native journal entry.
--
-- finance_ledger_settings: a singleton (id=1) mapping the control accounts the
-- auto-poster uses (Debitoren / Bank / default income / sponsoring income / bad-debt
-- expense / default expense) + an autopost_enabled master switch.
--
-- finance_transactions.ref_kind/ref_id/auto: link an auto-posted journal entry back
-- to the A/R event that created it; a partial unique index enforces "one posting per
-- event" so reconcile is idempotent and re-runnable.
--
-- Schema-only + idempotent.

BEGIN;

CREATE TABLE IF NOT EXISTS finance_ledger_settings (
  id                  integer PRIMARY KEY DEFAULT 1,
  autopost_enabled    boolean NOT NULL DEFAULT false,
  debitoren_account   integer REFERENCES finance_accounts(id) ON DELETE SET NULL,
  bank_account        integer REFERENCES finance_accounts(id) ON DELETE SET NULL,
  income_account      integer REFERENCES finance_accounts(id) ON DELETE SET NULL,
  sponsoring_account  integer REFERENCES finance_accounts(id) ON DELETE SET NULL,
  bad_debt_account    integer REFERENCES finance_accounts(id) ON DELETE SET NULL,
  expense_account     integer REFERENCES finance_accounts(id) ON DELETE SET NULL,
  date_updated        timestamp with time zone DEFAULT now() NOT NULL,
  updated_by_name     varchar(255),
  CONSTRAINT finance_ledger_settings_singleton CHECK (id = 1)
);
INSERT INTO finance_ledger_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

ALTER TABLE finance_transactions
  ADD COLUMN IF NOT EXISTS ref_kind varchar(24),
  ADD COLUMN IF NOT EXISTS ref_id   integer,
  ADD COLUMN IF NOT EXISTS auto     boolean NOT NULL DEFAULT false;

-- One auto-posted journal entry per (event-kind, event-id) on the native book.
CREATE UNIQUE INDEX IF NOT EXISTS finance_tx_autopost_uidx
  ON finance_transactions (ref_kind, ref_id)
  WHERE auto = true AND source = 'native';

COMMENT ON COLUMN finance_transactions.ref_kind IS 'Auto-post link: issue|settle|team (the A/R event that produced this journal entry).';
COMMENT ON COLUMN finance_transactions.ref_id IS 'Auto-post link: the finance_invoices.id (issue), finance_payments.id (settle), or finance_team_entries.id (team).';

-- Directus metadata for the new collection + columns.
INSERT INTO directus_collections (collection, icon, note, hidden, sort)
SELECT 'finance_ledger_settings', 'tune', 'Native ledger auto-posting config (singleton)', false, 60
WHERE NOT EXISTS (SELECT 1 FROM directus_collections WHERE collection = 'finance_ledger_settings');

INSERT INTO directus_fields (collection, field, interface, readonly, sort, width)
SELECT 'finance_transactions', 'ref_kind', 'input', true, 90, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_transactions' AND field = 'ref_kind');
INSERT INTO directus_fields (collection, field, interface, readonly, sort, width)
SELECT 'finance_transactions', 'auto', 'boolean', true, 92, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_transactions' AND field = 'auto');

COMMIT;
