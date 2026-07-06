-- Migration 177: expense reimbursement submissions (in-app queue).
--
-- Until now /finance/expense was email-only: the member's upload was mailed to
-- the finance inbox and nothing was persisted, so the uploader had no status
-- view and finance had no in-app queue. This table gives every submission a
-- lifecycle: pending → paid | rejected.
--
--   * Member submits via POST /kscw/expenses/submit (row + email side channel).
--   * Member reads own rows (items API, OWN_MEMBER — setup-permissions.mjs).
--   * Finance reads all rows (items API) but WRITES only through
--     PATCH /kscw/expenses/:id (canManageFinance-gated) so the status-change
--     side effects (member notification, auto-payout) always fire.
--   * On status → paid the endpoint auto-creates the linked finance_payouts
--     record (QR-bill snapshot, migration 137) and stores the link in `payout`.
--
-- Schema-only + idempotent. Permissions in setup-permissions.mjs.

BEGIN;

CREATE TABLE IF NOT EXISTS finance_expenses (
  id                       serial PRIMARY KEY,
  -- RESTRICT (not CASCADE): an expense submission is a financial audit record
  -- with amount/IBAN/actor — deleting a member must not silently erase it, same
  -- rule migration 174 applied to finance_payouts.member.
  member                   integer NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  file                     uuid REFERENCES directus_files(id) ON DELETE SET NULL,
  amount                   numeric(12,2) NOT NULL,
  currency                 varchar(8) NOT NULL DEFAULT 'CHF',
  expense_date             date,
  vendor                   varchar(200),
  description              varchar(300),
  reference                varchar(140),
  pay_to_iban              varchar(34),
  member_note              varchar(1000),
  status                   varchar(16) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'rejected')),
  finance_note             varchar(1000),
  payout                   integer REFERENCES finance_payouts(id) ON DELETE SET NULL,
  status_changed_by_name   varchar(255),
  status_changed_by_email  varchar(255),
  status_changed_at        timestamptz,
  date_created             timestamptz NOT NULL DEFAULT now(),
  user_created             uuid
);
CREATE INDEX IF NOT EXISTS finance_expenses_member_idx ON finance_expenses (member);
CREATE INDEX IF NOT EXISTS finance_expenses_status_idx ON finance_expenses (status);

COMMENT ON TABLE finance_expenses IS
  'Expense reimbursement submissions from /finance/expense (member paid out of pocket, wants money back). pending → paid | rejected; on paid the endpoint auto-creates the linked finance_payouts row. Writes go through /kscw/expenses/* endpoints, not the items API.';

-- ── Directus admin metadata ────────────────────────────────────────────
INSERT INTO directus_collections (collection, icon, color, "group", sort, archive_app_filter)
SELECT 'finance_expenses', 'receipt_long', '#d97706', NULL, NULL, true
WHERE NOT EXISTS (SELECT 1 FROM directus_collections WHERE collection = 'finance_expenses');

INSERT INTO directus_fields (collection, field, special, interface, display, sort, width, note)
SELECT 'finance_expenses', 'member', 'm2o', 'select-dropdown-m2o', 'related-values', 1, 'half', 'Member requesting reimbursement.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_expenses' AND field = 'member');
INSERT INTO directus_fields (collection, field, special, interface, sort, width, note)
SELECT 'finance_expenses', 'file', 'file', 'file', 2, 'half', 'The uploaded receipt/invoice (directus_files).'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_expenses' AND field = 'file');
INSERT INTO directus_fields (collection, field, interface, sort, width)
SELECT 'finance_expenses', 'amount', 'input', 3, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_expenses' AND field = 'amount');
INSERT INTO directus_fields (collection, field, interface, sort, width)
SELECT 'finance_expenses', 'currency', 'input', 4, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_expenses' AND field = 'currency');
INSERT INTO directus_fields (collection, field, interface, sort, width)
SELECT 'finance_expenses', 'expense_date', 'datetime', 5, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_expenses' AND field = 'expense_date');
INSERT INTO directus_fields (collection, field, interface, sort, width)
SELECT 'finance_expenses', 'vendor', 'input', 6, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_expenses' AND field = 'vendor');
INSERT INTO directus_fields (collection, field, interface, sort, width)
SELECT 'finance_expenses', 'description', 'input', 7, 'full'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_expenses' AND field = 'description');
INSERT INTO directus_fields (collection, field, interface, sort, width)
SELECT 'finance_expenses', 'reference', 'input', 8, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_expenses' AND field = 'reference');
INSERT INTO directus_fields (collection, field, interface, sort, width, note)
SELECT 'finance_expenses', 'pay_to_iban', 'input', 9, 'half', 'Where the member wants the reimbursement sent.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_expenses' AND field = 'pay_to_iban');
INSERT INTO directus_fields (collection, field, interface, sort, width)
SELECT 'finance_expenses', 'member_note', 'input-multiline', 10, 'full'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_expenses' AND field = 'member_note');
INSERT INTO directus_fields (collection, field, interface, options, sort, width)
SELECT 'finance_expenses', 'status', 'select-dropdown',
  '{"choices":[{"text":"Pending","value":"pending"},{"text":"Paid","value":"paid"},{"text":"Rejected","value":"rejected"}]}'::json, 11, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_expenses' AND field = 'status');
INSERT INTO directus_fields (collection, field, interface, sort, width, note)
SELECT 'finance_expenses', 'finance_note', 'input-multiline', 12, 'full', 'Visible to the member (shown with the status).'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_expenses' AND field = 'finance_note');
INSERT INTO directus_fields (collection, field, special, interface, display, readonly, sort, width, note)
SELECT 'finance_expenses', 'payout', 'm2o', 'select-dropdown-m2o', 'related-values', true, 13, 'half', 'Auto-created finance_payouts row (set when marked paid).'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_expenses' AND field = 'payout');
INSERT INTO directus_fields (collection, field, interface, readonly, sort, width)
SELECT 'finance_expenses', 'status_changed_by_name', 'input', true, 14, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_expenses' AND field = 'status_changed_by_name');
INSERT INTO directus_fields (collection, field, interface, readonly, sort, width)
SELECT 'finance_expenses', 'status_changed_by_email', 'input', true, 15, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_expenses' AND field = 'status_changed_by_email');
INSERT INTO directus_fields (collection, field, interface, readonly, sort, width)
SELECT 'finance_expenses', 'status_changed_at', 'datetime', true, 16, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_expenses' AND field = 'status_changed_at');
INSERT INTO directus_fields (collection, field, special, interface, readonly, hidden, sort)
SELECT 'finance_expenses', 'date_created', 'date-created', 'datetime', true, true, 90
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_expenses' AND field = 'date_created');
INSERT INTO directus_fields (collection, field, special, interface, readonly, hidden, sort)
SELECT 'finance_expenses', 'user_created', 'user-created', 'select-dropdown-m2o', true, true, 91
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_expenses' AND field = 'user_created');

INSERT INTO directus_relations (many_collection, many_field, one_collection, one_deselect_action)
SELECT 'finance_expenses', 'member', 'members', 'nullify'
WHERE NOT EXISTS (SELECT 1 FROM directus_relations WHERE many_collection = 'finance_expenses' AND many_field = 'member');
INSERT INTO directus_relations (many_collection, many_field, one_collection, one_deselect_action)
SELECT 'finance_expenses', 'file', 'directus_files', 'nullify'
WHERE NOT EXISTS (SELECT 1 FROM directus_relations WHERE many_collection = 'finance_expenses' AND many_field = 'file');
INSERT INTO directus_relations (many_collection, many_field, one_collection, one_deselect_action)
SELECT 'finance_expenses', 'payout', 'finance_payouts', 'nullify'
WHERE NOT EXISTS (SELECT 1 FROM directus_relations WHERE many_collection = 'finance_expenses' AND many_field = 'payout');

COMMIT;
