-- Migration 133: alternate billing contact on members.
--
-- ClubDesk bills minors/guardians (and a few company-paid members) to a DIFFERENT
-- recipient than the member themselves — but wiedisync had nowhere to store that:
-- the only billing-contact data was recipient_name/recipient_email stamped on each
-- imported invoice. These columns let the finance role record an explicit billing
-- contact per member (name/email/address/phone), surfaced + edited in the new
-- finance member explorer, and used as the invoice recipient for native invoices.
--
--   billing_different = false  → bill the member directly (member's own contact).
--   billing_different = true   → bill the billing_* contact instead.
--
-- One-time idempotent BACKFILL (step 2) seeds billing_name/billing_email from the
-- member's most recent linked invoice whose recipient_email differs from the
-- member's own email (the minor→parent case). Only touches untouched rows
-- (billing_email IS NULL AND billing_different = false), so it never clobbers a
-- later finance edit and is safe to re-run.
--
-- Schema + one-shot data backfill, idempotent. Permissions in setup-permissions.mjs.

BEGIN;

-- ── 1. Columns ─────────────────────────────────────────────────────────
ALTER TABLE members
  ADD COLUMN IF NOT EXISTS billing_different boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS billing_name      varchar(255),
  ADD COLUMN IF NOT EXISTS billing_email     varchar(255),
  ADD COLUMN IF NOT EXISTS billing_address   varchar(255),
  ADD COLUMN IF NOT EXISTS billing_plz       varchar(10),
  ADD COLUMN IF NOT EXISTS billing_ort       varchar(100),
  ADD COLUMN IF NOT EXISTS billing_phone     varchar(255);

COMMENT ON COLUMN members.billing_different IS
  'When true, invoices are billed to the billing_* contact (e.g. a minor''s parent/guardian or a paying company) instead of the member''s own name/email/address.';

-- ── 2. Directus field metadata (so the items API + admin UI expose them) ──
INSERT INTO directus_fields (collection, field, special, interface, options, sort, width, note)
SELECT 'members', 'billing_different', 'cast-boolean', 'boolean',
  '{"label":"Bill a different contact (guardian / company)"}'::json, 200, 'full',
  'Bill an alternate contact instead of the member (minors/guardians, company-paid).'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'members' AND field = 'billing_different');
INSERT INTO directus_fields (collection, field, interface, sort, width, note)
SELECT 'members', 'billing_name', 'input', 201, 'half', 'Billing contact name (e.g. parent/guardian).'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'members' AND field = 'billing_name');
INSERT INTO directus_fields (collection, field, interface, options, sort, width)
SELECT 'members', 'billing_email', 'input', '{"iconLeft":"mail"}'::json, 202, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'members' AND field = 'billing_email');
INSERT INTO directus_fields (collection, field, interface, sort, width)
SELECT 'members', 'billing_address', 'input', 203, 'full'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'members' AND field = 'billing_address');
INSERT INTO directus_fields (collection, field, interface, sort, width)
SELECT 'members', 'billing_plz', 'input', 204, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'members' AND field = 'billing_plz');
INSERT INTO directus_fields (collection, field, interface, sort, width)
SELECT 'members', 'billing_ort', 'input', 205, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'members' AND field = 'billing_ort');
INSERT INTO directus_fields (collection, field, interface, options, sort, width)
SELECT 'members', 'billing_phone', 'input', '{"iconLeft":"phone"}'::json, 206, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'members' AND field = 'billing_phone');

-- ── 3. One-time backfill from the latest differing invoice recipient ──────
WITH latest_alt AS (
  SELECT DISTINCT ON (fi.member)
    fi.member,
    NULLIF(btrim(fi.recipient_name), '')  AS rname,
    NULLIF(btrim(fi.recipient_email), '') AS remail
  FROM finance_invoices fi
  JOIN members m ON m.id = fi.member
  WHERE fi.member IS NOT NULL
    AND NULLIF(btrim(fi.recipient_email), '') IS NOT NULL
    AND lower(btrim(fi.recipient_email)) <> lower(btrim(coalesce(m.email, '')))
  ORDER BY fi.member, fi.invoice_date DESC NULLS LAST, fi.id DESC
)
UPDATE members m SET
  billing_email     = la.remail,
  billing_name      = COALESCE(la.rname, m.billing_name),
  billing_different = true
FROM latest_alt la
WHERE m.id = la.member
  AND m.billing_email IS NULL
  AND m.billing_different = false;

COMMIT;
