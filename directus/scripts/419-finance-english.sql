-- Migration 419: the finance tables in English (phase 3 of the English-only DB
-- migration, plan: .planning/english-db-migration.md). The fee category, the
-- dues schedule's values and the income-account map moved in 417; this is the
-- rest of finance.
--
-- Column names
--   finance_invoices      cd_benutzer_id → cd_user_id, recipient_zip → recipient_postal_code,
--                         dunning_status dropped (dunning_level carries the level)
--   finance_transactions  typ → entry_type, beleg → voucher_no
--   finance_ledger_settings  debitoren_account → receivables_account
--   finance_billing_contacts plz / ort → postal_code / city
--   finance_payouts       payee_zip / payee_ort → payee_postal_code / payee_city
--   finance_dues_rates    sektion → club_section (its values became slugs in 417)
--
-- Values (clubdesk_value_map is the dictionary; the finance importer stages
-- slugs through cd_to_app from now on)
--   finance_invoices.status on ClubDesk mirror rows → the native vocabulary
--     where the meaning is the same: Gestellt → open, Teilweise bezahlt → partial,
--     Bezahlt → paid, Storniert → cancelled; ClubDesk-only states:
--     Bezahlt (teilw. abgeschrieben) → paid_partially_written_off,
--     Abgeschrieben → written_off, Entwurf → draft. The value map's 412 slugs
--     issued / partially_paid are renamed to open / partial to match.
--     One CHECK now covers every row (the native one stays as the narrower rule).
--   finance_invoices.dunning_status ('1. Mahnung', native 'Mahnung 1') → its
--     number into dunning_level first (ClubDesk rows had 0 there), then dropped.
--   finance_invoices.payment_method  QR-Rechnung ohne Referenz → qr_bill_no_reference
--     (new value-map domain payment_method).
--   finance_transactions.entry_type  Standard → standard, Rechnung → invoice,
--     Rechnung (Sammel) → invoice_collective, Rechnung (Sammelposition) →
--     invoice_collective_item, Eröffnung AND native Eroeffnung → opening,
--     Abschluss → closing, Storno → reversal. CHECK added.
--
-- Pages, PDFs, exports and emails keep printing the ClubDesk wording
-- (finance-values.js). Amounts, accounts and dates are untouched: every
-- balance, the trial balance and the parallel-run compare come out the same.
--
-- Order matters: refresh_members_dues_paid() (fired per statement on
-- finance_invoices) is recreated BEFORE the one UPDATE that converts the
-- invoice values, so the members' dues flags never flip in between. The
-- closed-year lock on finance_transactions is lifted for the vocabulary UPDATE
-- only (it would refuse to touch a native row of a closed year).
--
-- Schema + data + Directus metadata only; permissions follow from
-- setup-permissions.mjs. Idempotent.

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.rename_col(p_table text, p_old text, p_new text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = p_table AND column_name = p_old)
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = p_table AND column_name = p_new) THEN
    EXECUTE format('ALTER TABLE public.%I RENAME COLUMN %I TO %I', p_table, p_old, p_new);
  END IF;
  UPDATE directus_fields SET field = p_new WHERE collection = p_table AND field = p_old;
  UPDATE directus_relations SET many_field = p_new WHERE many_collection = p_table AND many_field = p_old;
  -- Saved Data Studio layouts / filters on the table.
  UPDATE directus_presets
     SET layout_query = CASE WHEN layout_query IS NULL THEN NULL
                        ELSE replace(layout_query::text, format('"%s"', p_old), format('"%s"', p_new))::json END,
         filter       = CASE WHEN filter IS NULL THEN NULL
                        ELSE replace(filter::text, format('"%s"', p_old), format('"%s"', p_new))::json END
   WHERE collection = p_table
     AND (strpos(COALESCE(layout_query::text, ''), format('"%s"', p_old)) > 0
       OR strpos(COALESCE(filter::text, ''), format('"%s"', p_old)) > 0);
END $$;

-- ── 1. Column names ──────────────────────────────────────────────────────────
SELECT pg_temp.rename_col('finance_invoices',         'cd_benutzer_id',    'cd_user_id');
SELECT pg_temp.rename_col('finance_invoices',         'recipient_zip',     'recipient_postal_code');
SELECT pg_temp.rename_col('finance_transactions',     'typ',               'entry_type');
SELECT pg_temp.rename_col('finance_transactions',     'beleg',             'voucher_no');
SELECT pg_temp.rename_col('finance_ledger_settings',  'debitoren_account', 'receivables_account');
SELECT pg_temp.rename_col('finance_billing_contacts', 'plz',               'postal_code');
SELECT pg_temp.rename_col('finance_billing_contacts', 'ort',               'city');
SELECT pg_temp.rename_col('finance_payouts',          'payee_zip',         'payee_postal_code');
SELECT pg_temp.rename_col('finance_payouts',          'payee_ort',         'payee_city');
SELECT pg_temp.rename_col('finance_dues_rates',       'sektion',           'club_section');

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'finance_ledger_settings_debitoren_account_fkey') THEN
    ALTER TABLE finance_ledger_settings
      RENAME CONSTRAINT finance_ledger_settings_debitoren_account_fkey TO finance_ledger_settings_receivables_account_fkey;
  END IF;
END $$;

-- ── 2. Dictionary (clubdesk_value_map / clubdesk_field_map, migration 412) ──
-- Mirror invoice statuses share the native slugs where they mean the same thing.
UPDATE clubdesk_value_map SET app_value = 'open'
 WHERE domain = 'invoice_status' AND app_value = 'issued';
UPDATE clubdesk_value_map SET app_value = 'partial'
 WHERE domain = 'invoice_status' AND app_value = 'partially_paid';

INSERT INTO clubdesk_value_map (domain, app_value, clubdesk_value, is_canonical) VALUES
  ('payment_method', 'qr_bill_no_reference', 'QR-Rechnung ohne Referenz', true)
ON CONFLICT (domain, clubdesk_value) DO NOTHING;

UPDATE clubdesk_field_map
   SET value_domain = 'payment_method',
       notes = 'unknown values import verbatim; the importer warns'
 WHERE feed = 'finance_invoices' AND clubdesk_header = 'Zahlungsart'
   AND value_domain IS DISTINCT FROM 'payment_method';

-- ── 3. The function that reads invoice statuses (before the UPDATE below) ───
CREATE OR REPLACE FUNCTION public.refresh_members_dues_paid()
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  y       integer := EXTRACT(YEAR FROM public.kscw_current_season_start())::int;
  season_label text := public.kscw_current_season_label();
  pat     text;
  changed integer := 0;
BEGIN
  pat := '(^|[^0-9])' || y::text || '/(' || (y + 1)::text || '|' || lpad(((y + 1) % 100)::text, 2, '0') || ')([^0-9]|$)';

  -- The paid dues invoice per member, if any — newest settlement wins when a
  -- member somehow holds two (a re-issue paid twice is a treasurer's problem,
  -- not a reason to show them unpaid). Only rows whose answer moves are
  -- written, so the members row (and its own statement trigger) is left alone
  -- on the nightly no-op. Paid = 'paid', or ClubDesk's 'Bezahlt (teilw.
  -- abgeschrieben)' (migration 419; was ILIKE 'bezahlt%' on the German text).
  WITH paid AS (
    SELECT DISTINCT ON (fi.member)
           fi.member                                        AS member_id,
           coalesce(fi.closed_on, fi.confirmed_at::date)    AS paid_at
    FROM finance_invoices fi
    WHERE fi.member IS NOT NULL
      AND fi.subject ILIKE '%mitgliederbeitrag%'
      AND fi.subject ~ pat
      AND fi.status IN ('paid', 'paid_partially_written_off')
    ORDER BY fi.member, coalesce(fi.closed_on, fi.confirmed_at::date) DESC NULLS LAST, fi.id DESC
  ),
  target AS (
    SELECT m.id,
           (p.member_id IS NOT NULL)                              AS dues_paid,
           CASE WHEN p.member_id IS NOT NULL THEN season_label END AS dues_paid_season,
           p.paid_at                                              AS dues_paid_at
    FROM members m
    LEFT JOIN paid p ON p.member_id = m.id
  )
  UPDATE members m
  SET dues_paid        = t.dues_paid,
      dues_paid_season = t.dues_paid_season,
      dues_paid_at     = t.dues_paid_at
  FROM target t
  WHERE t.id = m.id
    AND (   m.dues_paid        IS DISTINCT FROM t.dues_paid
         OR m.dues_paid_season IS DISTINCT FROM t.dues_paid_season
         OR m.dues_paid_at     IS DISTINCT FROM t.dues_paid_at);
  GET DIAGNOSTICS changed = ROW_COUNT;
  RETURN changed;
END $function$;

-- ── 4. Invoice values — ONE statement (the dues trigger fires per statement) ─
CREATE OR REPLACE FUNCTION pg_temp.invoice_status(p text) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN p IS NULL OR btrim(p) = '' THEN NULLIF(btrim(p), '')
              WHEN btrim(p) IN ('open', 'pending_confirmation', 'partial', 'paid', 'cancelled',
                                'paid_partially_written_off', 'written_off', 'draft') THEN btrim(p)
              ELSE COALESCE(cd_to_app('invoice_status', p), p) END
$$;
CREATE OR REPLACE FUNCTION pg_temp.payment_method(p text) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN p IS NULL OR btrim(p) = '' THEN NULLIF(btrim(p), '')
              ELSE COALESCE(cd_to_app('payment_method', p), p) END
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'finance_invoices' AND column_name = 'dunning_status') THEN
    UPDATE finance_invoices SET
      status         = pg_temp.invoice_status(status),
      payment_method = pg_temp.payment_method(payment_method),
      dunning_level  = GREATEST(dunning_level, COALESCE(substring(dunning_status FROM '(\d+)')::smallint, 0))
     WHERE status IS DISTINCT FROM pg_temp.invoice_status(status)
        OR payment_method IS DISTINCT FROM pg_temp.payment_method(payment_method)
        OR dunning_level < COALESCE(substring(dunning_status FROM '(\d+)')::smallint, 0);
  ELSE
    UPDATE finance_invoices SET
      status         = pg_temp.invoice_status(status),
      payment_method = pg_temp.payment_method(payment_method)
     WHERE status IS DISTINCT FROM pg_temp.invoice_status(status)
        OR payment_method IS DISTINCT FROM pg_temp.payment_method(payment_method);
  END IF;
END $$;

ALTER TABLE finance_invoices DROP COLUMN IF EXISTS dunning_status;
DELETE FROM directus_fields WHERE collection = 'finance_invoices' AND field = 'dunning_status';
UPDATE directus_presets
   SET layout_query = CASE WHEN layout_query IS NULL THEN NULL
                      ELSE replace(layout_query::text, '"dunning_status"', '"dunning_level"')::json END
 WHERE collection = 'finance_invoices' AND strpos(COALESCE(layout_query::text, ''), '"dunning_status"') > 0;

-- Fails here (and rolls the whole migration back) if a status is still unmapped.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'finance_invoices_status_values') THEN
    ALTER TABLE finance_invoices ADD CONSTRAINT finance_invoices_status_values
      CHECK (status IS NULL OR status IN ('open', 'pending_confirmation', 'partial', 'paid', 'cancelled',
                                          'paid_partially_written_off', 'written_off', 'draft'));
  END IF;
END $$;

-- ── 5. Booking types ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION pg_temp.entry_type(p text) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN p IS NULL OR btrim(p) = '' THEN NULLIF(btrim(p), '')
              WHEN btrim(p) IN ('standard', 'invoice', 'invoice_collective', 'invoice_collective_item',
                                'opening', 'closing', 'reversal') THEN btrim(p)
              ELSE COALESCE(cd_to_app('booking_type', p), p) END
$$;

ALTER TABLE finance_transactions DISABLE TRIGGER trg_finance_native_txn_lock;
UPDATE finance_transactions SET entry_type = pg_temp.entry_type(entry_type)
 WHERE entry_type IS DISTINCT FROM pg_temp.entry_type(entry_type);
ALTER TABLE finance_transactions ENABLE TRIGGER trg_finance_native_txn_lock;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'finance_transactions_entry_type_values') THEN
    ALTER TABLE finance_transactions ADD CONSTRAINT finance_transactions_entry_type_values
      CHECK (entry_type IS NULL OR entry_type IN ('standard', 'invoice', 'invoice_collective',
                                                  'invoice_collective_item', 'opening', 'closing', 'reversal'));
  END IF;
END $$;

-- ── 6. Directus metadata ─────────────────────────────────────────────────────
UPDATE directus_fields
   SET interface = 'select-dropdown',
       options = '{"choices":[{"text":"Open (ClubDesk: Gestellt)","value":"open"},{"text":"Pending confirmation","value":"pending_confirmation"},{"text":"Partially paid (Teilweise bezahlt)","value":"partial"},{"text":"Paid (Bezahlt)","value":"paid"},{"text":"Paid, rest written off (Bezahlt (teilw. abgeschrieben))","value":"paid_partially_written_off"},{"text":"Written off (Abgeschrieben)","value":"written_off"},{"text":"Cancelled (Storniert)","value":"cancelled"},{"text":"Draft (Entwurf)","value":"draft"}],"allowNone":true}'::json,
       note = 'Invoice status slug (migration 419). Native rows: open → pending_confirmation → partial/paid, or cancelled. ClubDesk mirror rows map their German status onto the same slugs.'
 WHERE collection = 'finance_invoices' AND field = 'status';
UPDATE directus_fields
   SET interface = 'select-dropdown',
       options = '{"choices":[{"text":"Standard","value":"standard"},{"text":"Rechnung","value":"invoice"},{"text":"Rechnung (Sammel)","value":"invoice_collective"},{"text":"Rechnung (Sammelposition)","value":"invoice_collective_item"},{"text":"Eröffnung","value":"opening"},{"text":"Abschluss","value":"closing"},{"text":"Storno","value":"reversal"}],"allowNone":true}'::json
 WHERE collection = 'finance_transactions' AND field = 'entry_type';
UPDATE directus_fields SET note = 'ClubDesk login id of the recipient (Benutzer-Id).'
 WHERE collection = 'finance_invoices' AND field = 'cd_user_id';

COMMENT ON COLUMN finance_invoices.status IS 'Invoice status slug (migration 419): open | pending_confirmation | partial | paid | cancelled (native lifecycle, CHECK finance_invoices_native_status_check), plus paid_partially_written_off | written_off | draft for ClubDesk mirror rows. ClubDesk wording via clubdesk_value_map domain invoice_status / finance-values.js.';
COMMENT ON COLUMN finance_invoices.dunning_level IS 'Highest dunning level (0 = none, 1/2/3 …). Native rows: denormalised from finance_dunning_notices. ClubDesk mirror rows: the number in ClubDesk''s Mahnstatus (''2. Mahnung'' → 2). Replaces dunning_status (migration 419).';
COMMENT ON COLUMN finance_invoices.payment_method IS 'Payment method slug (qr_bill_no_reference …), clubdesk_value_map domain payment_method. An unknown ClubDesk Zahlungsart is imported verbatim.';
COMMENT ON COLUMN finance_invoices.cd_user_id IS 'ClubDesk login id of the recipient (Benutzer-Id). Was cd_benutzer_id (migration 419).';
COMMENT ON COLUMN finance_invoices.recipient_postal_code IS 'Postal code as at billing time (see recipient_address).';
COMMENT ON COLUMN finance_transactions.entry_type IS 'Booking type slug (migration 419): standard | invoice | invoice_collective | invoice_collective_item | opening | closing | reversal. ClubDesk Typ via clubdesk_value_map domain booking_type / finance-values.js.';
COMMENT ON COLUMN finance_transactions.voucher_no IS 'Voucher number (ClubDesk Beleg; native J-/A-/E-/AP- numbers).';
COMMENT ON COLUMN finance_ledger_settings.receivables_account IS 'Accounts receivable (Debitoren) account the auto-posting books invoices against.';
COMMENT ON COLUMN finance_dues_rates.club_section IS 'Optional club-section override (volleyball | basketball | club); NULL = the category default.';
COMMENT ON TABLE finance_transactions IS 'Double-entry ledger mirrored from the ClubDesk Buchhaltung export (source clubdesk) plus the native book (source native). debit_/credit_account_number+name are the raw Soll/Haben values; debit_account/credit_account are the resolved finance_accounts FKs. entry_type is a booking-type slug (migration 419).';
COMMENT ON TABLE finance_invoices IS 'Member invoices/dues: the ClubDesk Rechnungen mirror (source clubdesk) plus native invoices. Invoice fields + a member link ONLY — AHV/IBAN/home address present in the source CSV are deliberately NOT mirrored (keep the finance module low-PII). clubdesk_id is the invoice Nummer (stable upsert key); member matched on recipient_email, fallback the recipient contact id (cd_contact_id).';
COMMENT ON TABLE finance_dues_rates IS 'Per-(fiscal_year, fee_category[, club_section]) membership-fee schedule. club_section NULL = category default; a club_section row overrides. Treasurer-entered (no dues amount is mirrored from ClubDesk).';

COMMIT;
