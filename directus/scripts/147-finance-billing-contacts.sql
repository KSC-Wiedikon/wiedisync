-- Migration 147: billing contacts — invoice NON-members (sponsors, parents,
-- companies, ex-members) that have no member row.
--
-- A native invoice can now be billed to a member OR a team OR a billing contact;
-- the create endpoint snapshots recipient_name/email exactly as it does for the
-- other two, so QR-bills, SCOR refs, the camt ladder and reporting all keep working
-- (reconciliation keys off the invoice number/reference, not the recipient).
--
-- Schema-only + idempotent. Endpoint-gated (no items-API permission needed).

BEGIN;

CREATE TABLE IF NOT EXISTS finance_billing_contacts (
  id               serial PRIMARY KEY,
  kind             varchar(16) NOT NULL DEFAULT 'sponsor' CHECK (kind IN ('sponsor', 'parent', 'ex_member', 'company', 'other')),
  name             varchar(255) NOT NULL,
  email            varchar(255),
  address          varchar(255),
  plz              varchar(10),
  ort              varchar(100),
  billing_iban     varchar(34),
  notes            varchar(255),
  active           boolean NOT NULL DEFAULT true,
  source           varchar(16) NOT NULL DEFAULT 'native',
  created_by_name  varchar(255),
  created_by_email varchar(255),
  date_created     timestamptz NOT NULL DEFAULT now(),
  date_updated     timestamptz,
  user_created     uuid
);

ALTER TABLE finance_invoices ADD COLUMN IF NOT EXISTS contact integer REFERENCES finance_billing_contacts(id) ON DELETE SET NULL;

COMMENT ON TABLE finance_billing_contacts IS
  'Non-member billing recipients (sponsors/parents/companies/ex-members). A native invoice can be billed to one via finance_invoices.contact; recipient_name/email are snapshotted at create time.';

INSERT INTO directus_collections (collection, icon, color, "group", sort, archive_app_filter)
SELECT 'finance_billing_contacts', 'contacts', '#059669', NULL, NULL, true
WHERE NOT EXISTS (SELECT 1 FROM directus_collections WHERE collection = 'finance_billing_contacts');
INSERT INTO directus_fields (collection, field, interface, options, sort, width)
SELECT 'finance_billing_contacts', 'kind', 'select-dropdown',
  '{"choices":[{"text":"Sponsor","value":"sponsor"},{"text":"Parent","value":"parent"},{"text":"Ex-member","value":"ex_member"},{"text":"Company","value":"company"},{"text":"Other","value":"other"}]}'::json, 1, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_billing_contacts' AND field = 'kind');
INSERT INTO directus_fields (collection, field, interface, sort, width)
SELECT 'finance_billing_contacts', 'name', 'input', 2, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_billing_contacts' AND field = 'name');
INSERT INTO directus_fields (collection, field, interface, sort, width)
SELECT 'finance_billing_contacts', 'email', 'input', 3, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_billing_contacts' AND field = 'email');
INSERT INTO directus_fields (collection, field, interface, sort, width)
SELECT 'finance_billing_contacts', 'billing_iban', 'input', 4, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_billing_contacts' AND field = 'billing_iban');
INSERT INTO directus_fields (collection, field, special, interface, display, readonly, sort, width, note)
SELECT 'finance_invoices', 'contact', 'm2o', 'select-dropdown-m2o', 'related-values', true, 39, 'half',
  'Non-member billing recipient (sponsor/parent/company), if this native invoice is billed to one.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_invoices' AND field = 'contact');

INSERT INTO directus_relations (many_collection, many_field, one_collection, one_field, one_collection_field, one_allowed_collections, junction_field, sort_field, one_deselect_action)
SELECT 'finance_invoices', 'contact', 'finance_billing_contacts', NULL, NULL, NULL, NULL, NULL, 'nullify'
WHERE NOT EXISTS (SELECT 1 FROM directus_relations WHERE many_collection = 'finance_invoices' AND many_field = 'contact');

COMMIT;
