-- Migration 300: the fee overrides get the shapes the treasurer actually uses
--
-- Migration 299 shipped the three overrides as CHF numerics. Two of them are
-- the wrong shape:
--
--   • The no-Schreiberlizenz surcharge is not an amount, it is a YES/NO. The
--     club has exactly one figure (CHF 100) and the only decision ever made
--     about it is "does this member owe it". A numeric invited a per-person
--     amount that no fee rule, invoice line or ClubDesk cell can express.
--     → boolean. NULL still means "apply the rule" (adult category, or youth
--       and U16+, and no licence → owed), which is what keeps it LIVE: a member
--       who earns a scorer licence in March stops owing it without anybody
--       editing this column. `true` charges it, `false` waives it.
--
--   • A discount is granted either as CHF or as a percentage ("20% off"), and
--     only the club knows which it meant. Storing a percentage as the CHF it
--     happens to equal today loses that, and silently stops tracking the base
--     if the season rate changes.
--     → fee_discount_pct alongside fee_discount, mutually exclusive.
--
-- Safe to reshape rather than migrate values: 299 landed hours earlier and no
-- member holds an override yet (prod 0/0/0 of 708 verified before this ran).
-- The guard below aborts rather than dropping a column somebody had used.
--
-- Schema-only + idempotent. After applying: `npm run db:setup-perms:dev|prod`
-- (fee_discount_pct joins the finance role's read + update lists).

BEGIN;

-- ── Guard ────────────────────────────────────────────────────────────────────
-- Reshaping a column is only free while it is empty. If a treasurer set a
-- surcharge amount between 299 and this migration, stop and convert by hand:
-- the intent (0 = waived, 100 = owed, anything else = ?) is theirs to state.
DO $$
DECLARE used integer;
BEGIN
  SELECT count(*) INTO used
  FROM information_schema.columns
  WHERE table_name = 'members' AND column_name = 'fee_surcharge_override'
    AND data_type = 'numeric';
  IF used > 0 THEN
    SELECT count(*) INTO used FROM members WHERE fee_surcharge_override IS NOT NULL;
    IF used > 0 THEN
      RAISE EXCEPTION 'members.fee_surcharge_override holds % value(s) — convert them by hand before reshaping', used;
    END IF;
  END IF;
END $$;

-- ── Surcharge: numeric → boolean ─────────────────────────────────────────────
-- The old range CHECK names the column, so it has to go first.
ALTER TABLE members DROP CONSTRAINT IF EXISTS members_fee_override_range;
ALTER TABLE members DROP COLUMN IF EXISTS fee_surcharge_override;
ALTER TABLE members ADD COLUMN IF NOT EXISTS fee_surcharge_override boolean;

COMMENT ON COLUMN public.members.fee_surcharge_override IS
  'Does this member owe the CHF 100 no-Schreiberlizenz surcharge? NULL = apply the rule (adult fee category, or youth category and U16+, and no scorer/OTR licence), which is the normal case and stays live as licences change. true = charge it regardless. false = waive it, which is what the club used to do as a post-hoc write-off on 47 invoices. Consumed by feeBreakdown(); the amount itself is NO_LICENCE_SURCHARGE in kscw-endpoints/src/clubdesk-update.js, never stored per member.';

-- ── Discount: CHF or percent, never both ─────────────────────────────────────
ALTER TABLE members ADD COLUMN IF NOT EXISTS fee_discount_pct numeric(5,2);

COMMENT ON COLUMN public.members.fee_discount_pct IS
  'Standing per-member reduction as a PERCENTAGE (0-100) of what is owed after base + surcharge - guest reduction. Mutually exclusive with fee_discount (CHF) — the CHECK members_fee_discount_one_unit enforces it. Percent rather than the CHF it equals today, so a season rate change carries the intent instead of freezing yesterday''s number. A per-RUN discount passed to /finance/dues-runs/* still wins over both.';

-- Rebuilt range CHECK: the surcharge is no longer numeric, and the percentage
-- has its own 0-100 bound. Same fat-finger ceiling as 299 on the CHF columns —
-- the club's dearest category is CHF 660.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'members'::regclass AND conname = 'members_fee_override_range'
  ) THEN
    ALTER TABLE members ADD CONSTRAINT members_fee_override_range
      CHECK (
        (fee_base_override IS NULL OR (fee_base_override >= 0 AND fee_base_override <= 10000))
        AND (fee_discount     IS NULL OR (fee_discount     >= 0 AND fee_discount     <= 10000))
        AND (fee_discount_pct IS NULL OR (fee_discount_pct >= 0 AND fee_discount_pct <= 100))
      );
  END IF;
END $$;

-- "20% off" and "CHF 40 off" are two different grants, and a row holding both
-- has no defensible reading — feeBreakdown would have to pick one silently.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'members'::regclass AND conname = 'members_fee_discount_one_unit'
  ) THEN
    ALTER TABLE members ADD CONSTRAINT members_fee_discount_one_unit
      CHECK (fee_discount IS NULL OR fee_discount_pct IS NULL);
  END IF;
END $$;

-- ── Directus field registration ──────────────────────────────────────────────
-- 299's fee_surcharge_override row survives the column drop (directus_fields is
-- metadata, not a FK), so it is UPDATEd to the boolean interface rather than
-- re-inserted. ⚠ NULL in a VALUES list types as text and `options` is json —
-- see the note in migration 299.
UPDATE directus_fields
   SET interface = 'boolean',
       note = 'Does this member owe the CHF 100 no-Schreiberlizenz surcharge? Leave EMPTY to follow the rule (charged when they owe table duty and hold no licence) — that is the normal case and keeps tracking their licence. Yes charges it regardless, No waives it.'
 WHERE collection = 'members' AND field = 'fee_surcharge_override';

INSERT INTO directus_fields (collection, field, interface, options, readonly, hidden, sort, width, "group", note)
SELECT 'members', 'fee_discount_pct', 'input', NULL::json, false, false, 63, 'half', 'grp_billing',
       'Standing reduction as a percentage of what this member owes. Use this OR the CHF discount, never both — the database rejects a row with both.'
WHERE NOT EXISTS (
  SELECT 1 FROM directus_fields WHERE collection = 'members' AND field = 'fee_discount_pct'
);

COMMIT;

-- Verification (dev/prod):
--   \d members  -- fee_surcharge_override → boolean, fee_discount_pct → numeric(5,2)
--   UPDATE members SET fee_discount = 40, fee_discount_pct = 20 WHERE id = <test>;  -- → CHECK violation
--   UPDATE members SET fee_discount_pct = 120 WHERE id = <test>;                    -- → CHECK violation
--   -- Member 117 (VB Schüler*in Turnier, b. 2009, no scorer licence): 210 + 100 = 310.
--   --   fee_surcharge_override = false → 210;  fee_discount_pct = 10 → 279
--   GET /kscw/finance/members/117/fee
