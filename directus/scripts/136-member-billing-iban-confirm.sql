-- Migration 136: billing IBAN + member IBAN confirmation state.
--
-- Two additions to the finance/billing model:
--   * members.billing_iban — the IBAN of the alternate billing contact (guardian/
--     company). When billing_different is true, pay-outs/reimbursements go HERE
--     instead of the member's own account. Finance-editable (like the other
--     billing_* fields). No QRR; a regular IBAN.
--   * members.iban_confirmed — whether the member has VERIFIED their own
--     reimbursement IBAN. The ~49 IBANs we hold were backfilled from ClubDesk
--     (could be a stale/direct-debit account), so they start UNCONFIRMED; the
--     member confirms or corrects on the My-finances card (which sets it true).
--     Member-editable (the confirm action). Defaults false everywhere → the
--     My-finances banner nudges every current IBAN-holder to confirm once.
--
-- Schema-only + idempotent. Permissions in setup-permissions.mjs.

BEGIN;

ALTER TABLE members
  ADD COLUMN IF NOT EXISTS billing_iban   varchar(34),
  ADD COLUMN IF NOT EXISTS iban_confirmed boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN members.billing_iban IS
  'IBAN of the alternate billing contact (guardian/company). Used for pay-outs when billing_different = true. Finance-editable.';
COMMENT ON COLUMN members.iban_confirmed IS
  'Member has verified their own reimbursement IBAN (members.iban). False for ClubDesk-backfilled IBANs until the member confirms on the My-finances card.';

-- ── Directus field metadata ────────────────────────────────────────────
INSERT INTO directus_fields (collection, field, interface, options, sort, width, note)
SELECT 'members', 'billing_iban', 'input', '{"iconLeft":"account_balance"}'::json, 207, 'half',
  'IBAN of the billing contact (guardian/company) — pay-outs go here when "bill a different contact" is on.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'members' AND field = 'billing_iban');
INSERT INTO directus_fields (collection, field, special, interface, options, sort, width, note)
SELECT 'members', 'iban_confirmed', 'cast-boolean', 'boolean',
  '{"label":"Member has confirmed their reimbursement IBAN"}'::json, 198, 'half',
  'Set when the member verifies their own IBAN on the My-finances card.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'members' AND field = 'iban_confirmed');

COMMIT;
