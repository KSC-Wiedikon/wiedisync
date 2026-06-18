-- Migration 114: Finance module schema (Scope A mirror, built for Scope C).
--
-- Read-only mirror of ClubDesk Finanz today; the SAME tables become the native
-- finance store under Scope C (just add write paths). Every row carries a
-- `source` discriminator ('clubdesk' | 'native') and an `import_batch` FK so
-- mirrored and native rows can coexist during a future cutover — no rebuild.
--
-- Data shape comes from real ClubDesk "Alle Spalten" CSV exports (2026-06-18):
--   - Rechnungen export  -> finance_invoices (invoice fields + member link only;
--                           AHV/IBAN/address deliberately NOT mirrored — a dues
--                           view doesn't need that PII).
--   - Buchhaltung export -> finance_transactions (clean double-entry: Soll/Haben
--                           account number+name + Betrag CHF) -> finance_accounts
--                           (Kontenplan, 46 accounts) derived from distinct
--                           Soll/Haben pairs.
-- Club fiscal year runs June–May (opening balance dated 01.06).
--
-- Ingestion (Phase 2) reuses the existing ClubDesk scraper pattern
-- (clubdesk-scrape-export.mjs / import-clubdesk-csv.mjs), parsing the CSV in JS
-- (CP1252, ';'-delimited, Swiss 1'234.56 amounts, dd.mm.yyyy dates) and
-- upserting into these tables keyed on the ClubDesk `[Id]`.
--
-- Permissions live ONLY in setup-permissions.mjs (per CLAUDE.md hard rule).
-- This migration is schema-only + idempotent. Tables are created in FK order:
-- finance_imports -> finance_fiscal_years -> finance_accounts ->
-- finance_budget_lines -> finance_transactions -> finance_invoices ->
-- finance_payments.

BEGIN;

-- ── finance_imports (provenance / audit; created first — others FK to it) ──
CREATE TABLE IF NOT EXISTS finance_imports (
  id                serial PRIMARY KEY,
  import_type       varchar(32) NOT NULL,
  filename          varchar(255),
  imported_at       timestamptz NOT NULL DEFAULT now(),
  imported_by_name  varchar(255),
  imported_by_email varchar(255),
  row_count         integer,
  fiscal_year_label varchar(16),
  source_checksum   varchar(64),
  notes             text,
  date_created      timestamptz NOT NULL DEFAULT now(),
  user_created      uuid,
  CONSTRAINT finance_imports_type_check CHECK (
    import_type IN ('invoices','bookings','accounts','budget','payments')
  )
);
CREATE INDEX IF NOT EXISTS finance_imports_type_at_idx ON finance_imports (import_type, imported_at DESC);
COMMENT ON TABLE finance_imports IS
  'One row per ClubDesk finance sync/import. Records WHO (imported_by_*), WHAT (import_type), and how many rows — the finance equivalent of the audit-log actor capture for the raw-knex import path.';

-- ── finance_fiscal_years ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS finance_fiscal_years (
  id            serial PRIMARY KEY,
  label         varchar(16) NOT NULL,
  starts_on     date NOT NULL,
  ends_on       date NOT NULL,
  status        varchar(16) NOT NULL DEFAULT 'open',
  source        varchar(16) NOT NULL DEFAULT 'clubdesk',
  date_created  timestamptz NOT NULL DEFAULT now(),
  date_updated  timestamptz NOT NULL DEFAULT now(),
  user_created  uuid,
  user_updated  uuid,
  CONSTRAINT finance_fiscal_years_label_unique UNIQUE (label),
  CONSTRAINT finance_fiscal_years_status_check CHECK (status IN ('open','closed')),
  CONSTRAINT finance_fiscal_years_source_check CHECK (source IN ('clubdesk','native'))
);
COMMENT ON TABLE finance_fiscal_years IS
  'Accounting periods. KSCW fiscal year runs June–May (e.g. 2025/26 = 01.06.2025–31.05.2026). Anchors budgets + reporting.';

-- ── finance_accounts (Kontenplan / chart of accounts) ─────────────────
CREATE TABLE IF NOT EXISTS finance_accounts (
  id            serial PRIMARY KEY,
  number        varchar(16) NOT NULL,
  name          varchar(128) NOT NULL,
  type          varchar(16),
  division      varchar(8),
  active        boolean NOT NULL DEFAULT true,
  source        varchar(16) NOT NULL DEFAULT 'clubdesk',
  date_created  timestamptz NOT NULL DEFAULT now(),
  date_updated  timestamptz NOT NULL DEFAULT now(),
  user_created  uuid,
  user_updated  uuid,
  CONSTRAINT finance_accounts_number_unique UNIQUE (number),
  CONSTRAINT finance_accounts_type_check CHECK (
    type IS NULL OR type IN ('asset','liability','equity','income','expense','close')
  ),
  CONSTRAINT finance_accounts_division_check CHECK (
    division IS NULL OR division IN ('club','vb','bb')
  ),
  CONSTRAINT finance_accounts_source_check CHECK (source IN ('clubdesk','native'))
);
COMMENT ON TABLE finance_accounts IS
  'Chart of accounts (Kontenplan), derived from distinct Soll/Haben accounts in the ClubDesk bookings export. type inferred from number range (1xxx asset, 2xxx liability/equity, 3xxx income, 4xxx expense, 9xxx close); division (vb/bb/club) inferred from the account name.';

-- ── finance_budget_lines ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS finance_budget_lines (
  id               serial PRIMARY KEY,
  fiscal_year      integer NOT NULL REFERENCES finance_fiscal_years(id) ON DELETE CASCADE,
  account          integer NOT NULL REFERENCES finance_accounts(id) ON DELETE CASCADE,
  amount_budgeted  numeric(12,2) NOT NULL DEFAULT 0,
  notes            text,
  source           varchar(16) NOT NULL DEFAULT 'clubdesk',
  date_created     timestamptz NOT NULL DEFAULT now(),
  date_updated     timestamptz NOT NULL DEFAULT now(),
  user_created     uuid,
  user_updated     uuid,
  CONSTRAINT finance_budget_lines_fy_account_unique UNIQUE (fiscal_year, account),
  CONSTRAINT finance_budget_lines_source_check CHECK (source IN ('clubdesk','native'))
);
CREATE INDEX IF NOT EXISTS finance_budget_lines_fy_idx ON finance_budget_lines (fiscal_year);
COMMENT ON TABLE finance_budget_lines IS
  'Budgeted amount per (fiscal_year, account) for budget-vs-actual. Populated once a ClubDesk budget export is captured; until then the dashboard shows actuals only.';

-- ── finance_transactions (the double-entry ledger) ────────────────────
CREATE TABLE IF NOT EXISTS finance_transactions (
  id                     serial PRIMARY KEY,
  clubdesk_id            varchar(32),
  typ                    varchar(48),
  beleg                  varchar(64),
  booking_date           date NOT NULL,
  text                   text,
  debit_account_number   varchar(16),
  debit_account_name     varchar(128),
  credit_account_number  varchar(16),
  credit_account_name    varchar(128),
  debit_account          integer REFERENCES finance_accounts(id) ON DELETE SET NULL,
  credit_account         integer REFERENCES finance_accounts(id) ON DELETE SET NULL,
  amount_chf             numeric(12,2) NOT NULL,
  fiscal_year            integer REFERENCES finance_fiscal_years(id) ON DELETE SET NULL,
  source                 varchar(16) NOT NULL DEFAULT 'clubdesk',
  import_batch           integer REFERENCES finance_imports(id) ON DELETE SET NULL,
  date_created           timestamptz NOT NULL DEFAULT now(),
  date_updated           timestamptz NOT NULL DEFAULT now(),
  user_created           uuid,
  user_updated           uuid,
  CONSTRAINT finance_transactions_source_check CHECK (source IN ('clubdesk','native'))
);
-- Upsert key: ClubDesk booking ID when present (Eröffnung/Abschluss rows have none).
CREATE UNIQUE INDEX IF NOT EXISTS finance_transactions_clubdesk_id_uidx
  ON finance_transactions (clubdesk_id) WHERE clubdesk_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS finance_transactions_date_idx ON finance_transactions (booking_date);
CREATE INDEX IF NOT EXISTS finance_transactions_debit_idx ON finance_transactions (debit_account);
CREATE INDEX IF NOT EXISTS finance_transactions_credit_idx ON finance_transactions (credit_account);
CREATE INDEX IF NOT EXISTS finance_transactions_fy_idx ON finance_transactions (fiscal_year);
COMMENT ON TABLE finance_transactions IS
  'Double-entry ledger mirrored from the ClubDesk Buchhaltung export. debit_/credit_account_number+name are the raw Soll/Haben values; debit_account/credit_account are the resolved finance_accounts FKs. typ ∈ Eröffnung/Abschluss/Rechnung/Rechnung (Sammel)/Rechnung (Sammelposition)/Standard (free text — ClubDesk may add more).';
COMMENT ON COLUMN finance_transactions.amount_chf IS
  'Amount in CHF. ClubDesk exports Swiss-formatted (1''234.56, apostrophe thousands sep) — the importer strips the apostrophe before insert.';

-- ── finance_invoices (member dues) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS finance_invoices (
  id                   serial PRIMARY KEY,
  clubdesk_id          varchar(32) NOT NULL,
  number               varchar(32),
  invoice_date         date,
  subject              varchar(255),
  amount               numeric(12,2),
  status               varchar(32),
  dunning_status       varchar(32),
  due_date             date,
  amount_paid          numeric(12,2),
  open_amount          numeric(12,2),
  overpaid_amount      numeric(12,2),
  written_off_amount   numeric(12,2),
  payment_method       varchar(64),
  reference            varchar(64),
  fee_category         varchar(64),
  closed_on            date,
  cd_created_at        timestamptz,
  cd_changed_at        timestamptz,
  recipient_name       varchar(255),
  recipient_email      varchar(255),
  cd_benutzer_id       varchar(64),
  member               integer REFERENCES members(id) ON DELETE SET NULL,
  fiscal_year          integer REFERENCES finance_fiscal_years(id) ON DELETE SET NULL,
  source               varchar(16) NOT NULL DEFAULT 'clubdesk',
  import_batch         integer REFERENCES finance_imports(id) ON DELETE SET NULL,
  date_created         timestamptz NOT NULL DEFAULT now(),
  date_updated         timestamptz NOT NULL DEFAULT now(),
  user_created         uuid,
  user_updated         uuid,
  CONSTRAINT finance_invoices_clubdesk_id_unique UNIQUE (clubdesk_id),
  CONSTRAINT finance_invoices_source_check CHECK (source IN ('clubdesk','native'))
);
CREATE INDEX IF NOT EXISTS finance_invoices_member_status_idx ON finance_invoices (member, status);
CREATE INDEX IF NOT EXISTS finance_invoices_status_idx ON finance_invoices (status);
CREATE INDEX IF NOT EXISTS finance_invoices_due_idx ON finance_invoices (due_date);
COMMENT ON TABLE finance_invoices IS
  'Member invoices/dues mirrored from the ClubDesk Rechnungen export. Invoice fields + a member link ONLY — AHV/IBAN/home address present in the source CSV are deliberately NOT mirrored (keep the finance module low-PII). number is NULL for draft (Entwurf) invoices; clubdesk_id ([Id]) is the stable upsert key. member matched on recipient_email, fallback cd_benutzer_id.';

-- ── finance_payments (Scope C — camt reconciliation; empty in A) ──────
CREATE TABLE IF NOT EXISTS finance_payments (
  id             serial PRIMARY KEY,
  invoice        integer REFERENCES finance_invoices(id) ON DELETE CASCADE,
  payment_date   date,
  amount         numeric(12,2),
  method         varchar(64),
  camt_reference varchar(128),
  source         varchar(16) NOT NULL DEFAULT 'native',
  import_batch   integer REFERENCES finance_imports(id) ON DELETE SET NULL,
  date_created   timestamptz NOT NULL DEFAULT now(),
  date_updated   timestamptz NOT NULL DEFAULT now(),
  user_created   uuid,
  user_updated   uuid,
  CONSTRAINT finance_payments_source_check CHECK (source IN ('clubdesk','native'))
);
CREATE INDEX IF NOT EXISTS finance_payments_invoice_idx ON finance_payments (invoice);
COMMENT ON TABLE finance_payments IS
  'Individual payments against invoices. Created now for Scope C (camt.053/054 reconciliation); stays empty under Scope A, where paid/open amounts are read directly off finance_invoices.';

-- ══ Directus admin metadata ═══════════════════════════════════════════
-- Surface the finance collections in /admin so Vorstand/treasurer can inspect
-- rows without SQL. Per CLAUDE.md, new columns are registered in directus_fields
-- so the items API + dashboard read them; FKs go in directus_relations so they
-- expand. All idempotent (INSERT … WHERE NOT EXISTS).

-- ── collections ───────────────────────────────────────────────────────
INSERT INTO directus_collections (collection, icon, color, "group", sort, archive_field, archive_value, unarchive_value, archive_app_filter)
SELECT 'finance_imports', 'cloud_download', '#059669', NULL, NULL, NULL, NULL, NULL, true
WHERE NOT EXISTS (SELECT 1 FROM directus_collections WHERE collection = 'finance_imports');

INSERT INTO directus_collections (collection, icon, color, "group", sort, archive_field, archive_value, unarchive_value, archive_app_filter)
SELECT 'finance_fiscal_years', 'calendar_month', '#059669', NULL, NULL, NULL, NULL, NULL, true
WHERE NOT EXISTS (SELECT 1 FROM directus_collections WHERE collection = 'finance_fiscal_years');

INSERT INTO directus_collections (collection, icon, color, "group", sort, archive_field, archive_value, unarchive_value, archive_app_filter)
SELECT 'finance_accounts', 'account_tree', '#059669', NULL, NULL, NULL, NULL, NULL, true
WHERE NOT EXISTS (SELECT 1 FROM directus_collections WHERE collection = 'finance_accounts');

INSERT INTO directus_collections (collection, icon, color, "group", sort, archive_field, archive_value, unarchive_value, archive_app_filter)
SELECT 'finance_budget_lines', 'request_quote', '#059669', NULL, NULL, NULL, NULL, NULL, true
WHERE NOT EXISTS (SELECT 1 FROM directus_collections WHERE collection = 'finance_budget_lines');

INSERT INTO directus_collections (collection, icon, color, "group", sort, archive_field, archive_value, unarchive_value, archive_app_filter)
SELECT 'finance_transactions', 'receipt_long', '#059669', NULL, NULL, NULL, NULL, NULL, true
WHERE NOT EXISTS (SELECT 1 FROM directus_collections WHERE collection = 'finance_transactions');

INSERT INTO directus_collections (collection, icon, color, "group", sort, archive_field, archive_value, unarchive_value, archive_app_filter)
SELECT 'finance_invoices', 'receipt', '#059669', NULL, NULL, NULL, NULL, NULL, true
WHERE NOT EXISTS (SELECT 1 FROM directus_collections WHERE collection = 'finance_invoices');

INSERT INTO directus_collections (collection, icon, color, "group", sort, archive_field, archive_value, unarchive_value, archive_app_filter)
SELECT 'finance_payments', 'payments', '#059669', NULL, NULL, NULL, NULL, NULL, true
WHERE NOT EXISTS (SELECT 1 FROM directus_collections WHERE collection = 'finance_payments');

-- ── finance_imports fields ─────────────────────────────────────────────
INSERT INTO directus_fields (collection, field, special, interface, options, sort, width, note)
SELECT 'finance_imports', 'import_type', NULL, 'select-dropdown',
  '{"choices":[{"text":"Invoices","value":"invoices"},{"text":"Bookings","value":"bookings"},{"text":"Accounts","value":"accounts"},{"text":"Budget","value":"budget"},{"text":"Payments","value":"payments"}]}'::json,
  1, 'half', 'Which finance table this import populated.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_imports' AND field = 'import_type');
INSERT INTO directus_fields (collection, field, interface, sort, width)
SELECT 'finance_imports', 'filename', 'input', 2, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_imports' AND field = 'filename');
INSERT INTO directus_fields (collection, field, interface, sort, width)
SELECT 'finance_imports', 'imported_at', 'datetime', 3, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_imports' AND field = 'imported_at');
INSERT INTO directus_fields (collection, field, interface, sort, width, note)
SELECT 'finance_imports', 'imported_by_name', 'input', 4, 'half', 'Actor who ran the import.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_imports' AND field = 'imported_by_name');
INSERT INTO directus_fields (collection, field, interface, sort, width)
SELECT 'finance_imports', 'imported_by_email', 'input', 5, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_imports' AND field = 'imported_by_email');
INSERT INTO directus_fields (collection, field, interface, sort, width)
SELECT 'finance_imports', 'row_count', 'input', 6, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_imports' AND field = 'row_count');
INSERT INTO directus_fields (collection, field, interface, sort, width)
SELECT 'finance_imports', 'fiscal_year_label', 'input', 7, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_imports' AND field = 'fiscal_year_label');
INSERT INTO directus_fields (collection, field, interface, sort, width)
SELECT 'finance_imports', 'source_checksum', 'input', 8, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_imports' AND field = 'source_checksum');
INSERT INTO directus_fields (collection, field, interface, sort, width)
SELECT 'finance_imports', 'notes', 'input-multiline', 9, 'full'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_imports' AND field = 'notes');
INSERT INTO directus_fields (collection, field, special, interface, readonly, hidden, sort)
SELECT 'finance_imports', 'date_created', 'date-created', 'datetime', true, true, 90
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_imports' AND field = 'date_created');
INSERT INTO directus_fields (collection, field, special, interface, readonly, hidden, sort)
SELECT 'finance_imports', 'user_created', 'user-created', 'select-dropdown-m2o', true, true, 92
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_imports' AND field = 'user_created');

-- ── finance_fiscal_years fields ────────────────────────────────────────
INSERT INTO directus_fields (collection, field, interface, sort, width, note)
SELECT 'finance_fiscal_years', 'label', 'input', 1, 'half', 'e.g. 2025/26.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_fiscal_years' AND field = 'label');
INSERT INTO directus_fields (collection, field, interface, sort, width)
SELECT 'finance_fiscal_years', 'starts_on', 'datetime', 2, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_fiscal_years' AND field = 'starts_on');
INSERT INTO directus_fields (collection, field, interface, sort, width)
SELECT 'finance_fiscal_years', 'ends_on', 'datetime', 3, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_fiscal_years' AND field = 'ends_on');
INSERT INTO directus_fields (collection, field, interface, options, sort, width)
SELECT 'finance_fiscal_years', 'status', 'select-dropdown',
  '{"choices":[{"text":"Open","value":"open"},{"text":"Closed","value":"closed"}]}'::json, 4, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_fiscal_years' AND field = 'status');
INSERT INTO directus_fields (collection, field, interface, options, sort, width, note)
SELECT 'finance_fiscal_years', 'source', 'select-dropdown',
  '{"choices":[{"text":"ClubDesk","value":"clubdesk"},{"text":"Native","value":"native"}]}'::json, 5, 'half',
  'clubdesk = mirrored from ClubDesk; native = created in wiedisync (Scope C).'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_fiscal_years' AND field = 'source');
INSERT INTO directus_fields (collection, field, special, interface, readonly, hidden, sort)
SELECT 'finance_fiscal_years', 'date_created', 'date-created', 'datetime', true, true, 90
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_fiscal_years' AND field = 'date_created');
INSERT INTO directus_fields (collection, field, special, interface, readonly, hidden, sort)
SELECT 'finance_fiscal_years', 'date_updated', 'date-updated', 'datetime', true, true, 91
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_fiscal_years' AND field = 'date_updated');
INSERT INTO directus_fields (collection, field, special, interface, readonly, hidden, sort)
SELECT 'finance_fiscal_years', 'user_created', 'user-created', 'select-dropdown-m2o', true, true, 92
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_fiscal_years' AND field = 'user_created');
INSERT INTO directus_fields (collection, field, special, interface, readonly, hidden, sort)
SELECT 'finance_fiscal_years', 'user_updated', 'user-updated', 'select-dropdown-m2o', true, true, 93
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_fiscal_years' AND field = 'user_updated');

-- ── finance_accounts fields ────────────────────────────────────────────
INSERT INTO directus_fields (collection, field, interface, sort, width, note)
SELECT 'finance_accounts', 'number', 'input', 1, 'half', 'Account number (e.g. 1000).'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_accounts' AND field = 'number');
INSERT INTO directus_fields (collection, field, interface, sort, width)
SELECT 'finance_accounts', 'name', 'input', 2, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_accounts' AND field = 'name');
INSERT INTO directus_fields (collection, field, interface, options, sort, width)
SELECT 'finance_accounts', 'type', 'select-dropdown',
  '{"choices":[{"text":"Asset","value":"asset"},{"text":"Liability","value":"liability"},{"text":"Equity","value":"equity"},{"text":"Income","value":"income"},{"text":"Expense","value":"expense"},{"text":"Close","value":"close"}]}'::json,
  3, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_accounts' AND field = 'type');
INSERT INTO directus_fields (collection, field, interface, options, sort, width)
SELECT 'finance_accounts', 'division', 'select-dropdown',
  '{"choices":[{"text":"Club","value":"club"},{"text":"Volleyball","value":"vb"},{"text":"Basketball","value":"bb"}]}'::json,
  4, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_accounts' AND field = 'division');
INSERT INTO directus_fields (collection, field, special, interface, sort, width)
SELECT 'finance_accounts', 'active', 'cast-boolean', 'boolean', 5, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_accounts' AND field = 'active');
INSERT INTO directus_fields (collection, field, interface, options, sort, width)
SELECT 'finance_accounts', 'source', 'select-dropdown',
  '{"choices":[{"text":"ClubDesk","value":"clubdesk"},{"text":"Native","value":"native"}]}'::json, 6, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_accounts' AND field = 'source');
INSERT INTO directus_fields (collection, field, special, interface, readonly, hidden, sort)
SELECT 'finance_accounts', 'date_created', 'date-created', 'datetime', true, true, 90
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_accounts' AND field = 'date_created');
INSERT INTO directus_fields (collection, field, special, interface, readonly, hidden, sort)
SELECT 'finance_accounts', 'date_updated', 'date-updated', 'datetime', true, true, 91
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_accounts' AND field = 'date_updated');
INSERT INTO directus_fields (collection, field, special, interface, readonly, hidden, sort)
SELECT 'finance_accounts', 'user_created', 'user-created', 'select-dropdown-m2o', true, true, 92
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_accounts' AND field = 'user_created');
INSERT INTO directus_fields (collection, field, special, interface, readonly, hidden, sort)
SELECT 'finance_accounts', 'user_updated', 'user-updated', 'select-dropdown-m2o', true, true, 93
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_accounts' AND field = 'user_updated');

-- ── finance_budget_lines fields ────────────────────────────────────────
INSERT INTO directus_fields (collection, field, special, interface, display, sort, width, note)
SELECT 'finance_budget_lines', 'fiscal_year', 'm2o', 'select-dropdown-m2o', 'related-values', 1, 'half', 'Budget period.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_budget_lines' AND field = 'fiscal_year');
INSERT INTO directus_fields (collection, field, special, interface, display, sort, width)
SELECT 'finance_budget_lines', 'account', 'm2o', 'select-dropdown-m2o', 'related-values', 2, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_budget_lines' AND field = 'account');
INSERT INTO directus_fields (collection, field, interface, sort, width)
SELECT 'finance_budget_lines', 'amount_budgeted', 'input', 3, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_budget_lines' AND field = 'amount_budgeted');
INSERT INTO directus_fields (collection, field, interface, sort, width)
SELECT 'finance_budget_lines', 'notes', 'input-multiline', 4, 'full'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_budget_lines' AND field = 'notes');
INSERT INTO directus_fields (collection, field, interface, options, sort, width)
SELECT 'finance_budget_lines', 'source', 'select-dropdown',
  '{"choices":[{"text":"ClubDesk","value":"clubdesk"},{"text":"Native","value":"native"}]}'::json, 5, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_budget_lines' AND field = 'source');
INSERT INTO directus_fields (collection, field, special, interface, readonly, hidden, sort)
SELECT 'finance_budget_lines', 'date_created', 'date-created', 'datetime', true, true, 90
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_budget_lines' AND field = 'date_created');
INSERT INTO directus_fields (collection, field, special, interface, readonly, hidden, sort)
SELECT 'finance_budget_lines', 'date_updated', 'date-updated', 'datetime', true, true, 91
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_budget_lines' AND field = 'date_updated');
INSERT INTO directus_fields (collection, field, special, interface, readonly, hidden, sort)
SELECT 'finance_budget_lines', 'user_created', 'user-created', 'select-dropdown-m2o', true, true, 92
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_budget_lines' AND field = 'user_created');
INSERT INTO directus_fields (collection, field, special, interface, readonly, hidden, sort)
SELECT 'finance_budget_lines', 'user_updated', 'user-updated', 'select-dropdown-m2o', true, true, 93
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_budget_lines' AND field = 'user_updated');

-- ── finance_transactions fields ────────────────────────────────────────
INSERT INTO directus_fields (collection, field, interface, sort, width, note)
SELECT 'finance_transactions', 'clubdesk_id', 'input', 1, 'half', 'ClubDesk booking ID (upsert key; empty for Eröffnung/Abschluss).'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_transactions' AND field = 'clubdesk_id');
INSERT INTO directus_fields (collection, field, interface, sort, width)
SELECT 'finance_transactions', 'typ', 'input', 2, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_transactions' AND field = 'typ');
INSERT INTO directus_fields (collection, field, interface, sort, width)
SELECT 'finance_transactions', 'beleg', 'input', 3, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_transactions' AND field = 'beleg');
INSERT INTO directus_fields (collection, field, interface, sort, width)
SELECT 'finance_transactions', 'booking_date', 'datetime', 4, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_transactions' AND field = 'booking_date');
INSERT INTO directus_fields (collection, field, interface, sort, width)
SELECT 'finance_transactions', 'text', 'input-multiline', 5, 'full'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_transactions' AND field = 'text');
INSERT INTO directus_fields (collection, field, interface, sort, width)
SELECT 'finance_transactions', 'debit_account_number', 'input', 6, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_transactions' AND field = 'debit_account_number');
INSERT INTO directus_fields (collection, field, interface, sort, width)
SELECT 'finance_transactions', 'debit_account_name', 'input', 7, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_transactions' AND field = 'debit_account_name');
INSERT INTO directus_fields (collection, field, interface, sort, width)
SELECT 'finance_transactions', 'credit_account_number', 'input', 8, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_transactions' AND field = 'credit_account_number');
INSERT INTO directus_fields (collection, field, interface, sort, width)
SELECT 'finance_transactions', 'credit_account_name', 'input', 9, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_transactions' AND field = 'credit_account_name');
INSERT INTO directus_fields (collection, field, special, interface, display, sort, width, note)
SELECT 'finance_transactions', 'debit_account', 'm2o', 'select-dropdown-m2o', 'related-values', 10, 'half', 'Resolved Soll account FK.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_transactions' AND field = 'debit_account');
INSERT INTO directus_fields (collection, field, special, interface, display, sort, width, note)
SELECT 'finance_transactions', 'credit_account', 'm2o', 'select-dropdown-m2o', 'related-values', 11, 'half', 'Resolved Haben account FK.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_transactions' AND field = 'credit_account');
INSERT INTO directus_fields (collection, field, interface, sort, width)
SELECT 'finance_transactions', 'amount_chf', 'input', 12, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_transactions' AND field = 'amount_chf');
INSERT INTO directus_fields (collection, field, special, interface, display, sort, width)
SELECT 'finance_transactions', 'fiscal_year', 'm2o', 'select-dropdown-m2o', 'related-values', 13, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_transactions' AND field = 'fiscal_year');
INSERT INTO directus_fields (collection, field, interface, options, sort, width)
SELECT 'finance_transactions', 'source', 'select-dropdown',
  '{"choices":[{"text":"ClubDesk","value":"clubdesk"},{"text":"Native","value":"native"}]}'::json, 14, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_transactions' AND field = 'source');
INSERT INTO directus_fields (collection, field, special, interface, display, sort, width)
SELECT 'finance_transactions', 'import_batch', 'm2o', 'select-dropdown-m2o', 'related-values', 15, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_transactions' AND field = 'import_batch');
INSERT INTO directus_fields (collection, field, special, interface, readonly, hidden, sort)
SELECT 'finance_transactions', 'date_created', 'date-created', 'datetime', true, true, 90
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_transactions' AND field = 'date_created');
INSERT INTO directus_fields (collection, field, special, interface, readonly, hidden, sort)
SELECT 'finance_transactions', 'date_updated', 'date-updated', 'datetime', true, true, 91
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_transactions' AND field = 'date_updated');
INSERT INTO directus_fields (collection, field, special, interface, readonly, hidden, sort)
SELECT 'finance_transactions', 'user_created', 'user-created', 'select-dropdown-m2o', true, true, 92
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_transactions' AND field = 'user_created');
INSERT INTO directus_fields (collection, field, special, interface, readonly, hidden, sort)
SELECT 'finance_transactions', 'user_updated', 'user-updated', 'select-dropdown-m2o', true, true, 93
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_transactions' AND field = 'user_updated');

-- ── finance_invoices fields ────────────────────────────────────────────
INSERT INTO directus_fields (collection, field, interface, sort, width, note)
SELECT 'finance_invoices', 'clubdesk_id', 'input', 1, 'half', 'ClubDesk [Id] — upsert key.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_invoices' AND field = 'clubdesk_id');
INSERT INTO directus_fields (collection, field, interface, sort, width, note)
SELECT 'finance_invoices', 'number', 'input', 2, 'half', 'Invoice number; empty for drafts.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_invoices' AND field = 'number');
INSERT INTO directus_fields (collection, field, interface, sort, width)
SELECT 'finance_invoices', 'invoice_date', 'datetime', 3, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_invoices' AND field = 'invoice_date');
INSERT INTO directus_fields (collection, field, interface, sort, width)
SELECT 'finance_invoices', 'subject', 'input', 4, 'full'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_invoices' AND field = 'subject');
INSERT INTO directus_fields (collection, field, interface, sort, width)
SELECT 'finance_invoices', 'amount', 'input', 5, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_invoices' AND field = 'amount');
INSERT INTO directus_fields (collection, field, interface, sort, width, note)
SELECT 'finance_invoices', 'status', 'input', 6, 'half', 'ClubDesk invoice status (Entwurf/Offen/Bezahlt/…).'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_invoices' AND field = 'status');
INSERT INTO directus_fields (collection, field, interface, sort, width)
SELECT 'finance_invoices', 'dunning_status', 'input', 7, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_invoices' AND field = 'dunning_status');
INSERT INTO directus_fields (collection, field, interface, sort, width)
SELECT 'finance_invoices', 'due_date', 'datetime', 8, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_invoices' AND field = 'due_date');
INSERT INTO directus_fields (collection, field, interface, sort, width)
SELECT 'finance_invoices', 'amount_paid', 'input', 9, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_invoices' AND field = 'amount_paid');
INSERT INTO directus_fields (collection, field, interface, sort, width)
SELECT 'finance_invoices', 'open_amount', 'input', 10, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_invoices' AND field = 'open_amount');
INSERT INTO directus_fields (collection, field, interface, sort, width)
SELECT 'finance_invoices', 'overpaid_amount', 'input', 11, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_invoices' AND field = 'overpaid_amount');
INSERT INTO directus_fields (collection, field, interface, sort, width)
SELECT 'finance_invoices', 'written_off_amount', 'input', 12, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_invoices' AND field = 'written_off_amount');
INSERT INTO directus_fields (collection, field, interface, sort, width)
SELECT 'finance_invoices', 'payment_method', 'input', 13, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_invoices' AND field = 'payment_method');
INSERT INTO directus_fields (collection, field, interface, sort, width)
SELECT 'finance_invoices', 'reference', 'input', 14, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_invoices' AND field = 'reference');
INSERT INTO directus_fields (collection, field, interface, sort, width)
SELECT 'finance_invoices', 'fee_category', 'input', 15, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_invoices' AND field = 'fee_category');
INSERT INTO directus_fields (collection, field, interface, sort, width)
SELECT 'finance_invoices', 'closed_on', 'datetime', 16, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_invoices' AND field = 'closed_on');
INSERT INTO directus_fields (collection, field, interface, sort, width)
SELECT 'finance_invoices', 'cd_created_at', 'datetime', 17, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_invoices' AND field = 'cd_created_at');
INSERT INTO directus_fields (collection, field, interface, sort, width)
SELECT 'finance_invoices', 'cd_changed_at', 'datetime', 18, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_invoices' AND field = 'cd_changed_at');
INSERT INTO directus_fields (collection, field, interface, sort, width)
SELECT 'finance_invoices', 'recipient_name', 'input', 19, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_invoices' AND field = 'recipient_name');
INSERT INTO directus_fields (collection, field, interface, sort, width)
SELECT 'finance_invoices', 'recipient_email', 'input', 20, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_invoices' AND field = 'recipient_email');
INSERT INTO directus_fields (collection, field, interface, sort, width, note)
SELECT 'finance_invoices', 'cd_benutzer_id', 'input', 21, 'half', 'ClubDesk login id (member-match fallback).'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_invoices' AND field = 'cd_benutzer_id');
INSERT INTO directus_fields (collection, field, special, interface, display, sort, width, note)
SELECT 'finance_invoices', 'member', 'm2o', 'select-dropdown-m2o', 'related-values', 22, 'half', 'Matched member (email, fallback cd_benutzer_id); NULL if unmatched.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_invoices' AND field = 'member');
INSERT INTO directus_fields (collection, field, special, interface, display, sort, width)
SELECT 'finance_invoices', 'fiscal_year', 'm2o', 'select-dropdown-m2o', 'related-values', 23, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_invoices' AND field = 'fiscal_year');
INSERT INTO directus_fields (collection, field, interface, options, sort, width)
SELECT 'finance_invoices', 'source', 'select-dropdown',
  '{"choices":[{"text":"ClubDesk","value":"clubdesk"},{"text":"Native","value":"native"}]}'::json, 24, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_invoices' AND field = 'source');
INSERT INTO directus_fields (collection, field, special, interface, display, sort, width)
SELECT 'finance_invoices', 'import_batch', 'm2o', 'select-dropdown-m2o', 'related-values', 25, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_invoices' AND field = 'import_batch');
INSERT INTO directus_fields (collection, field, special, interface, readonly, hidden, sort)
SELECT 'finance_invoices', 'date_created', 'date-created', 'datetime', true, true, 90
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_invoices' AND field = 'date_created');
INSERT INTO directus_fields (collection, field, special, interface, readonly, hidden, sort)
SELECT 'finance_invoices', 'date_updated', 'date-updated', 'datetime', true, true, 91
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_invoices' AND field = 'date_updated');
INSERT INTO directus_fields (collection, field, special, interface, readonly, hidden, sort)
SELECT 'finance_invoices', 'user_created', 'user-created', 'select-dropdown-m2o', true, true, 92
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_invoices' AND field = 'user_created');
INSERT INTO directus_fields (collection, field, special, interface, readonly, hidden, sort)
SELECT 'finance_invoices', 'user_updated', 'user-updated', 'select-dropdown-m2o', true, true, 93
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_invoices' AND field = 'user_updated');

-- ── finance_payments fields ────────────────────────────────────────────
INSERT INTO directus_fields (collection, field, special, interface, display, sort, width)
SELECT 'finance_payments', 'invoice', 'm2o', 'select-dropdown-m2o', 'related-values', 1, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_payments' AND field = 'invoice');
INSERT INTO directus_fields (collection, field, interface, sort, width)
SELECT 'finance_payments', 'payment_date', 'datetime', 2, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_payments' AND field = 'payment_date');
INSERT INTO directus_fields (collection, field, interface, sort, width)
SELECT 'finance_payments', 'amount', 'input', 3, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_payments' AND field = 'amount');
INSERT INTO directus_fields (collection, field, interface, sort, width)
SELECT 'finance_payments', 'method', 'input', 4, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_payments' AND field = 'method');
INSERT INTO directus_fields (collection, field, interface, sort, width)
SELECT 'finance_payments', 'camt_reference', 'input', 5, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_payments' AND field = 'camt_reference');
INSERT INTO directus_fields (collection, field, interface, options, sort, width)
SELECT 'finance_payments', 'source', 'select-dropdown',
  '{"choices":[{"text":"ClubDesk","value":"clubdesk"},{"text":"Native","value":"native"}]}'::json, 6, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_payments' AND field = 'source');
INSERT INTO directus_fields (collection, field, special, interface, display, sort, width)
SELECT 'finance_payments', 'import_batch', 'm2o', 'select-dropdown-m2o', 'related-values', 7, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_payments' AND field = 'import_batch');
INSERT INTO directus_fields (collection, field, special, interface, readonly, hidden, sort)
SELECT 'finance_payments', 'date_created', 'date-created', 'datetime', true, true, 90
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_payments' AND field = 'date_created');
INSERT INTO directus_fields (collection, field, special, interface, readonly, hidden, sort)
SELECT 'finance_payments', 'date_updated', 'date-updated', 'datetime', true, true, 91
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_payments' AND field = 'date_updated');
INSERT INTO directus_fields (collection, field, special, interface, readonly, hidden, sort)
SELECT 'finance_payments', 'user_created', 'user-created', 'select-dropdown-m2o', true, true, 92
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_payments' AND field = 'user_created');
INSERT INTO directus_fields (collection, field, special, interface, readonly, hidden, sort)
SELECT 'finance_payments', 'user_updated', 'user-updated', 'select-dropdown-m2o', true, true, 93
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_payments' AND field = 'user_updated');

-- ══ Directus relations metadata (so M2O FKs expand in the items API) ═══
INSERT INTO directus_relations (many_collection, many_field, one_collection, one_field, one_collection_field, one_allowed_collections, junction_field, sort_field, one_deselect_action)
SELECT 'finance_budget_lines', 'fiscal_year', 'finance_fiscal_years', NULL, NULL, NULL, NULL, NULL, 'nullify'
WHERE NOT EXISTS (SELECT 1 FROM directus_relations WHERE many_collection = 'finance_budget_lines' AND many_field = 'fiscal_year');
INSERT INTO directus_relations (many_collection, many_field, one_collection, one_field, one_collection_field, one_allowed_collections, junction_field, sort_field, one_deselect_action)
SELECT 'finance_budget_lines', 'account', 'finance_accounts', NULL, NULL, NULL, NULL, NULL, 'nullify'
WHERE NOT EXISTS (SELECT 1 FROM directus_relations WHERE many_collection = 'finance_budget_lines' AND many_field = 'account');
INSERT INTO directus_relations (many_collection, many_field, one_collection, one_field, one_collection_field, one_allowed_collections, junction_field, sort_field, one_deselect_action)
SELECT 'finance_transactions', 'debit_account', 'finance_accounts', NULL, NULL, NULL, NULL, NULL, 'nullify'
WHERE NOT EXISTS (SELECT 1 FROM directus_relations WHERE many_collection = 'finance_transactions' AND many_field = 'debit_account');
INSERT INTO directus_relations (many_collection, many_field, one_collection, one_field, one_collection_field, one_allowed_collections, junction_field, sort_field, one_deselect_action)
SELECT 'finance_transactions', 'credit_account', 'finance_accounts', NULL, NULL, NULL, NULL, NULL, 'nullify'
WHERE NOT EXISTS (SELECT 1 FROM directus_relations WHERE many_collection = 'finance_transactions' AND many_field = 'credit_account');
INSERT INTO directus_relations (many_collection, many_field, one_collection, one_field, one_collection_field, one_allowed_collections, junction_field, sort_field, one_deselect_action)
SELECT 'finance_transactions', 'fiscal_year', 'finance_fiscal_years', NULL, NULL, NULL, NULL, NULL, 'nullify'
WHERE NOT EXISTS (SELECT 1 FROM directus_relations WHERE many_collection = 'finance_transactions' AND many_field = 'fiscal_year');
INSERT INTO directus_relations (many_collection, many_field, one_collection, one_field, one_collection_field, one_allowed_collections, junction_field, sort_field, one_deselect_action)
SELECT 'finance_transactions', 'import_batch', 'finance_imports', NULL, NULL, NULL, NULL, NULL, 'nullify'
WHERE NOT EXISTS (SELECT 1 FROM directus_relations WHERE many_collection = 'finance_transactions' AND many_field = 'import_batch');
INSERT INTO directus_relations (many_collection, many_field, one_collection, one_field, one_collection_field, one_allowed_collections, junction_field, sort_field, one_deselect_action)
SELECT 'finance_invoices', 'member', 'members', NULL, NULL, NULL, NULL, NULL, 'nullify'
WHERE NOT EXISTS (SELECT 1 FROM directus_relations WHERE many_collection = 'finance_invoices' AND many_field = 'member');
INSERT INTO directus_relations (many_collection, many_field, one_collection, one_field, one_collection_field, one_allowed_collections, junction_field, sort_field, one_deselect_action)
SELECT 'finance_invoices', 'fiscal_year', 'finance_fiscal_years', NULL, NULL, NULL, NULL, NULL, 'nullify'
WHERE NOT EXISTS (SELECT 1 FROM directus_relations WHERE many_collection = 'finance_invoices' AND many_field = 'fiscal_year');
INSERT INTO directus_relations (many_collection, many_field, one_collection, one_field, one_collection_field, one_allowed_collections, junction_field, sort_field, one_deselect_action)
SELECT 'finance_invoices', 'import_batch', 'finance_imports', NULL, NULL, NULL, NULL, NULL, 'nullify'
WHERE NOT EXISTS (SELECT 1 FROM directus_relations WHERE many_collection = 'finance_invoices' AND many_field = 'import_batch');
INSERT INTO directus_relations (many_collection, many_field, one_collection, one_field, one_collection_field, one_allowed_collections, junction_field, sort_field, one_deselect_action)
SELECT 'finance_payments', 'invoice', 'finance_invoices', NULL, NULL, NULL, NULL, NULL, 'nullify'
WHERE NOT EXISTS (SELECT 1 FROM directus_relations WHERE many_collection = 'finance_payments' AND many_field = 'invoice');
INSERT INTO directus_relations (many_collection, many_field, one_collection, one_field, one_collection_field, one_allowed_collections, junction_field, sort_field, one_deselect_action)
SELECT 'finance_payments', 'import_batch', 'finance_imports', NULL, NULL, NULL, NULL, NULL, 'nullify'
WHERE NOT EXISTS (SELECT 1 FROM directus_relations WHERE many_collection = 'finance_payments' AND many_field = 'import_batch');

COMMIT;
