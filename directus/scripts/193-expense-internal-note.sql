-- Migration 193: shared internal note on expense reimbursements.
--
-- A single back-office note per expense that finance, the section TK (vb_admin /
-- bb_admin), and admins all read AND write — the place they leave notes to each
-- other while a reimbursement is in flight ("waiting on the receipt", "partial
-- 200.- paid", "OK from BB budget"). Distinct from the two existing notes:
--   member_note   — the member's own note when submitting (migration 177).
--   finance_note  — finance's reply TO the member, shown next to the status
--                   (migration 177) — member-VISIBLE.
--   tk_note       — the TK's one-line note to the treasurer (migration 192).
-- internal_note is NEVER shown to the member: it is not in the member policy's
-- field scope on finance_expenses (setup-permissions.mjs), and the member-facing
-- MY_EXPENSE_FIELDS list does not request it.
--
-- Written from both back-office surfaces:
--   PATCH /kscw/expenses/:id           (finance / admin — Expenses tab)
--   POST  /kscw/expenses/:id/tk-confirm (section TK / finance — Confirm expenses)
-- Both are raw knex + writeUserLog. Registered in directus_fields so the items
-- API board reads it and the admin form can display it.
--
-- Schema-only + idempotent.

BEGIN;

ALTER TABLE finance_expenses ADD COLUMN IF NOT EXISTS internal_note varchar(1000);

-- Directus admin metadata (sort after tk_note = 23).
INSERT INTO directus_fields (collection, field, interface, sort, width, note)
SELECT 'finance_expenses', 'internal_note', 'input-multiline', 24, 'full',
  'Shared back-office note between finance, the section TK and admins. Never shown to the member.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_expenses' AND field = 'internal_note');

COMMIT;
