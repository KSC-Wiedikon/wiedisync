-- Migration 411: bookkeeping in Wiedisync — the parallel books behind
-- accounting.wiedisync.kscw.ch (plan: .planning/bookkeeping-plan.md).
--
-- Owner decisions (14.10.2026): the books stay in ClubDesk Buchhaltung; Wiedisync
-- keeps a second, native set built from the same bank statements and documents,
-- run in parallel and compared monthly until the board decides to switch.
--
--   finance_bank_lines            one row per camt.053 statement entry. The bank is
--                                 the source of the cash postings: each line is
--                                 proposed an account (rule / matched invoice) and
--                                 posted as one native journal entry, or ignored.
--   finance_bank_rules            "this counterparty / text → that account".
--   finance_transaction_documents a receipt (Beleg) on a native journal entry, with
--                                 its SHA-256 so a later change to the file shows.
--   finance_parallel_signoffs     the monthly "native = ClubDesk" sign-off, with the
--                                 per-account comparison frozen at signing.
--   finance_archives              the yearly archive package (journal, accounts,
--                                 receipts, manifest) kept 10 years (Art. 958f OR).
--   finance_ledger_settings       + opening_account (Eröffnungsbilanz clearing) and
--                                 parallel_start_fy (first year of the parallel run).
--
-- These tables are used ONLY through the /kscw/finance/* endpoints (system
-- connection, finance-access.js gates, writeUserLog actor capture) — they are not
-- registered as Directus collections, so no policy can reach them via /items.
-- Matched invoices are kept by NUMBER, not id: the nightly ClubDesk import deletes
-- and re-inserts every mirror invoice, so an id link would break every night.
-- Schema-only + idempotent.

BEGIN;

-- Private folder for bank statements, receipts and yearly archives. Members can
-- never read it via /assets: every byte is streamed by /kscw/finance/* after the
-- finance-access.js read check.
INSERT INTO directus_folders (id, name)
VALUES ('f1a0d0c5-0000-4000-8000-000000000002', 'Finance books (private)')
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS finance_bank_lines (
  id serial PRIMARY KEY,
  -- Stable per statement entry: the bank's AcctSvcrRef, else statement id + entry
  -- position. Re-importing the same statement is a no-op on this key.
  bank_ref varchar(160) NOT NULL,
  statement_id varchar(140),
  account_iban varchar(34),
  booking_date date NOT NULL,
  value_date date,
  amount numeric(12,2) NOT NULL,          -- signed: + money in, − money out
  currency varchar(3) NOT NULL DEFAULT 'CHF',
  counterparty_name varchar(255),
  counterparty_iban varchar(34),
  reference varchar(64),                  -- QRR / SCOR creditor reference
  remittance text,                        -- unstructured message + additional info
  fiscal_year integer REFERENCES finance_fiscal_years(id) ON DELETE SET NULL,
  status varchar(16) NOT NULL DEFAULT 'open',
  proposed_account integer REFERENCES finance_accounts(id) ON DELETE SET NULL,
  proposed_text varchar(255),
  proposed_by varchar(48),                -- 'rule:<id>' | 'invoice:<number>' | NULL
  matched_invoice_number varchar(64),
  entry integer REFERENCES finance_transactions(id) ON DELETE SET NULL,
  note text,
  posted_by_name varchar(255),
  posted_by_email varchar(255),
  posted_at timestamptz,
  import_batch varchar(64),
  imported_by_name varchar(255),
  -- The uploaded camt.053 file this line came from — the Beleg of its posting.
  statement_file uuid REFERENCES directus_files(id) ON DELETE SET NULL,
  statement_sha256 char(64),
  date_created timestamptz NOT NULL DEFAULT now()
);
DO $$ BEGIN
  ALTER TABLE finance_bank_lines ADD CONSTRAINT finance_bank_lines_status_chk
    CHECK (status IN ('open', 'posted', 'ignored'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- A posted line names its entry; an open/ignored one names none.
DO $$ BEGIN
  ALTER TABLE finance_bank_lines ADD CONSTRAINT finance_bank_lines_posted_entry_chk
    CHECK ((status = 'posted') = (entry IS NOT NULL));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE UNIQUE INDEX IF NOT EXISTS finance_bank_lines_ref_uidx ON finance_bank_lines (bank_ref);
CREATE UNIQUE INDEX IF NOT EXISTS finance_bank_lines_entry_uidx ON finance_bank_lines (entry) WHERE entry IS NOT NULL;
CREATE INDEX IF NOT EXISTS finance_bank_lines_status_idx ON finance_bank_lines (status, booking_date);
CREATE INDEX IF NOT EXISTS finance_bank_lines_fy_idx ON finance_bank_lines (fiscal_year);

CREATE TABLE IF NOT EXISTS finance_bank_rules (
  id serial PRIMARY KEY,
  name varchar(120) NOT NULL,
  priority integer NOT NULL DEFAULT 100,  -- lower runs first
  direction varchar(3) NOT NULL DEFAULT 'any',
  match_iban varchar(34),
  match_name varchar(120),                -- case-insensitive substring of the counterparty
  match_text varchar(120),                -- case-insensitive substring of remittance / reference
  account integer NOT NULL REFERENCES finance_accounts(id) ON DELETE RESTRICT,
  text_template varchar(255),
  active boolean NOT NULL DEFAULT true,
  created_by_name varchar(255),
  date_created timestamptz NOT NULL DEFAULT now(),
  date_updated timestamptz
);
DO $$ BEGIN
  ALTER TABLE finance_bank_rules ADD CONSTRAINT finance_bank_rules_direction_chk
    CHECK (direction IN ('in', 'out', 'any'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- A rule that matches everything would post every unmatched line to one account.
DO $$ BEGIN
  ALTER TABLE finance_bank_rules ADD CONSTRAINT finance_bank_rules_has_condition_chk
    CHECK (coalesce(match_iban, '') <> '' OR coalesce(match_name, '') <> '' OR coalesce(match_text, '') <> '');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS finance_transaction_documents (
  id serial PRIMARY KEY,
  entry integer NOT NULL REFERENCES finance_transactions(id) ON DELETE CASCADE,
  file uuid NOT NULL REFERENCES directus_files(id) ON DELETE RESTRICT,
  sha256 char(64) NOT NULL,
  kind varchar(16) NOT NULL DEFAULT 'receipt',
  note varchar(255),
  uploaded_by_name varchar(255),
  uploaded_by_email varchar(255),
  date_created timestamptz NOT NULL DEFAULT now()
);
DO $$ BEGIN
  ALTER TABLE finance_transaction_documents ADD CONSTRAINT finance_transaction_documents_kind_chk
    CHECK (kind IN ('receipt', 'invoice', 'statement', 'contract', 'other'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE UNIQUE INDEX IF NOT EXISTS finance_transaction_documents_entry_file_uidx
  ON finance_transaction_documents (entry, file);

CREATE TABLE IF NOT EXISTS finance_parallel_signoffs (
  id serial PRIMARY KEY,
  fiscal_year integer NOT NULL REFERENCES finance_fiscal_years(id) ON DELETE CASCADE,
  month date NOT NULL,                    -- first day of the month signed off
  difference_total numeric(12,2) NOT NULL,
  accounts_compared integer NOT NULL,
  accounts_different integer NOT NULL,
  snapshot jsonb NOT NULL,
  note text,
  signed_by_name varchar(255),
  signed_by_email varchar(255),
  signed_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS finance_parallel_signoffs_month_uidx
  ON finance_parallel_signoffs (fiscal_year, month);

CREATE TABLE IF NOT EXISTS finance_archives (
  id serial PRIMARY KEY,
  fiscal_year integer NOT NULL REFERENCES finance_fiscal_years(id) ON DELETE RESTRICT,
  file uuid REFERENCES directus_files(id) ON DELETE RESTRICT,
  sha256 char(64) NOT NULL,
  size_bytes bigint NOT NULL,
  contents jsonb NOT NULL,                -- what the package holds (counts per part)
  offsite jsonb,                          -- per-target result, written by the host copy job
  offsite_at timestamptz,
  created_by_name varchar(255),
  created_by_email varchar(255),
  date_created timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS finance_archives_fy_idx ON finance_archives (fiscal_year);

ALTER TABLE finance_ledger_settings
  ADD COLUMN IF NOT EXISTS opening_account integer REFERENCES finance_accounts(id) ON DELETE SET NULL;
ALTER TABLE finance_ledger_settings
  ADD COLUMN IF NOT EXISTS parallel_start_fy integer REFERENCES finance_fiscal_years(id) ON DELETE SET NULL;

COMMIT;
