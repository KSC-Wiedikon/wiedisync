-- Migration 436: mark ClubDesk invoices as "not a member's invoice"
--
-- The nightly ClubDesk finance import links an invoice to a member by the recipient's
-- e-mail (else by ClubDesk contact id). A sponsor's invoice that carries a member's
-- e-mail — "Rechnung ZKB Gönnerbetrag" to Zürcher Kantonalbank, sent to the board member
-- who is ZKB's contact — so landed on that member and showed as her CHF 300 due
-- (30.10.2026). The treasurer overrides (migration 129/288) could only PIN an invoice to
-- a member; the next import re-linked anything unpinned by e-mail.
--
--   * finance_invoice_member_overrides.member becomes nullable: NULL = "this contact's /
--     this invoice's invoices belong to no member". Re-applied after the e-mail match on
--     every import (contact- and invoice-level rules run last), so the mark sticks.
--   * finance_invoices.not_member — set by the import (and the endpoint) on the rows such
--     an override covers, so the board's "Unmatched" queue does not keep asking to link
--     a sponsor's invoice to someone.
--
-- Schema-only, idempotent. No permission change (board reads finance tables whole;
-- members read their own invoices with an explicit field list that does not need it).

BEGIN;

ALTER TABLE finance_invoice_member_overrides ALTER COLUMN member DROP NOT NULL;

COMMENT ON COLUMN public.finance_invoice_member_overrides.member IS
  'Member the matched invoices belong to. NULL = they belong to no member (a sponsor or other '
  'non-member contact that carries a member''s e-mail) — the import leaves them unlinked.';

ALTER TABLE finance_invoices ADD COLUMN IF NOT EXISTS not_member boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.finance_invoices.not_member IS
  'Marked "not a member''s invoice" by the treasurer (finance_invoice_member_overrides with '
  'member NULL). Set by the ClubDesk import on every run; never linked to a member by e-mail.';

INSERT INTO directus_fields (collection, field, interface, options, readonly, hidden, sort, width, note)
SELECT 'finance_invoices', 'not_member', 'boolean', NULL::json, true, false, NULL, 'half',
       'Not a member''s invoice (sponsor or other contact) — set by the treasurer, kept by the import.'
WHERE NOT EXISTS (
  SELECT 1 FROM directus_fields WHERE collection = 'finance_invoices' AND field = 'not_member'
);

COMMIT;

-- Verification: \d finance_invoice_member_overrides → member nullable; \d finance_invoices → not_member
