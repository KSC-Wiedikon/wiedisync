-- Migration 129: Manual member-link overrides for ClubDesk-mirror invoices.
--
-- The ClubDesk Rechnungen mirror matches a member by recipient email. ~48% of
-- rows are unmatched ("orphans") — mostly sponsors / passive / ex-members (no
-- member row, correctly unattributed), but some are real members billed under a
-- parent's email or a changed address. This table lets the treasurer link those
-- to the right member, and — crucially — the link SURVIVES the nightly
-- delete-and-reinsert sync, which would otherwise wipe a hand-set member FK.
--
-- Two key shapes (one per row, enforced by the CHECK):
--   * match_email      — links EVERY invoice to this recipient email (best for
--                        recurring membership dues to a parent's address).
--   * match_clubdesk_id — links one specific invoice (fallback for no-email rows).
-- The importer applies email overrides first, then per-invoice overrides
-- (migration touches code in import-clubdesk-finance.mjs).
--
-- Schema-only + idempotent. Permissions in setup-permissions.mjs.

BEGIN;

CREATE TABLE IF NOT EXISTS finance_invoice_member_overrides (
  id                serial PRIMARY KEY,
  match_email       varchar(255),
  match_clubdesk_id varchar(32),
  member            integer NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  reason            text,
  created_by_name   varchar(255),
  created_by_email  varchar(255),
  date_created      timestamptz NOT NULL DEFAULT now(),
  date_updated      timestamptz NOT NULL DEFAULT now(),
  user_created      uuid,
  user_updated      uuid,
  CONSTRAINT finance_invoice_member_overrides_key_check
    CHECK (match_email IS NOT NULL OR match_clubdesk_id IS NOT NULL)
);
-- One override per email / per invoice id (partial unique — NULLs don't collide).
CREATE UNIQUE INDEX IF NOT EXISTS finance_invoice_member_overrides_email_uidx
  ON finance_invoice_member_overrides (lower(match_email)) WHERE match_email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS finance_invoice_member_overrides_clubdesk_uidx
  ON finance_invoice_member_overrides (match_clubdesk_id) WHERE match_clubdesk_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS finance_invoice_member_overrides_member_idx
  ON finance_invoice_member_overrides (member);

COMMENT ON TABLE finance_invoice_member_overrides IS
  'Treasurer-set member links for ClubDesk-mirror invoices the email match missed. Re-applied by import-clubdesk-finance.mjs after every sync so manual links persist. match_email links all invoices to that recipient email; match_clubdesk_id links one invoice.';

-- ── Directus admin metadata ────────────────────────────────────────────
INSERT INTO directus_collections (collection, icon, color, "group", sort, archive_app_filter)
SELECT 'finance_invoice_member_overrides', 'link', '#059669', NULL, NULL, true
WHERE NOT EXISTS (SELECT 1 FROM directus_collections WHERE collection = 'finance_invoice_member_overrides');

INSERT INTO directus_fields (collection, field, interface, sort, width, note)
SELECT 'finance_invoice_member_overrides', 'match_email', 'input', 1, 'half', 'Recipient email this override links (links all that recipient''s invoices).'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_invoice_member_overrides' AND field = 'match_email');
INSERT INTO directus_fields (collection, field, interface, sort, width, note)
SELECT 'finance_invoice_member_overrides', 'match_clubdesk_id', 'input', 2, 'half', 'Single ClubDesk invoice [Id] (used when the invoice has no email).'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_invoice_member_overrides' AND field = 'match_clubdesk_id');
INSERT INTO directus_fields (collection, field, special, interface, display, sort, width, note)
SELECT 'finance_invoice_member_overrides', 'member', 'm2o', 'select-dropdown-m2o', 'related-values', 3, 'half', 'Member these invoices belong to.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_invoice_member_overrides' AND field = 'member');
INSERT INTO directus_fields (collection, field, interface, sort, width)
SELECT 'finance_invoice_member_overrides', 'reason', 'input-multiline', 4, 'full'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_invoice_member_overrides' AND field = 'reason');
INSERT INTO directus_fields (collection, field, interface, readonly, sort, width, note)
SELECT 'finance_invoice_member_overrides', 'created_by_name', 'input', true, 5, 'half', 'Who created the override.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_invoice_member_overrides' AND field = 'created_by_name');
INSERT INTO directus_fields (collection, field, interface, readonly, sort, width)
SELECT 'finance_invoice_member_overrides', 'created_by_email', 'input', true, 6, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_invoice_member_overrides' AND field = 'created_by_email');
INSERT INTO directus_fields (collection, field, special, interface, readonly, hidden, sort)
SELECT 'finance_invoice_member_overrides', 'date_created', 'date-created', 'datetime', true, true, 90
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_invoice_member_overrides' AND field = 'date_created');
INSERT INTO directus_fields (collection, field, special, interface, readonly, hidden, sort)
SELECT 'finance_invoice_member_overrides', 'date_updated', 'date-updated', 'datetime', true, true, 91
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_invoice_member_overrides' AND field = 'date_updated');
INSERT INTO directus_fields (collection, field, special, interface, readonly, hidden, sort)
SELECT 'finance_invoice_member_overrides', 'user_created', 'user-created', 'select-dropdown-m2o', true, true, 92
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_invoice_member_overrides' AND field = 'user_created');

INSERT INTO directus_relations (many_collection, many_field, one_collection, one_field, one_collection_field, one_allowed_collections, junction_field, sort_field, one_deselect_action)
SELECT 'finance_invoice_member_overrides', 'member', 'members', NULL, NULL, NULL, NULL, NULL, 'nullify'
WHERE NOT EXISTS (SELECT 1 FROM directus_relations WHERE many_collection = 'finance_invoice_member_overrides' AND many_field = 'member');

COMMIT;
