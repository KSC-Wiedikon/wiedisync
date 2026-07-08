-- Migration 192: TK (Sport Admin) confirmation on expense reimbursements.
--
-- Each section's TK (Technische Kommission = Sport Admin, roles vb_admin /
-- bb_admin) confirms that a member's reimbursement is budgeted and can be paid,
-- and tells the treasurer whether the section has ALREADY reimbursed the member
-- (out of its own petty cash) so the club treasury shouldn't pay it a second time.
-- Purely informational: it never blocks the treasurer's paid/rejected lifecycle,
-- and it touches nothing the ClubDesk finance mirror reads or writes.
--
-- New finance_expenses columns:
--   section              — vb | bb | club, derived at submit from the submitter's
--                          members.sektion (Volleyball→vb, Basketball→bb, else
--                          club). Routes the row to the right section's TK queue.
--   member_already_paid  — the submitting member ticked "Already paid?" (they paid
--                          the underlying bill out of pocket). Member-facing flag.
--   tk_confirmed_at      — when the section TK confirmed (null = awaiting TK).
--   tk_confirmed_by_name/email — actor capture for the confirmation (CLAUDE.md rule).
--   tk_already_paid      — TK toggle: the section has already reimbursed the member.
--   tk_note              — free note from the TK to the treasurer.
--
-- Writes go through /kscw/expenses/tk-confirm (raw knex + writeUserLog), not the
-- items API. Registered in directus_fields so the items-API board reads + admin
-- forms can display them.
--
-- Schema-only + idempotent.

BEGIN;

ALTER TABLE finance_expenses ADD COLUMN IF NOT EXISTS section varchar(8);
ALTER TABLE finance_expenses ADD COLUMN IF NOT EXISTS member_already_paid boolean NOT NULL DEFAULT false;
ALTER TABLE finance_expenses ADD COLUMN IF NOT EXISTS tk_confirmed_at timestamptz;
ALTER TABLE finance_expenses ADD COLUMN IF NOT EXISTS tk_confirmed_by_name varchar(255);
ALTER TABLE finance_expenses ADD COLUMN IF NOT EXISTS tk_confirmed_by_email varchar(255);
ALTER TABLE finance_expenses ADD COLUMN IF NOT EXISTS tk_already_paid boolean NOT NULL DEFAULT false;
ALTER TABLE finance_expenses ADD COLUMN IF NOT EXISTS tk_note varchar(1000);

-- section is a small closed set (mirrors finance_accounts.division). Add the check
-- once, idempotently.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'finance_expenses_section_check'
  ) THEN
    ALTER TABLE finance_expenses
      ADD CONSTRAINT finance_expenses_section_check
      CHECK (section IS NULL OR section IN ('vb', 'bb', 'club'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS finance_expenses_section_idx ON finance_expenses (section);

-- Backfill section for existing rows from the submitter's ClubDesk Sektion.
UPDATE finance_expenses e
SET section = CASE
    WHEN m.sektion = 'Volleyball' THEN 'vb'
    WHEN m.sektion = 'Basketball' THEN 'bb'
    ELSE 'club'
  END
FROM members m
WHERE e.member = m.id AND e.section IS NULL;

-- ── Directus admin metadata (sort after the existing finance-side fields) ──────
INSERT INTO directus_fields (collection, field, interface, options, sort, width, note)
SELECT 'finance_expenses', 'section', 'select-dropdown',
  '{"choices":[{"text":"Volleyball","value":"vb"},{"text":"Basketball","value":"bb"},{"text":"Club","value":"club"}]}'::json,
  17, 'half', 'Sport section (derived from the submitter''s Sektion). Routes to that section''s TK.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_expenses' AND field = 'section');

INSERT INTO directus_fields (collection, field, special, interface, sort, width, note)
SELECT 'finance_expenses', 'member_already_paid', 'cast-boolean', 'boolean', 18, 'half',
  'Member ticked "Already paid?" — they paid the underlying bill out of pocket.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_expenses' AND field = 'member_already_paid');

INSERT INTO directus_fields (collection, field, interface, readonly, sort, width, note)
SELECT 'finance_expenses', 'tk_confirmed_at', 'datetime', true, 19, 'half',
  'When the section TK confirmed the reimbursement (null = awaiting TK).'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_expenses' AND field = 'tk_confirmed_at');

INSERT INTO directus_fields (collection, field, interface, readonly, sort, width)
SELECT 'finance_expenses', 'tk_confirmed_by_name', 'input', true, 20, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_expenses' AND field = 'tk_confirmed_by_name');

INSERT INTO directus_fields (collection, field, interface, readonly, sort, width)
SELECT 'finance_expenses', 'tk_confirmed_by_email', 'input', true, 21, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_expenses' AND field = 'tk_confirmed_by_email');

INSERT INTO directus_fields (collection, field, special, interface, sort, width, note)
SELECT 'finance_expenses', 'tk_already_paid', 'cast-boolean', 'boolean', 22, 'half',
  'TK toggle: the section has already reimbursed the member (treasury should not pay again).'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_expenses' AND field = 'tk_already_paid');

INSERT INTO directus_fields (collection, field, interface, sort, width, note)
SELECT 'finance_expenses', 'tk_note', 'input-multiline', 23, 'full',
  'Note from the section TK to the treasurer.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_expenses' AND field = 'tk_note');

COMMIT;
