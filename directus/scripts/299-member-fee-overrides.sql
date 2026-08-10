-- Migration 299: per-member Beitrag overrides — base, scorer-licence surcharge, discount
--
-- Until now the membership fee was computed and never stored: feeBreakdown()
-- (kscw-endpoints/src/clubdesk-update.js) takes the category base — from the
-- season's finance_dues_rates schedule for the native dues run, or the codified
-- CD_BEITRAG_MAP for the ClubDesk push — adds the CHF 100 no-Schreiberlizenz
-- surcharge, and subtracts the guest reduction. Every per-person exception the
-- treasurer needed ("Speziallizenz, einmalig so tief", a waived surcharge, a
-- one-off reduction) therefore had to be typed into ClubDesk by hand, or granted
-- as a per-run `discounts` map that nothing outside that one run remembers.
-- Last season that was 47 write-offs and CHF 7'026, most of them the surcharge.
--
-- These four columns give that exception a home ON THE MEMBER, so both fee
-- consumers agree on the number:
--   • fee_base_override        NULL = the season rate / category map
--   • fee_surcharge_override   NULL = the CHF 100 rule; 0 explicitly waives it
--   • fee_discount             NULL/0 = none; capped at what is owed
--   • fee_discount_reason      the credit line printed on the invoice
--
-- Nullable throughout and NULL by default, so applying this migration changes
-- not one member's fee: an override only exists where somebody typed one.
--
-- ⚠ NOT a ClubDesk-pushable field set. Mitgliederbeitrag is CREATE-only on the
-- push (an existing contact's amount is the register's own, fill-only), so
-- these columns need no clubdesk_push_pending wiring — they reach ClubDesk only
-- through the amount a brand-new contact is created with.
--
-- Schema-only + idempotent. After applying: `npm run db:setup-perms:dev|prod`
-- — the columns join the finance role's read + update lists.

BEGIN;

ALTER TABLE members ADD COLUMN IF NOT EXISTS fee_base_override numeric(10,2);
ALTER TABLE members ADD COLUMN IF NOT EXISTS fee_surcharge_override numeric(10,2);
ALTER TABLE members ADD COLUMN IF NOT EXISTS fee_discount numeric(10,2);
ALTER TABLE members ADD COLUMN IF NOT EXISTS fee_discount_reason character varying(120);

-- Sanity bounds. Negative is nonsense in every direction (a negative base or
-- discount mints an invoice that owes the MEMBER money and a QR bill for a
-- negative amount); the upper bound is a fat-finger guard, not a business rule
-- — the club's dearest category is CHF 660, so 10'000 is four orders of
-- headroom and still catches a stray keypress that would bill somebody 44'000.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'members'::regclass AND conname = 'members_fee_override_range'
  ) THEN
    ALTER TABLE members ADD CONSTRAINT members_fee_override_range
      CHECK (
        (fee_base_override      IS NULL OR (fee_base_override      >= 0 AND fee_base_override      <= 10000))
        AND (fee_surcharge_override IS NULL OR (fee_surcharge_override >= 0 AND fee_surcharge_override <= 10000))
        AND (fee_discount           IS NULL OR (fee_discount           >= 0 AND fee_discount           <= 10000))
      );
  END IF;
END $$;

-- An all-whitespace reason is not a reason. NULL means "use the run's default
-- wording (Rabatt)"; '' would print an empty credit line on the invoice.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'members'::regclass AND conname = 'members_fee_discount_reason_nonblank'
  ) THEN
    ALTER TABLE members ADD CONSTRAINT members_fee_discount_reason_nonblank
      CHECK (fee_discount_reason IS NULL OR btrim(fee_discount_reason) <> '');
  END IF;
END $$;

COMMENT ON COLUMN public.members.fee_base_override IS
  'Per-member Mitgliederbeitrag BASE in CHF, overriding the season rate (finance_dues_rates) and the codified category map (CD_BEITRAG_MAP) alike. NULL = derive from the category, which is the normal case. Set only for a genuine per-person exception the category cannot express ("Speziallizenz, einmalig so tief"). Consumed by feeBreakdown(), so the native dues run and the ClubDesk CREATE push bill the same number.';

COMMENT ON COLUMN public.members.fee_surcharge_override IS
  'Per-member CHF no-Schreiberlizenz surcharge, overriding the rule (CHF 100 when the member owes table duty — adult category, or youth category and U16+ — and holds no scorer/OTR licence). NULL = apply the rule. 0 explicitly waives it, which is what the club previously did as a post-hoc write-off on 47 invoices. Consumed by feeBreakdown().';

COMMENT ON COLUMN public.members.fee_discount IS
  'Standing per-member reduction in CHF taken off the computed fee. NULL/0 = none. Capped at what is owed by feeBreakdown() — a discount may take a bill to exactly zero, never below. A per-RUN discount passed to /finance/dues-runs/* wins over this for that run.';

COMMENT ON COLUMN public.members.fee_discount_reason IS
  'Label printed as the credit line on the invoice when fee_discount applies. NULL = the run''s wording, default "Rabatt".';

-- ── Directus field registration ──────────────────────────────────────────────
-- grp_billing (migration 256) — next to iban / never_dun / the billing contact,
-- which is where a treasurer already looks for money questions.
--
-- `input` with a numeric type: the columns are plain numerics, and the admin
-- app reads them through the items API alongside every other members column.
-- Notes carry the "empty = derived" rule, because a blank numeric field is
-- otherwise indistinguishable from a deliberate zero.
INSERT INTO directus_fields (collection, field, interface, options, readonly, hidden, sort, width, "group", note)
SELECT * FROM (VALUES
  ('members', 'fee_base_override', 'input', NULL, false, false, 60, 'half', 'grp_billing',
   'Mitgliederbeitrag base in CHF for this member only. Leave EMPTY to use the season rate for their fee category — that is the normal case. A value here overrides both the rate schedule and the category map.'),
  ('members', 'fee_surcharge_override', 'input', NULL, false, false, 61, 'half', 'grp_billing',
   'No-Schreiberlizenz surcharge in CHF for this member only. Leave EMPTY to apply the rule (CHF 100 when they owe table duty and hold no licence). Enter 0 to waive it.'),
  ('members', 'fee_discount', 'input', NULL, false, false, 62, 'half', 'grp_billing',
   'Standing reduction in CHF taken off this member''s dues. Capped at what is owed — it can reach 0, never below.'),
  ('members', 'fee_discount_reason', 'input', NULL, false, false, 63, 'half', 'grp_billing',
   'Credit-line label printed on the invoice for the discount above. Empty = "Rabatt".')
) AS v(collection, field, interface, options, readonly, hidden, sort, width, "group", note)
WHERE NOT EXISTS (
  SELECT 1 FROM directus_fields df WHERE df.collection = v.collection AND df.field = v.field
);

COMMIT;

-- Verification (dev/prod):
--   SELECT count(*) FILTER (WHERE fee_base_override IS NOT NULL) AS base,
--          count(*) FILTER (WHERE fee_surcharge_override IS NOT NULL) AS surcharge,
--          count(*) FILTER (WHERE fee_discount IS NOT NULL) AS discount
--     FROM members;                                    -- → 0 / 0 / 0 right after applying
--   UPDATE members SET fee_discount = -5 WHERE id = <test>;      -- → CHECK violation
--   UPDATE members SET fee_discount_reason = '  ' WHERE id = <test>; -- → CHECK violation
--   -- Member 117 (VB Schüler*in Turnier, b. 2009, no scorer licence): 210 + 100 = 310.
--   --   UPDATE members SET fee_surcharge_override = 0 WHERE id = 117;  -- → 210
--   GET /kscw/finance/members/117/fee                  -- itemised, same engine
