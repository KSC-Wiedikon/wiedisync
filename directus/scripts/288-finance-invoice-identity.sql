-- 288 — finance_invoices: separate the INVOICE identity from the RECIPIENT identity.
--
-- The ClubDesk Rechnungen export has one row per invoice, but its `[Id]` column is
-- the *recipient contact's* ClubDesk id (the same id the member/Kontakte export
-- uses) — NOT an invoice id. Contact 1000262 carries that id on all nine of her
-- invoices. import-clubdesk-finance.mjs deduped on `[Id]` believing it identified
-- the invoice ("multi-position invoices repeat the id across rows"), so it kept
-- only the newest invoice per person: 972 of 2617 invoices imported, 1645 (63%)
-- silently dropped every night. finance_invoices.clubdesk_id therefore holds a
-- CONTACT id under a UNIQUE constraint, which structurally caps the mirror at one
-- invoice per person.
--
-- After this migration + the importer change:
--   finance_invoices.clubdesk_id  = the invoice's `Nummer`  (invoice identity, UNIQUE)
--   finance_invoices.cd_contact_id = the recipient's `[Id]` (contact identity)
-- The next sync re-keys every mirror row (it is a full DELETE + re-INSERT of
-- source='clubdesk'), so no data backfill is needed here.
--
-- Schema-only, idempotent. Permissions live in setup-permissions.mjs.

-- ═══════════════════════════════════════════════════════════════════════════════════════
-- 1. finance_invoices.cd_contact_id — the recipient's ClubDesk contact id
-- ═══════════════════════════════════════════════════════════════════════════════════════
ALTER TABLE finance_invoices ADD COLUMN IF NOT EXISTS cd_contact_id varchar(64);

COMMENT ON COLUMN finance_invoices.cd_contact_id IS
  'ClubDesk contact id of the recipient (the export''s [Id] column) — matches members.clubdesk_id. NOT the invoice identity; that is clubdesk_id (= the export''s Nummer).';
COMMENT ON COLUMN finance_invoices.clubdesk_id IS
  'The ClubDesk invoice number (export column Nummer). Before migration 288 this wrongly held the recipient contact id, which capped the mirror at one invoice per person.';

-- Member matching + the override re-apply both walk this column on every sync.
CREATE INDEX IF NOT EXISTS finance_invoices_cd_contact_id_idx ON finance_invoices (cd_contact_id);

INSERT INTO directus_fields (collection, field, interface, sort, width, note, readonly, hidden)
SELECT 'finance_invoices', 'cd_contact_id', 'input', 60, 'half',
       'ClubDesk contact id of the recipient. Invoice identity is clubdesk_id (the ClubDesk Nummer).',
       true, false
WHERE NOT EXISTS (
  SELECT 1 FROM directus_fields WHERE collection = 'finance_invoices' AND field = 'cd_contact_id'
);

-- ═══════════════════════════════════════════════════════════════════════════════════════
-- 2. finance_invoice_member_overrides — split the person-level pin from the invoice-level one
-- ═══════════════════════════════════════════════════════════════════════════════════════
-- Every value ever written into match_clubdesk_id came from finance_invoices.clubdesk_id,
-- i.e. it is a CONTACT id in all existing rows (the 7 live rows are the 2026-07-05
-- duplicate-contact dedup). Once clubdesk_id starts holding invoice numbers, keeping both
-- meanings in one column would recreate exactly the ambiguity this migration removes — so
-- the legacy values move to their own column and match_clubdesk_id becomes invoice-level.
-- The move runs ONLY when the column is first added, so a re-run can never touch a
-- genuinely invoice-level override written later.
-- One atomic block: the key CHECK only accepts match_email / match_clubdesk_id, so
-- widening it has to land before the values move, or the move nulls the only key
-- the constraint can see and the whole migration aborts.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'finance_invoice_member_overrides' AND column_name = 'match_cd_contact_id'
  ) THEN
    ALTER TABLE finance_invoice_member_overrides ADD COLUMN match_cd_contact_id varchar(64);
    ALTER TABLE finance_invoice_member_overrides
      DROP CONSTRAINT IF EXISTS finance_invoice_member_overrides_key_check;
    ALTER TABLE finance_invoice_member_overrides
      ADD CONSTRAINT finance_invoice_member_overrides_key_check
      CHECK (match_email IS NOT NULL OR match_clubdesk_id IS NOT NULL OR match_cd_contact_id IS NOT NULL);
    UPDATE finance_invoice_member_overrides
       SET match_cd_contact_id = match_clubdesk_id, match_clubdesk_id = NULL
     WHERE match_clubdesk_id IS NOT NULL;
  END IF;
END $$;

COMMENT ON COLUMN finance_invoice_member_overrides.match_cd_contact_id IS
  'Pin every invoice of this ClubDesk CONTACT to the member (survives the nightly delete+reinsert).';
COMMENT ON COLUMN finance_invoice_member_overrides.match_clubdesk_id IS
  'Pin ONE invoice, by ClubDesk invoice number. Pre-288 rows held a contact id and were moved to match_cd_contact_id.';

INSERT INTO directus_fields (collection, field, interface, sort, width, note, readonly, hidden)
SELECT 'finance_invoice_member_overrides', 'match_cd_contact_id', 'input', 40, 'half',
       'Pin all invoices of this ClubDesk contact to the member.', false, false
WHERE NOT EXISTS (
  SELECT 1 FROM directus_fields
  WHERE collection = 'finance_invoice_member_overrides' AND field = 'match_cd_contact_id'
);
