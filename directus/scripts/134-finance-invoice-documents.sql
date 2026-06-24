-- Migration 134: invoice PDF attachments (finance), keyed for ClubDesk 1-1 + sync-safe.
--
-- Lets finance attach the actual invoice PDF to an invoice. The integrity rule the
-- treasurer asked for: a document binds to exactly ONE ClubDesk invoice and SURVIVES
-- the nightly delete+reinsert — so ClubDesk-mirror docs key on `match_clubdesk_id`
-- (the invoice's own [Id], UNIQUE + deduped on import, NOT the churning surrogate
-- id), exactly like finance_invoice_member_overrides. Native (in-app) invoices have
-- no ClubDesk twin, so they key on the stable surrogate `invoice` FK instead.
-- Exactly one of the two keys is set (CHECK).
--
-- Security: invoice PDFs contain a member's billing details, so the file lands in a
-- PRIVATE folder (fixed UUID). setup-permissions.mjs surgically excludes ONLY this
-- folder from the member directus_files read (all other member file access —
-- folder-less photos, feedback screenshots — is unchanged), so /assets 403s the PDF
-- for members while finance + board get a folder-scoped read. Same private-folder
-- pattern as feedback screenshots (migration 074).
--
-- Schema-only + idempotent. Permissions live in setup-permissions.mjs.

BEGIN;

-- Private folder for invoice PDFs (fixed id → consistent on dev/prod/fresh installs).
INSERT INTO directus_folders (id, name)
VALUES ('f1a0d0c5-0000-4000-8000-000000000001', 'Finance invoice documents (private)')
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS finance_invoice_documents (
  id                serial PRIMARY KEY,
  file              uuid NOT NULL REFERENCES directus_files(id) ON DELETE CASCADE,
  match_clubdesk_id varchar(32),
  invoice           integer REFERENCES finance_invoices(id) ON DELETE CASCADE,
  label             varchar(255),
  uploaded_by_name  varchar(255),
  uploaded_by_email varchar(255),
  date_created      timestamptz NOT NULL DEFAULT now(),
  user_created      uuid,
  CONSTRAINT finance_invoice_documents_key_check
    CHECK (num_nonnulls(match_clubdesk_id, invoice) = 1)
);
CREATE INDEX IF NOT EXISTS finance_invoice_documents_clubdesk_idx
  ON finance_invoice_documents (match_clubdesk_id) WHERE match_clubdesk_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS finance_invoice_documents_invoice_idx
  ON finance_invoice_documents (invoice) WHERE invoice IS NOT NULL;
CREATE INDEX IF NOT EXISTS finance_invoice_documents_file_idx
  ON finance_invoice_documents (file);

COMMENT ON TABLE finance_invoice_documents IS
  'Invoice PDF attachments. ClubDesk-mirror invoices key on match_clubdesk_id (survives the nightly sync, 1-1 with the ClubDesk invoice); native invoices key on the invoice FK. File lives in the private folder f1a0d0c5… — members cannot read it via /assets.';

-- ── Directus admin metadata ────────────────────────────────────────────
INSERT INTO directus_collections (collection, icon, color, "group", sort, archive_app_filter)
SELECT 'finance_invoice_documents', 'picture_as_pdf', '#059669', NULL, NULL, true
WHERE NOT EXISTS (SELECT 1 FROM directus_collections WHERE collection = 'finance_invoice_documents');

INSERT INTO directus_fields (collection, field, special, interface, display, sort, width, note)
SELECT 'finance_invoice_documents', 'file', 'file', 'file', 'file', 1, 'half', 'The uploaded invoice PDF (private folder).'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_invoice_documents' AND field = 'file');
INSERT INTO directus_fields (collection, field, interface, sort, width, note)
SELECT 'finance_invoice_documents', 'match_clubdesk_id', 'input', 2, 'half', 'ClubDesk invoice [Id] this PDF belongs to (survives sync).'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_invoice_documents' AND field = 'match_clubdesk_id');
INSERT INTO directus_fields (collection, field, special, interface, display, sort, width, note)
SELECT 'finance_invoice_documents', 'invoice', 'm2o', 'select-dropdown-m2o', 'related-values', 3, 'half', 'Native invoice this PDF belongs to (NULL for ClubDesk-mirror docs).'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_invoice_documents' AND field = 'invoice');
INSERT INTO directus_fields (collection, field, interface, sort, width)
SELECT 'finance_invoice_documents', 'label', 'input', 4, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_invoice_documents' AND field = 'label');
INSERT INTO directus_fields (collection, field, interface, readonly, sort, width, note)
SELECT 'finance_invoice_documents', 'uploaded_by_name', 'input', true, 5, 'half', 'Who uploaded the document.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_invoice_documents' AND field = 'uploaded_by_name');
INSERT INTO directus_fields (collection, field, interface, readonly, sort, width)
SELECT 'finance_invoice_documents', 'uploaded_by_email', 'input', true, 6, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_invoice_documents' AND field = 'uploaded_by_email');
INSERT INTO directus_fields (collection, field, special, interface, readonly, hidden, sort)
SELECT 'finance_invoice_documents', 'date_created', 'date-created', 'datetime', true, true, 90
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_invoice_documents' AND field = 'date_created');
INSERT INTO directus_fields (collection, field, special, interface, readonly, hidden, sort)
SELECT 'finance_invoice_documents', 'user_created', 'user-created', 'select-dropdown-m2o', true, true, 91
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_invoice_documents' AND field = 'user_created');

INSERT INTO directus_relations (many_collection, many_field, one_collection, one_field, one_collection_field, one_allowed_collections, junction_field, sort_field, one_deselect_action)
SELECT 'finance_invoice_documents', 'file', 'directus_files', NULL, NULL, NULL, NULL, NULL, 'nullify'
WHERE NOT EXISTS (SELECT 1 FROM directus_relations WHERE many_collection = 'finance_invoice_documents' AND many_field = 'file');
INSERT INTO directus_relations (many_collection, many_field, one_collection, one_field, one_collection_field, one_allowed_collections, junction_field, sort_field, one_deselect_action)
SELECT 'finance_invoice_documents', 'invoice', 'finance_invoices', NULL, NULL, NULL, NULL, NULL, 'nullify'
WHERE NOT EXISTS (SELECT 1 FROM directus_relations WHERE many_collection = 'finance_invoice_documents' AND many_field = 'invoice');

COMMIT;
