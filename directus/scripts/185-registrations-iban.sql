-- Migration 185: registrations.iban — optional payout IBAN on the signup form.
--
-- Collected ONLY so the club can pay money back (expense reimbursements,
-- deposit refunds) — never for collecting fees. The public form (kscw-website
-- registration-form.js) sends it optionally; POST /kscw/registration validates
-- mod-97 + normalizes to compact uppercase (normalize.js); the approval hook
-- copies it fill-only into members.iban with iban_confirmed=true (the member
-- typed it themselves).
--
-- Schema-only + idempotent. Sport Admin registrations grant is full-CRUD with
-- fields ['*'] (setup-permissions.mjs), so no permission change. After
-- applying, regenerate SCHEMA.sql (npm run db:baseline:prod).

BEGIN;

ALTER TABLE registrations ADD COLUMN IF NOT EXISTS iban varchar(34);

INSERT INTO directus_fields (collection, field, interface, sort, note)
SELECT 'registrations', 'iban', 'input', 60,
       'Payout IBAN (reimbursements only), mod-97 validated + normalized at submission (migration 185).'
WHERE NOT EXISTS (
  SELECT 1 FROM directus_fields df WHERE df.collection = 'registrations' AND df.field = 'iban'
);

COMMIT;
