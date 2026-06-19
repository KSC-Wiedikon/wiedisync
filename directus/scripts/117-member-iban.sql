-- Migration 117: member IBAN (sensitive financial PII, scoped like ahv_nummer).
--
-- Finance needs every member's up-to-date IBAN for reimbursements. Members enter
-- it from Profile → personal data; the expense-reimbursement upload page pre-fills
-- the payout IBAN from this column.
--
-- This is sensitive PII and is scoped EXACTLY like ahv_nummer in
-- setup-permissions.mjs: own-member readable/editable + admin only. It is NOT in
-- MEMBER_VISIBLE_FIELDS (other members can't see it) and NOT in the coach/leader
-- read whitelist (LEADER_TEAM_MEMBER_FIELDS already `.filter(f => f !== 'ahv_nummer')`).
--
-- Schema-only + idempotent. Permissions for the new field live in
-- setup-permissions.mjs (added to MEMBER_EDITABLE_FIELDS).

BEGIN;

ALTER TABLE members ADD COLUMN IF NOT EXISTS iban varchar(34);

COMMENT ON COLUMN members.iban IS
  'Member bank account IBAN (ISO 13616, max 34 chars), stored without spaces. Sensitive financial PII — scoped own-member + admin only in setup-permissions.mjs, like ahv_nummer; never exposed to other members or coaches. Used for expense reimbursements.';

-- Directus field metadata so the column is editable from the admin UI.
-- Mirrors the existing ahv_nummer field row (special=NULL, input interface).
INSERT INTO directus_fields (collection, field, special, interface, sort, hidden, note)
SELECT 'members', 'iban', NULL, 'input', 20, false,
  'Member bank account IBAN for reimbursements. Sensitive — own-member + admin only.'
WHERE NOT EXISTS (
  SELECT 1 FROM directus_fields WHERE collection = 'members' AND field = 'iban'
);

COMMIT;
