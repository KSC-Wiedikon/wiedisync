-- Migration 137: member pay-outs (reimbursements the club owes a member).
--
-- The OPPOSITE direction to finance_invoices (which a member pays): a pay-out is
-- money the club sends TO a member. The treasurer saves one in the finance member
-- explorer (amount + optional message + a snapshot of the payee account/address);
-- it then shows on the member's own "My finances" page, and either side can
-- regenerate the Swiss QR-bill PDF from the snapshot. Treasurer can delete it.
--
-- The account/name/address are SNAPSHOTTED at save time (payee_*) so the QR-bill
-- stays stable even if the member later edits their IBAN/address. status is for a
-- future paid/cancelled lifecycle (defaults 'open'); no marking flow yet.
--
-- Schema-only + idempotent. Permissions in setup-permissions.mjs.

BEGIN;

CREATE TABLE IF NOT EXISTS finance_payouts (
  id                serial PRIMARY KEY,
  member            integer NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  amount            numeric(12,2),
  currency          varchar(8) NOT NULL DEFAULT 'CHF',
  message           varchar(140),
  iban              varchar(34) NOT NULL,
  payee_name        varchar(255),
  payee_address     varchar(255),
  payee_zip         varchar(10),
  payee_ort         varchar(100),
  status            varchar(16) NOT NULL DEFAULT 'open',
  created_by_name   varchar(255),
  created_by_email  varchar(255),
  date_created      timestamptz NOT NULL DEFAULT now(),
  user_created      uuid
);
CREATE INDEX IF NOT EXISTS finance_payouts_member_idx ON finance_payouts (member);

COMMENT ON TABLE finance_payouts IS
  'Reimbursements the club owes a member (club → member; opposite of finance_invoices). Saved by finance in the member explorer; visible to the member on My finances. payee_* snapshot the QR-bill creditor at save time.';

-- ── Directus admin metadata ────────────────────────────────────────────
INSERT INTO directus_collections (collection, icon, color, "group", sort, archive_app_filter)
SELECT 'finance_payouts', 'payments', '#059669', NULL, NULL, true
WHERE NOT EXISTS (SELECT 1 FROM directus_collections WHERE collection = 'finance_payouts');

INSERT INTO directus_fields (collection, field, special, interface, display, sort, width, note)
SELECT 'finance_payouts', 'member', 'm2o', 'select-dropdown-m2o', 'related-values', 1, 'half', 'Member being reimbursed.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_payouts' AND field = 'member');
INSERT INTO directus_fields (collection, field, interface, sort, width)
SELECT 'finance_payouts', 'amount', 'input', 2, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_payouts' AND field = 'amount');
INSERT INTO directus_fields (collection, field, interface, sort, width)
SELECT 'finance_payouts', 'message', 'input', 3, 'full'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_payouts' AND field = 'message');
INSERT INTO directus_fields (collection, field, interface, sort, width, note)
SELECT 'finance_payouts', 'iban', 'input', 4, 'half', 'Payee IBAN (snapshot at save time).'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_payouts' AND field = 'iban');
INSERT INTO directus_fields (collection, field, interface, sort, width)
SELECT 'finance_payouts', 'payee_name', 'input', 5, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_payouts' AND field = 'payee_name');
INSERT INTO directus_fields (collection, field, interface, sort, width)
SELECT 'finance_payouts', 'payee_address', 'input', 6, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_payouts' AND field = 'payee_address');
INSERT INTO directus_fields (collection, field, interface, sort, width)
SELECT 'finance_payouts', 'payee_zip', 'input', 7, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_payouts' AND field = 'payee_zip');
INSERT INTO directus_fields (collection, field, interface, sort, width)
SELECT 'finance_payouts', 'payee_ort', 'input', 8, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_payouts' AND field = 'payee_ort');
INSERT INTO directus_fields (collection, field, interface, options, sort, width)
SELECT 'finance_payouts', 'status', 'select-dropdown',
  '{"choices":[{"text":"Open","value":"open"},{"text":"Paid","value":"paid"},{"text":"Cancelled","value":"cancelled"}]}'::json, 9, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_payouts' AND field = 'status');
INSERT INTO directus_fields (collection, field, interface, readonly, sort, width)
SELECT 'finance_payouts', 'created_by_name', 'input', true, 10, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_payouts' AND field = 'created_by_name');
INSERT INTO directus_fields (collection, field, special, interface, readonly, hidden, sort)
SELECT 'finance_payouts', 'date_created', 'date-created', 'datetime', true, true, 90
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_payouts' AND field = 'date_created');
INSERT INTO directus_fields (collection, field, special, interface, readonly, hidden, sort)
SELECT 'finance_payouts', 'user_created', 'user-created', 'select-dropdown-m2o', true, true, 91
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_payouts' AND field = 'user_created');

INSERT INTO directus_relations (many_collection, many_field, one_collection, one_field, one_collection_field, one_allowed_collections, junction_field, sort_field, one_deselect_action)
SELECT 'finance_payouts', 'member', 'members', NULL, NULL, NULL, NULL, NULL, 'nullify'
WHERE NOT EXISTS (SELECT 1 FROM directus_relations WHERE many_collection = 'finance_payouts' AND many_field = 'member');

COMMIT;
