-- Migration 254: finance integrity — stable camt match links, undeletable
-- fiscal years, real money types on referee_expenses, and enum guardrails.
--
-- DB review 2026-07-27 (FIN-01/03/05/06/07/08/10/11). Live counts at review
-- time: finance_payments 0 rows, finance_team_entries 0, referee_expenses 0,
-- finance_payouts 1 ('paid'/'CHF'), finance_expenses 2 (both 'CHF'),
-- finance_invoices 954 (all source='clubdesk'), finance_transactions 754 (all
-- clubdesk, ref_kind NULL) — every CHECK and FK below validates cleanly against
-- both live data and the endpoint code's literals.
--
-- Deliberately left alone (FIN-11): finance_dues_runs.total_amount,
-- finance_dues_rates.amount_chf, finance_dunning_notices.reminder_fee and
-- finance_transactions.amount_chf stay currency-column-free (CHF is in the
-- name/contract), fines/fine_rules are already varchar(3) DEFAULT 'CHF', and
-- finance_payments.currency stays nullable with no default on purpose (raw bank
-- value from the camt entry — see its new comment).
--
-- Schema + comments + directus_fields metadata. Idempotent.

BEGIN;

-- ── 1. FIN-01: camt match links must survive the ClubDesk finance sync ──────
-- finance_payments.clubdesk_guess is an id FK ON DELETE SET NULL, but the
-- nightly sync re-keys every mirror invoice (DELETE source='clubdesk' +
-- re-insert with fresh serials) — so any camt match link died within 24h while
-- match_status kept claiming a match. Snapshot the STABLE ClubDesk id instead,
-- the same pattern finance_invoice_documents / finance_invoice_member_overrides
-- already use; the importer re-points clubdesk_guess from it after each sync.

ALTER TABLE finance_payments ADD COLUMN IF NOT EXISTS match_clubdesk_id varchar(32);

COMMENT ON COLUMN finance_payments.match_clubdesk_id IS
  'Stable ClubDesk id of the matched/guessed mirror invoice. clubdesk_guess is an id FK and every ClubDesk finance sync re-keys the mirror (delete+reinsert → SET NULL), so the importer re-points clubdesk_guess from this snapshot; when the invoice vanished from ClubDesk it flips match_status to ''link_lost''.';

CREATE INDEX IF NOT EXISTS finance_payments_match_clubdesk_id_idx
  ON finance_payments (match_clubdesk_id) WHERE match_clubdesk_id IS NOT NULL;

INSERT INTO directus_fields (collection, field, interface, readonly, sort, width, note)
SELECT 'finance_payments', 'match_clubdesk_id', 'input', true, 94, 'half',
  'Stable ClubDesk id snapshot of the matched invoice — survives the mirror''s delete+reinsert (the clubdesk_guess FK does not).'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_payments' AND field = 'match_clubdesk_id');

-- ── 2. FIN-03: fiscal-year FK delete rules destroyed the books' anchoring ───
-- One Directus-admin delete of a finance_fiscal_years row CASCADE-deleted the
-- dues audit trail (dues_runs → email_jobs) and treasurer-entered dues_rates,
-- SET-NULLed every transaction/invoice out of the year (FY reports silently
-- shrink), and — worst — orphaned native ledger rows past the closed-year
-- immutability trigger (fiscal_year NULL → status lookup finds no row → not
-- 'closed' → a sealed book reopens). Re-point the four audit-bearing FKs to
-- RESTRICT, 149-style (drop whatever FK constrains the column, re-add by our
-- name). budget_lines stays CASCADE (derived data), team_entries stays SET NULL.

DO $$
DECLARE cname text;
BEGIN
  SELECT con.conname INTO cname
    FROM pg_constraint con
   WHERE con.conrelid = 'finance_dues_runs'::regclass
     AND con.contype = 'f'
     AND con.conkey = ARRAY[(SELECT attnum FROM pg_attribute
                              WHERE attrelid = 'finance_dues_runs'::regclass
                                AND attname = 'fiscal_year')]::smallint[];
  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE finance_dues_runs DROP CONSTRAINT %I', cname);
  END IF;
  ALTER TABLE finance_dues_runs
    ADD CONSTRAINT finance_dues_runs_fiscal_year_fk
    FOREIGN KEY (fiscal_year) REFERENCES finance_fiscal_years(id) ON DELETE RESTRICT;
END $$;

DO $$
DECLARE cname text;
BEGIN
  SELECT con.conname INTO cname
    FROM pg_constraint con
   WHERE con.conrelid = 'finance_dues_rates'::regclass
     AND con.contype = 'f'
     AND con.conkey = ARRAY[(SELECT attnum FROM pg_attribute
                              WHERE attrelid = 'finance_dues_rates'::regclass
                                AND attname = 'fiscal_year')]::smallint[];
  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE finance_dues_rates DROP CONSTRAINT %I', cname);
  END IF;
  ALTER TABLE finance_dues_rates
    ADD CONSTRAINT finance_dues_rates_fiscal_year_fk
    FOREIGN KEY (fiscal_year) REFERENCES finance_fiscal_years(id) ON DELETE RESTRICT;
END $$;

DO $$
DECLARE cname text;
BEGIN
  SELECT con.conname INTO cname
    FROM pg_constraint con
   WHERE con.conrelid = 'finance_transactions'::regclass
     AND con.contype = 'f'
     AND con.conkey = ARRAY[(SELECT attnum FROM pg_attribute
                              WHERE attrelid = 'finance_transactions'::regclass
                                AND attname = 'fiscal_year')]::smallint[];
  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE finance_transactions DROP CONSTRAINT %I', cname);
  END IF;
  ALTER TABLE finance_transactions
    ADD CONSTRAINT finance_transactions_fiscal_year_fk
    FOREIGN KEY (fiscal_year) REFERENCES finance_fiscal_years(id) ON DELETE RESTRICT;
END $$;

DO $$
DECLARE cname text;
BEGIN
  SELECT con.conname INTO cname
    FROM pg_constraint con
   WHERE con.conrelid = 'finance_invoices'::regclass
     AND con.contype = 'f'
     AND con.conkey = ARRAY[(SELECT attnum FROM pg_attribute
                              WHERE attrelid = 'finance_invoices'::regclass
                                AND attname = 'fiscal_year')]::smallint[];
  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE finance_invoices DROP CONSTRAINT %I', cname);
  END IF;
  ALTER TABLE finance_invoices
    ADD CONSTRAINT finance_invoices_fiscal_year_fk
    FOREIGN KEY (fiscal_year) REFERENCES finance_fiscal_years(id) ON DELETE RESTRICT;
END $$;

-- Harden the immutability trigger (migrations 151/164) against the NULL hole:
-- a native ledger row without a fiscal year could never be locked, because the
-- status lookup finds no row and 'closed' never matches. No write path creates
-- one (autopost skips 'no-fiscal-year', the manual-entry and reversal endpoints
-- always stamp fiscal_year), so refuse it at the trigger. Only the TARGET (NEW)
-- side is guarded — a legacy NULL row, should one ever appear, stays repairable
-- by pointing it INTO an open year.

CREATE OR REPLACE FUNCTION finance_native_txn_lock() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE new_status text; DECLARE old_status text;
BEGIN
  -- Target year (INSERT/UPDATE): cannot write into a closed year — and a native
  -- row must HAVE a year, else the closed-year check can never apply to it.
  IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.source = 'native' THEN
    IF NEW.fiscal_year IS NULL THEN
      RAISE EXCEPTION 'A native ledger entry must carry a fiscal year — a year-less row can never be locked by the year-end close';
    END IF;
    SELECT status INTO new_status FROM finance_fiscal_years WHERE id = NEW.fiscal_year;
    IF new_status = 'closed' THEN
      RAISE EXCEPTION 'Cannot % a native ledger entry in a closed fiscal year — post a reversal in an open year instead', lower(TG_OP);
    END IF;
  END IF;
  -- Current year (UPDATE/DELETE): cannot touch a row that belongs to a closed
  -- year — this is what blocks the fiscal_year re-point bypass.
  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.source = 'native' THEN
    SELECT status INTO old_status FROM finance_fiscal_years WHERE id = OLD.fiscal_year;
    IF old_status = 'closed' THEN
      RAISE EXCEPTION 'Cannot % a native ledger entry that belongs to a closed fiscal year — post a reversal in an open year instead', lower(TG_OP);
    END IF;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

-- ── 3. FIN-05: referee_expenses — the only floating-point money in the DB ───
-- amount was real (float4: CHF 152.30 is not representable, sums drift) and
-- game/team/paid_by_member/recorded_by were bare integers with no FKs. 0 rows
-- live, so both fixes are free. Repairs first so ADD CONSTRAINT cannot fail on
-- a DB where orphans do exist (e.g. a stale dev clone). paid_by_member is
-- RESTRICT — the row is money the club owes back, same rule as
-- finance_expenses.member / finance_payouts.member; the rest are SET NULL.

ALTER TABLE referee_expenses ALTER COLUMN amount TYPE numeric(10,2) USING amount::numeric(10,2);
ALTER TABLE referee_expenses ADD COLUMN IF NOT EXISTS currency varchar(3) NOT NULL DEFAULT 'CHF';

UPDATE referee_expenses re SET game = NULL
 WHERE re.game IS NOT NULL AND NOT EXISTS (SELECT 1 FROM games g WHERE g.id = re.game);
UPDATE referee_expenses re SET team = NULL
 WHERE re.team IS NOT NULL AND NOT EXISTS (SELECT 1 FROM teams t WHERE t.id = re.team);
UPDATE referee_expenses re SET paid_by_member = NULL
 WHERE re.paid_by_member IS NOT NULL AND NOT EXISTS (SELECT 1 FROM members m WHERE m.id = re.paid_by_member);
UPDATE referee_expenses re SET recorded_by = NULL
 WHERE re.recorded_by IS NOT NULL AND NOT EXISTS (SELECT 1 FROM members m WHERE m.id = re.recorded_by);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'referee_expenses_game_fk') THEN
    ALTER TABLE referee_expenses ADD CONSTRAINT referee_expenses_game_fk
      FOREIGN KEY (game) REFERENCES games(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'referee_expenses_team_fk') THEN
    ALTER TABLE referee_expenses ADD CONSTRAINT referee_expenses_team_fk
      FOREIGN KEY (team) REFERENCES teams(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'referee_expenses_paid_by_member_fk') THEN
    ALTER TABLE referee_expenses ADD CONSTRAINT referee_expenses_paid_by_member_fk
      FOREIGN KEY (paid_by_member) REFERENCES members(id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'referee_expenses_recorded_by_fk') THEN
    ALTER TABLE referee_expenses ADD CONSTRAINT referee_expenses_recorded_by_fk
      FOREIGN KEY (recorded_by) REFERENCES members(id) ON DELETE SET NULL;
  END IF;
END $$;

INSERT INTO directus_fields (collection, field, interface, sort, width)
SELECT 'referee_expenses', 'currency', 'input', 11, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'referee_expenses' AND field = 'currency');

-- ── 4. FIN-06: native invoice status — constrain the machine's vocabulary ───
-- finance_invoices.status carries two vocabularies on one column BY DESIGN:
-- the native English lifecycle (endpoint constants) and ClubDesk's German free
-- text (Bezahlt / Storniert / 'Bezahlt (teilw. abgeschrieben)' / …, an evolving
-- set the mirror import must NEVER be CHECK-blocked on). Scope the CHECK to
-- source='native' only — same approach as finance_transactions.typ.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'finance_invoices_native_status_check') THEN
    ALTER TABLE finance_invoices ADD CONSTRAINT finance_invoices_native_status_check
      CHECK (source <> 'native' OR status IN ('open', 'pending_confirmation', 'partial', 'paid', 'cancelled'));
  END IF;
END $$;

-- ── 5. FIN-07: payout status — the three-value lifecycle, enforced ──────────
-- open (default) / paid (expense-upload auto-payout) / cancelled (paid→not-paid
-- mis-click correction). finance_expenses got the analogous CHECK in migration
-- 177; payouts — also editable via the items API from the member explorer —
-- never did. Live: 1 row, 'paid'.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'finance_payouts_status_check') THEN
    ALTER TABLE finance_payouts ADD CONSTRAINT finance_payouts_status_check
      CHECK (status IN ('open', 'paid', 'cancelled'));
  END IF;
END $$;

-- ── 6. FIN-08: match_status / ref_kind — align docs with the code, add CHECKs ─
-- finance-camt.js writes 'clubdesk_match' (confident number-match) and the
-- sync's re-link step now writes 'link_lost'; neither was in the migration-131
-- comment or dropdown. finance-autopost.js writes 'settle_over' and 'round' on
-- top of the documented issue|settle|team. Update both comments + the dropdown
-- and add CHECKs so the next vocabulary drift fails loudly instead of silently.

COMMENT ON COLUMN finance_payments.match_status IS
  'How the camt credit was reconciled: native (matched a native invoice by SCOR/QRR ref → auto-confirmed) | clubdesk_match (matched a ClubDesk invoice by number, cross-check only) | clubdesk_guess (fuzzy candidate flagged, NOT applied) | unmatched | link_lost (the matched ClubDesk invoice vanished from a later sync).';

UPDATE directus_fields SET options =
  '{"choices":[{"text":"Native (auto-confirmed)","value":"native"},{"text":"ClubDesk match (by number)","value":"clubdesk_match"},{"text":"ClubDesk guess","value":"clubdesk_guess"},{"text":"Unmatched","value":"unmatched"},{"text":"Link lost (invoice gone)","value":"link_lost"}]}'::json
WHERE collection = 'finance_payments' AND field = 'match_status';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'finance_payments_match_status_check') THEN
    ALTER TABLE finance_payments ADD CONSTRAINT finance_payments_match_status_check
      CHECK (match_status IS NULL OR match_status IN ('native', 'clubdesk_match', 'clubdesk_guess', 'unmatched', 'link_lost'));
  END IF;
END $$;

COMMENT ON COLUMN finance_transactions.ref_kind IS
  'Auto-post link: issue | settle | settle_over (overpayment/prepayment leg) | round (≤1-rappen residual forgiveness) | team (the A/R or team-ledger event that produced this journal entry). NULL on ClubDesk-mirror and manual rows.';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'finance_transactions_ref_kind_check') THEN
    ALTER TABLE finance_transactions ADD CONSTRAINT finance_transactions_ref_kind_check
      CHECK (ref_kind IS NULL OR ref_kind IN ('issue', 'settle', 'settle_over', 'round', 'team'));
  END IF;
END $$;

-- ── 7. FIN-10: import provenance — label is display-only, checksum is queryable ─
-- fiscal_year_label pretends to be a link but 64 of 66 live rows hold a range
-- string ('2021/22–2026/27') that joins to nothing; say so. source_checksum was
-- never written and never indexed; the importer now fills it (sha256) and warns
-- when the previous batch of the same type is byte-identical.

COMMENT ON COLUMN finance_imports.fiscal_year_label IS
  'DISPLAY-ONLY fiscal-year hint — a single label or a compact earliest–latest range (''2021/22–2026/27''); intentionally NOT a join key to finance_fiscal_years.';

COMMENT ON COLUMN finance_imports.source_checksum IS
  'sha256 of the imported file. Importers warn (never abort) when the previous batch of the same import_type carries the same checksum — a double-import is idempotent for the mirrors but pollutes provenance.';

CREATE INDEX IF NOT EXISTS finance_imports_type_checksum_idx
  ON finance_imports (import_type, source_checksum);

-- ── 8. FIN-11: currency — one shape for what exists, homes for what's missing ─
-- Standardise on char-3 ISO 4217: invoices + team entries (the operator-entered
-- money tables) get a currency column, expenses/payouts shrink varchar(8)→(3)
-- (live values are all 'CHF'; the endpoints already slice to 3). payments stays
-- untouched — see the header note and its comment below.

ALTER TABLE finance_expenses ALTER COLUMN currency TYPE varchar(3);
ALTER TABLE finance_payouts  ALTER COLUMN currency TYPE varchar(3);
ALTER TABLE finance_invoices     ADD COLUMN IF NOT EXISTS currency varchar(3) NOT NULL DEFAULT 'CHF';
ALTER TABLE finance_team_entries ADD COLUMN IF NOT EXISTS currency varchar(3) NOT NULL DEFAULT 'CHF';

COMMENT ON COLUMN finance_payments.currency IS
  'Raw currency of the bank credit as reported by the camt entry — intentionally nullable with no default (a missing value must stay visibly missing, never masquerade as CHF; finance-camt.js skips non-CHF credits before matching).';

INSERT INTO directus_fields (collection, field, interface, sort, width)
SELECT 'finance_invoices', 'currency', 'input', 94, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_invoices' AND field = 'currency');
INSERT INTO directus_fields (collection, field, interface, sort, width)
SELECT 'finance_team_entries', 'currency', 'input', 91, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_team_entries' AND field = 'currency');

-- ── 9. FIN-04 (doc note only): members.billing_* does NOT drive invoices ────
-- Migration 133's comment promised these columns are 'used as the invoice
-- recipient for native invoices' — they never were: POST /finance/invoices and
-- the dues cohort stamp the member's OWN name/email, and the sole reader is the
-- expense-payout QR snapshot (expense-upload.js). The columns stay on members
-- (members-reorg decision); correct the record so nobody trusts the old claim.

COMMENT ON COLUMN members.billing_different IS
  'When true, the EXPENSE-PAYOUT QR snapshot pays out to the billing_* contact (IBAN/name/address) instead of the member''s own. NOT consulted by native invoices or dues runs — those stamp the member''s own name/email (see finance_billing_contacts + invoice recipient_* for that path).';

UPDATE directus_fields SET note =
  'Pay expense reimbursements to an alternate contact (guardian / company). Not consulted by invoices or dues — those bill the member directly.'
WHERE collection = 'members' AND field = 'billing_different';

COMMIT;
