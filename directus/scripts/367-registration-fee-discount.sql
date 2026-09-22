-- Migration 367: registration-level Mitgliederbeitrag discount + note
--
-- The registration review screen is about to get a live fee preview and an
-- auto-fire ClubDesk push on approval (see kscw-hooks/clubdesk-update.js).
-- Once that push is automatic there is no later manual step where a treasurer
-- can still grant a one-off reduction before the number lands in the legal
-- register — so the discount has to be decidable AT REVIEW TIME, on the
-- registration itself, before a members row even exists.
--
-- These three columns mirror members.fee_discount / fee_discount_pct /
-- fee_discount_reason (migrations 299/300) exactly — same shapes, same CHECKs
-- — so feeBreakdown()'s withDiscount() step treats a registration-sourced
-- discount identically to a standing member one. They are copied onto the
-- members row createMemberFromRegistration() inserts for a BRAND-NEW member
-- only; an existing member linked by a re-registration keeps whatever
-- standing discount the treasurer already set via the Data Explorer — a
-- signup-time field must never silently overwrite that decision.
--
-- Nullable throughout, NULL by default: applying this migration changes not
-- one registration's fee.
--
-- Schema-only + idempotent. After applying: `npm run db:setup-perms:dev|prod`.

BEGIN;

ALTER TABLE registrations ADD COLUMN IF NOT EXISTS fee_discount        numeric(10,2);
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS fee_discount_pct    numeric(5,2);
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS fee_discount_reason character varying(120);

-- Same bounds as members_fee_override_range for the CHF/percent pair.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'registrations'::regclass AND conname = 'registrations_fee_discount_range'
  ) THEN
    ALTER TABLE registrations ADD CONSTRAINT registrations_fee_discount_range
      CHECK (
        (fee_discount     IS NULL OR (fee_discount     >= 0 AND fee_discount     <= 10000))
        AND (fee_discount_pct IS NULL OR (fee_discount_pct >= 0 AND fee_discount_pct <= 100))
      );
  END IF;
END $$;

-- An all-whitespace reason is not a reason (same rule as members_fee_discount_reason_nonblank).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'registrations'::regclass AND conname = 'registrations_fee_discount_reason_nonblank'
  ) THEN
    ALTER TABLE registrations ADD CONSTRAINT registrations_fee_discount_reason_nonblank
      CHECK (fee_discount_reason IS NULL OR btrim(fee_discount_reason) <> '');
  END IF;
END $$;

-- "CHF 40 off" and "20% off" are two different grants — same rule as
-- members_fee_discount_one_unit.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'registrations'::regclass AND conname = 'registrations_fee_discount_one_unit'
  ) THEN
    ALTER TABLE registrations ADD CONSTRAINT registrations_fee_discount_one_unit
      CHECK (fee_discount IS NULL OR fee_discount_pct IS NULL);
  END IF;
END $$;

COMMENT ON COLUMN public.registrations.fee_discount IS
  'Discount in CHF granted at registration review, taken off the computed Mitgliederbeitrag. Mutually exclusive with fee_discount_pct. Copied onto the new members row on approval ONLY when that approval creates a brand-new member — an existing (re-registering) member keeps their standing discount.';

COMMENT ON COLUMN public.registrations.fee_discount_pct IS
  'Discount as a PERCENTAGE (0-100) of the computed Mitgliederbeitrag, granted at registration review. Mutually exclusive with fee_discount (CHF) — CHECK registrations_fee_discount_one_unit enforces it.';

COMMENT ON COLUMN public.registrations.fee_discount_reason IS
  'Why the discount above was granted — the "Note" shown next to the discount toggle. Required whenever either discount value is set (CHECK registrations_fee_discount_reason_nonblank).';

-- ── Directus field registration ──────────────────────────────────────────────
INSERT INTO directus_fields (collection, field, interface, width, note)
SELECT 'registrations', 'fee_discount', 'input', 'half',
  'Discount in CHF off the computed Mitgliederbeitrag. Use this OR the percentage below, never both.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'registrations' AND field = 'fee_discount');

INSERT INTO directus_fields (collection, field, interface, width, note)
SELECT 'registrations', 'fee_discount_pct', 'input', 'half',
  'Discount as a percentage (0-100) of the computed Mitgliederbeitrag. Use this OR the CHF amount above, never both.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'registrations' AND field = 'fee_discount_pct');

INSERT INTO directus_fields (collection, field, interface, width, note)
SELECT 'registrations', 'fee_discount_reason', 'input', 'full',
  'Note explaining the discount — required whenever a discount amount or percentage is set.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'registrations' AND field = 'fee_discount_reason');

COMMIT;

-- Verification (dev/prod):
--   \d registrations -- fee_discount numeric(10,2), fee_discount_pct numeric(5,2), fee_discount_reason varchar(120)
--   UPDATE registrations SET fee_discount = 40, fee_discount_pct = 20 WHERE id = <test>; -- CHECK violation
--   UPDATE registrations SET fee_discount = 40 WHERE id = <test>;                        -- CHECK violation (no reason)
--   UPDATE registrations SET fee_discount = 40, fee_discount_reason = 'Familienrabatt' WHERE id = <test>; -- OK
--   GET /kscw/registration/<test>/fee                                                    -- itemised, same engine as ClubDesk push
