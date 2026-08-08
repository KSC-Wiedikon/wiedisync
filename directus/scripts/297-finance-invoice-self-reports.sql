-- Migration 297: Durable "I've paid" self-reports for ClubDesk-mirror invoices.
--
-- A member can already self-report a NATIVE invoice — it rides the shared
-- `status` column (open → pending_confirmation, migration 128). ClubDesk mirror
-- rows cannot use that: `status` holds ClubDesk's own German wording
-- ("Gestellt" / "Bezahlt" / "Storniert"), and — decisively — every mirror row is
-- DELETEd and re-INSERTed on each sync (import-clubdesk-finance.mjs step 5), so
-- anything written onto the row is gone by the next morning. Members would tap
-- "I've paid", watch their balance clear, and find the bill back the next day.
--
-- Same fix shape as migration 129's member-link overrides: keep the fact in a
-- side table keyed on the STABLE ClubDesk invoice [Id], and have the importer
-- re-apply it onto the freshly inserted mirror row (new step 5c). The report is
-- deleted again once ClubDesk itself reports the invoice settled — from then on
-- the mirror is the truth and the row shows "Bezahlt" on its own.
--
-- The re-applied values land in finance_invoices.reported_paid_at / _method /
-- _by (already there from 128), so one set of columns describes a self-report
-- regardless of which source the invoice came from.
--
-- Schema-only + idempotent. Permissions in setup-permissions.mjs.

BEGIN;

CREATE TABLE IF NOT EXISTS finance_invoice_self_reports (
  id                serial PRIMARY KEY,
  -- The ClubDesk invoice [Id] (finance_invoices.clubdesk_id) — survives the
  -- mirror's delete+reinsert, unlike finance_invoices.id which is re-keyed.
  match_clubdesk_id varchar(32) NOT NULL,
  member            integer NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  reported_at       timestamptz NOT NULL DEFAULT now(),
  method            varchar(32),
  reported_by_name  varchar(255),
  reported_by_email varchar(255),
  date_created      timestamptz NOT NULL DEFAULT now(),
  date_updated      timestamptz NOT NULL DEFAULT now()
);

-- One live self-report per invoice — the endpoint upserts on this.
CREATE UNIQUE INDEX IF NOT EXISTS finance_invoice_self_reports_clubdesk_uidx
  ON finance_invoice_self_reports (match_clubdesk_id);
CREATE INDEX IF NOT EXISTS finance_invoice_self_reports_member_idx
  ON finance_invoice_self_reports (member);

COMMENT ON TABLE finance_invoice_self_reports IS
  'Member "I have paid" self-reports for ClubDesk-mirror invoices. Keyed on the ClubDesk invoice [Id] so the report survives the nightly delete+reinsert; import-clubdesk-finance.mjs re-applies it onto finance_invoices.reported_paid_* (step 5c) and deletes it once ClubDesk reports the invoice settled. Native invoices do not use this table — they self-report on the status column.';

-- ── Directus admin metadata ────────────────────────────────────────────
INSERT INTO directus_collections (collection, icon, color, "group", sort, archive_app_filter)
SELECT 'finance_invoice_self_reports', 'price_check', '#059669', NULL, NULL, true
WHERE NOT EXISTS (SELECT 1 FROM directus_collections WHERE collection = 'finance_invoice_self_reports');

INSERT INTO directus_fields (collection, field, interface, sort, width, note)
SELECT 'finance_invoice_self_reports', 'match_clubdesk_id', 'input', 1, 'half', 'ClubDesk invoice [Id] this report belongs to.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_invoice_self_reports' AND field = 'match_clubdesk_id');
INSERT INTO directus_fields (collection, field, special, interface, display, sort, width, note)
SELECT 'finance_invoice_self_reports', 'member', 'm2o', 'select-dropdown-m2o', 'related-values', 2, 'half', 'Member who reported the payment.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_invoice_self_reports' AND field = 'member');
INSERT INTO directus_fields (collection, field, interface, readonly, sort, width, note)
SELECT 'finance_invoice_self_reports', 'reported_at', 'datetime', true, 3, 'half', 'When the member tapped "I have paid".'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_invoice_self_reports' AND field = 'reported_at');
INSERT INTO directus_fields (collection, field, interface, sort, width, note)
SELECT 'finance_invoice_self_reports', 'method', 'input', 4, 'half', 'twint / bank / cash / other.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_invoice_self_reports' AND field = 'method');
INSERT INTO directus_fields (collection, field, interface, readonly, sort, width, note)
SELECT 'finance_invoice_self_reports', 'reported_by_name', 'input', true, 5, 'half', 'Actor capture — who reported it.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_invoice_self_reports' AND field = 'reported_by_name');
INSERT INTO directus_fields (collection, field, interface, readonly, sort, width)
SELECT 'finance_invoice_self_reports', 'reported_by_email', 'input', true, 6, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_invoice_self_reports' AND field = 'reported_by_email');
INSERT INTO directus_fields (collection, field, special, interface, readonly, hidden, sort)
SELECT 'finance_invoice_self_reports', 'date_created', 'date-created', 'datetime', true, true, 90
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_invoice_self_reports' AND field = 'date_created');
INSERT INTO directus_fields (collection, field, special, interface, readonly, hidden, sort)
SELECT 'finance_invoice_self_reports', 'date_updated', 'date-updated', 'datetime', true, true, 91
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_invoice_self_reports' AND field = 'date_updated');

INSERT INTO directus_relations (many_collection, many_field, one_collection, one_field, one_collection_field, one_allowed_collections, junction_field, sort_field, one_deselect_action)
SELECT 'finance_invoice_self_reports', 'member', 'members', NULL, NULL, NULL, NULL, NULL, 'nullify'
WHERE NOT EXISTS (SELECT 1 FROM directus_relations WHERE many_collection = 'finance_invoice_self_reports' AND many_field = 'member');

COMMIT;
