-- Migration 128: Native invoices (Scope C write-path on finance_invoices).
--
-- Adds the columns the native-invoice feature needs ON TOP of the existing
-- ClubDesk-mirror table (migration 114). ClubDesk stays the source of truth:
--   * clubdesk_id relaxed to NULL (native rows have no ClubDesk [Id]); the
--     UNIQUE index still holds (Postgres treats NULLs as distinct) and the
--     importer only ever deletes source='clubdesk', so native rows survive.
--   * A native invoice is billed to a member OR a team (team payable by its
--     coach/captain/TR — resolved by the /finance/my-invoices endpoint).
--   * Native lifecycle rides the existing `status` column (source disambiguates):
--       open -> pending_confirmation -> paid, plus cancelled.
--     A member self-reports payment (pending_confirmation); it flips to paid
--     either when the next ClubDesk sync matches the payment (confirmed_via=sync)
--     or when the treasurer confirms manually (confirmed_via=manual).
--   * Actor capture per CLAUDE.md (created_by_*, confirmed_by_*, reported_paid_by).
--
-- Schema-only + idempotent. Permissions live in setup-permissions.mjs.

BEGIN;

-- clubdesk_id: optional for native rows (kept as the mirror upsert key).
ALTER TABLE finance_invoices ALTER COLUMN clubdesk_id DROP NOT NULL;

-- Native columns.
ALTER TABLE finance_invoices
  ADD COLUMN IF NOT EXISTS team                 integer REFERENCES teams(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS created_by_name      varchar(255),
  ADD COLUMN IF NOT EXISTS created_by_email     varchar(255),
  ADD COLUMN IF NOT EXISTS reported_paid_at     timestamptz,
  ADD COLUMN IF NOT EXISTS reported_paid_method varchar(32),
  ADD COLUMN IF NOT EXISTS reported_paid_by     integer REFERENCES members(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS confirmed_at         timestamptz,
  ADD COLUMN IF NOT EXISTS confirmed_by_name    varchar(255),
  ADD COLUMN IF NOT EXISTS confirmed_by_email   varchar(255),
  ADD COLUMN IF NOT EXISTS confirmed_via        varchar(16),
  ADD COLUMN IF NOT EXISTS cancelled_at         timestamptz;

-- Human invoice number for native rows (also the Phase-2 reconciliation key the
-- treasurer reuses as the ClubDesk invoice number). e.g. N-2026-0007.
CREATE SEQUENCE IF NOT EXISTS finance_native_invoice_seq START 1;

-- Index for the member-facing payable-invoice query (own native + team).
CREATE INDEX IF NOT EXISTS finance_invoices_team_status_idx ON finance_invoices (team, status);

COMMENT ON COLUMN finance_invoices.team IS
  'Native team invoice: billed to this team, payable by its coach/captain/TR (resolved at read time by /finance/my-invoices). NULL for member invoices and all ClubDesk-mirror rows.';
COMMENT ON COLUMN finance_invoices.confirmed_via IS
  'How a native invoice''s payment was confirmed: sync (matched in the next ClubDesk export) or manual (treasurer).';

-- ── Directus field metadata for the new native columns ─────────────────
INSERT INTO directus_fields (collection, field, special, interface, display, options, sort, width, note)
SELECT 'finance_invoices', 'team', 'm2o', 'select-dropdown-m2o', 'related-values',
  '{"template":"{{name}}"}'::json, 26, 'half',
  'Native team invoice (payable by the team''s coach/captain/TR).'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_invoices' AND field = 'team');
INSERT INTO directus_fields (collection, field, interface, readonly, sort, width, note)
SELECT 'finance_invoices', 'created_by_name', 'input', true, 27, 'half', 'Who created this native invoice.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_invoices' AND field = 'created_by_name');
INSERT INTO directus_fields (collection, field, interface, readonly, sort, width)
SELECT 'finance_invoices', 'created_by_email', 'input', true, 28, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_invoices' AND field = 'created_by_email');
INSERT INTO directus_fields (collection, field, interface, readonly, sort, width, note)
SELECT 'finance_invoices', 'reported_paid_at', 'datetime', true, 29, 'half', 'When the member self-reported payment (pending confirmation).'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_invoices' AND field = 'reported_paid_at');
INSERT INTO directus_fields (collection, field, interface, readonly, sort, width)
SELECT 'finance_invoices', 'reported_paid_method', 'input', true, 30, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_invoices' AND field = 'reported_paid_method');
INSERT INTO directus_fields (collection, field, special, interface, display, readonly, sort, width)
SELECT 'finance_invoices', 'reported_paid_by', 'm2o', 'select-dropdown-m2o', 'related-values', true, 31, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_invoices' AND field = 'reported_paid_by');
INSERT INTO directus_fields (collection, field, interface, readonly, sort, width, note)
SELECT 'finance_invoices', 'confirmed_at', 'datetime', true, 32, 'half', 'When payment was confirmed (sync or treasurer).'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_invoices' AND field = 'confirmed_at');
INSERT INTO directus_fields (collection, field, interface, readonly, sort, width)
SELECT 'finance_invoices', 'confirmed_by_name', 'input', true, 33, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_invoices' AND field = 'confirmed_by_name');
INSERT INTO directus_fields (collection, field, interface, readonly, sort, width)
SELECT 'finance_invoices', 'confirmed_by_email', 'input', true, 34, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_invoices' AND field = 'confirmed_by_email');
INSERT INTO directus_fields (collection, field, interface, options, readonly, sort, width)
SELECT 'finance_invoices', 'confirmed_via', 'select-dropdown',
  '{"choices":[{"text":"Sync","value":"sync"},{"text":"Manual","value":"manual"}]}'::json, true, 35, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_invoices' AND field = 'confirmed_via');
INSERT INTO directus_fields (collection, field, interface, readonly, sort, width)
SELECT 'finance_invoices', 'cancelled_at', 'datetime', true, 36, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_invoices' AND field = 'cancelled_at');

-- ── Directus relations so the new M2O FKs expand in the items API ──────
INSERT INTO directus_relations (many_collection, many_field, one_collection, one_field, one_collection_field, one_allowed_collections, junction_field, sort_field, one_deselect_action)
SELECT 'finance_invoices', 'team', 'teams', NULL, NULL, NULL, NULL, NULL, 'nullify'
WHERE NOT EXISTS (SELECT 1 FROM directus_relations WHERE many_collection = 'finance_invoices' AND many_field = 'team');
INSERT INTO directus_relations (many_collection, many_field, one_collection, one_field, one_collection_field, one_allowed_collections, junction_field, sort_field, one_deselect_action)
SELECT 'finance_invoices', 'reported_paid_by', 'members', NULL, NULL, NULL, NULL, NULL, 'nullify'
WHERE NOT EXISTS (SELECT 1 FROM directus_relations WHERE many_collection = 'finance_invoices' AND many_field = 'reported_paid_by');

COMMIT;
