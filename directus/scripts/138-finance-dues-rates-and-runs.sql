-- Migration 138: Recurring / batch membership-dues billing (the "dues run").
--
-- The single feature without which the club still needs ClubDesk to bill the
-- season membership fee. Builds entirely on the native-invoice engine (128):
--   * finance_dues_rates — a per-(fiscal_year, category[, sektion]) CHF schedule.
--     `category` matches the free-text members.beitragskategorie label; a row
--     with sektion NULL is the default for that category, a sektion-specific row
--     overrides it. There is NO dues-amount data anywhere in the schema today
--     (members.mitgliederbeitrag is not mirrored) — the treasurer fills this in.
--   * finance_dues_runs — one row per issued batch (audit trail + a handle to
--     bulk-cancel a run).
--   * finance_invoices.dues_run — links each minted native invoice to its run.
--     A partial-UNIQUE(dues_run, member) stops the same member being billed twice
--     within one run; cross-run double-billing is prevented in the endpoint
--     (skips members who already hold a non-cancelled dues invoice this year).
--
-- The run endpoint mints ordinary native finance_invoices (source='native',
-- status='open') exactly like POST /finance/invoices — same N-YYYY-NNNN sequence,
-- same best-effort SCOR stamp — so QR-bills, my-invoices and the camt ladder all
-- work unchanged.
--
-- Schema-only + idempotent. Permissions live in setup-permissions.mjs.

BEGIN;

-- ── Rate schedule ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS finance_dues_rates (
  id               serial PRIMARY KEY,
  fiscal_year      integer NOT NULL REFERENCES finance_fiscal_years(id) ON DELETE CASCADE,
  category         varchar(100) NOT NULL,
  sektion          varchar(64),
  amount_chf       numeric(12,2) NOT NULL CHECK (amount_chf >= 0),
  subject_template varchar(255),
  active           boolean NOT NULL DEFAULT true,
  created_by_name  varchar(255),
  created_by_email varchar(255),
  date_created     timestamptz NOT NULL DEFAULT now(),
  date_updated     timestamptz,
  user_created     uuid
);
-- One rate per (year, category, sektion); NULL sektion folded to '' so the
-- category-default row is unique alongside sektion-specific overrides.
CREATE UNIQUE INDEX IF NOT EXISTS finance_dues_rates_uq
  ON finance_dues_rates (fiscal_year, lower(category), coalesce(sektion, ''));

COMMENT ON TABLE finance_dues_rates IS
  'Per-(fiscal_year, beitragskategorie[, sektion]) membership-fee schedule. sektion NULL = category default; a sektion row overrides. Treasurer-entered (no dues amount is mirrored from ClubDesk).';

-- ── Issued batches ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS finance_dues_runs (
  id               serial PRIMARY KEY,
  fiscal_year      integer NOT NULL REFERENCES finance_fiscal_years(id) ON DELETE CASCADE,
  label            varchar(64),
  filter_json      jsonb,
  status           varchar(16) NOT NULL DEFAULT 'issued' CHECK (status IN ('issued', 'cancelled')),
  total_count      integer NOT NULL DEFAULT 0,
  total_amount     numeric(12,2) NOT NULL DEFAULT 0,
  created_by_name  varchar(255),
  created_by_email varchar(255),
  date_created     timestamptz NOT NULL DEFAULT now(),
  user_created     uuid
);
CREATE INDEX IF NOT EXISTS finance_dues_runs_fy_idx ON finance_dues_runs (fiscal_year);

COMMENT ON TABLE finance_dues_runs IS
  'One row per issued dues batch: the audit trail + the handle used to bulk-cancel a run (cancels its still-open invoices, leaves paid ones).';

-- ── Link minted invoices to their run + the double-bill guard ──────────
ALTER TABLE finance_invoices
  ADD COLUMN IF NOT EXISTS dues_run integer REFERENCES finance_dues_runs(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS finance_invoices_dues_run_member_uq
  ON finance_invoices (dues_run, member)
  WHERE dues_run IS NOT NULL AND member IS NOT NULL;
-- Fast "does this member already have a dues invoice this fiscal year?" lookup
-- (the cross-run idempotency check the issue endpoint runs).
CREATE INDEX IF NOT EXISTS finance_invoices_dues_fy_member_idx
  ON finance_invoices (fiscal_year, member)
  WHERE dues_run IS NOT NULL AND member IS NOT NULL;

COMMENT ON COLUMN finance_invoices.dues_run IS
  'Native dues invoice: the finance_dues_runs batch that minted it. NULL for ad-hoc and ClubDesk-mirror rows.';

-- ── Directus admin metadata: finance_dues_rates ────────────────────────
INSERT INTO directus_collections (collection, icon, color, "group", sort, archive_app_filter)
SELECT 'finance_dues_rates', 'price_change', '#059669', NULL, NULL, true
WHERE NOT EXISTS (SELECT 1 FROM directus_collections WHERE collection = 'finance_dues_rates');

INSERT INTO directus_fields (collection, field, special, interface, display, sort, width, note)
SELECT 'finance_dues_rates', 'fiscal_year', 'm2o', 'select-dropdown-m2o', 'related-values', 1, 'half', 'Season the rate applies to.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_dues_rates' AND field = 'fiscal_year');
INSERT INTO directus_fields (collection, field, interface, sort, width, note)
SELECT 'finance_dues_rates', 'category', 'input', 2, 'half', 'members.beitragskategorie label this rate bills.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_dues_rates' AND field = 'category');
INSERT INTO directus_fields (collection, field, interface, sort, width, note)
SELECT 'finance_dues_rates', 'sektion', 'input', 3, 'half', 'Optional sektion override; NULL = category default.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_dues_rates' AND field = 'sektion');
INSERT INTO directus_fields (collection, field, interface, sort, width)
SELECT 'finance_dues_rates', 'amount_chf', 'input', 4, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_dues_rates' AND field = 'amount_chf');
INSERT INTO directus_fields (collection, field, interface, sort, width, note)
SELECT 'finance_dues_rates', 'subject_template', 'input', 5, 'full', 'Invoice subject; {fy} → season label, {category} → category.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_dues_rates' AND field = 'subject_template');
INSERT INTO directus_fields (collection, field, special, interface, sort, width)
SELECT 'finance_dues_rates', 'active', 'cast-boolean', 'boolean', 6, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_dues_rates' AND field = 'active');
INSERT INTO directus_fields (collection, field, interface, readonly, sort, width)
SELECT 'finance_dues_rates', 'created_by_name', 'input', true, 10, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_dues_rates' AND field = 'created_by_name');
INSERT INTO directus_fields (collection, field, special, interface, readonly, hidden, sort)
SELECT 'finance_dues_rates', 'date_created', 'date-created', 'datetime', true, true, 90
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_dues_rates' AND field = 'date_created');
INSERT INTO directus_fields (collection, field, special, interface, readonly, hidden, sort)
SELECT 'finance_dues_rates', 'user_created', 'user-created', 'select-dropdown-m2o', true, true, 91
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_dues_rates' AND field = 'user_created');

-- ── Directus admin metadata: finance_dues_runs ─────────────────────────
INSERT INTO directus_collections (collection, icon, color, "group", sort, archive_app_filter)
SELECT 'finance_dues_runs', 'receipt_long', '#059669', NULL, NULL, true
WHERE NOT EXISTS (SELECT 1 FROM directus_collections WHERE collection = 'finance_dues_runs');

INSERT INTO directus_fields (collection, field, special, interface, display, sort, width, note)
SELECT 'finance_dues_runs', 'fiscal_year', 'm2o', 'select-dropdown-m2o', 'related-values', 1, 'half', 'Season billed.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_dues_runs' AND field = 'fiscal_year');
INSERT INTO directus_fields (collection, field, interface, sort, width)
SELECT 'finance_dues_runs', 'label', 'input', 2, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_dues_runs' AND field = 'label');
INSERT INTO directus_fields (collection, field, interface, options, sort, width)
SELECT 'finance_dues_runs', 'status', 'select-dropdown',
  '{"choices":[{"text":"Issued","value":"issued"},{"text":"Cancelled","value":"cancelled"}]}'::json, 3, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_dues_runs' AND field = 'status');
INSERT INTO directus_fields (collection, field, interface, readonly, sort, width)
SELECT 'finance_dues_runs', 'total_count', 'input', true, 4, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_dues_runs' AND field = 'total_count');
INSERT INTO directus_fields (collection, field, interface, readonly, sort, width)
SELECT 'finance_dues_runs', 'total_amount', 'input', true, 5, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_dues_runs' AND field = 'total_amount');
INSERT INTO directus_fields (collection, field, special, interface, readonly, hidden, sort)
SELECT 'finance_dues_runs', 'filter_json', 'cast-json', 'input-code', true, true, 6
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_dues_runs' AND field = 'filter_json');
INSERT INTO directus_fields (collection, field, interface, readonly, sort, width)
SELECT 'finance_dues_runs', 'created_by_name', 'input', true, 10, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_dues_runs' AND field = 'created_by_name');
INSERT INTO directus_fields (collection, field, special, interface, readonly, hidden, sort)
SELECT 'finance_dues_runs', 'date_created', 'date-created', 'datetime', true, true, 90
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_dues_runs' AND field = 'date_created');
INSERT INTO directus_fields (collection, field, special, interface, readonly, hidden, sort)
SELECT 'finance_dues_runs', 'user_created', 'user-created', 'select-dropdown-m2o', true, true, 91
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_dues_runs' AND field = 'user_created');

-- ── finance_invoices.dues_run field + relations ────────────────────────
INSERT INTO directus_fields (collection, field, special, interface, display, readonly, sort, width, note)
SELECT 'finance_invoices', 'dues_run', 'm2o', 'select-dropdown-m2o', 'related-values', true, 37, 'half',
  'The dues batch that minted this native invoice (NULL for ad-hoc / ClubDesk rows).'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_invoices' AND field = 'dues_run');

INSERT INTO directus_relations (many_collection, many_field, one_collection, one_field, one_collection_field, one_allowed_collections, junction_field, sort_field, one_deselect_action)
SELECT 'finance_dues_rates', 'fiscal_year', 'finance_fiscal_years', NULL, NULL, NULL, NULL, NULL, 'nullify'
WHERE NOT EXISTS (SELECT 1 FROM directus_relations WHERE many_collection = 'finance_dues_rates' AND many_field = 'fiscal_year');
INSERT INTO directus_relations (many_collection, many_field, one_collection, one_field, one_collection_field, one_allowed_collections, junction_field, sort_field, one_deselect_action)
SELECT 'finance_dues_runs', 'fiscal_year', 'finance_fiscal_years', NULL, NULL, NULL, NULL, NULL, 'nullify'
WHERE NOT EXISTS (SELECT 1 FROM directus_relations WHERE many_collection = 'finance_dues_runs' AND many_field = 'fiscal_year');
INSERT INTO directus_relations (many_collection, many_field, one_collection, one_field, one_collection_field, one_allowed_collections, junction_field, sort_field, one_deselect_action)
SELECT 'finance_invoices', 'dues_run', 'finance_dues_runs', NULL, NULL, NULL, NULL, NULL, 'nullify'
WHERE NOT EXISTS (SELECT 1 FROM directus_relations WHERE many_collection = 'finance_invoices' AND many_field = 'dues_run');

COMMIT;
