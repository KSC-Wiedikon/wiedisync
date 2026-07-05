-- Migration 174: two audit fix-forwards from the 2026-07-05 deep audit.
--
-- (#4, MEDIUM) finance_payouts.member ON DELETE CASCADE destroyed reimbursement
--   history when a member was hard-deleted — the exact audit-trail-destruction
--   class migration 149 fixed for finance_payments / finance_dunning_notices,
--   and inconsistent with finance_invoices.member (SET NULL). A finance_payouts
--   row records money the club actually paid OUT with a payee IBAN snapshot;
--   deleting the member must never silently erase it. Re-point to ON DELETE
--   RESTRICT — a member with payout history can no longer be hard-deleted (the
--   departed flow deactivates instead of deleting, so this changes no live path).
--
-- (#7, LOW) trg_slot_claims_validate is fully bypassed by a NULL date: both
--   guards (`NEW.date < CURRENT_DATE` and the duplicate-active `date = NEW.date`
--   match) evaluate to NULL/no-match when NEW.date IS NULL, so a coach could
--   POST a slot_claim with date omitted and insert a NULL-date "active" claim
--   that skips both checks. Reject a NULL date up front. slot_claims.date has 0
--   NULL rows on prod (verified), so no legacy data is affected. search_path
--   stays pinned (the 2026-06-10 migration-101 discipline).
--
-- Idempotent + self-wrapped (the 2026-07-02 #39 lesson). Schema-only.

BEGIN;

-- ── #4: finance_payouts.member → ON DELETE RESTRICT ─────────────────────────
DO $$
DECLARE cname text;
BEGIN
  SELECT con.conname INTO cname
    FROM pg_constraint con
   WHERE con.conrelid = 'finance_payouts'::regclass
     AND con.contype = 'f'
     AND con.conkey = ARRAY[(SELECT attnum FROM pg_attribute
                              WHERE attrelid = 'finance_payouts'::regclass
                                AND attname = 'member')]::smallint[];
  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE finance_payouts DROP CONSTRAINT %I', cname);
  END IF;
  ALTER TABLE finance_payouts
    ADD CONSTRAINT finance_payouts_member_fk
    FOREIGN KEY (member) REFERENCES members(id) ON DELETE RESTRICT;
END $$;

-- ── #7: trg_slot_claims_validate rejects a NULL date ────────────────────────
CREATE OR REPLACE FUNCTION public.trg_slot_claims_validate()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.date IS NULL THEN
    RAISE EXCEPTION 'A slot claim requires a date';
  END IF;
  IF NEW.date < CURRENT_DATE THEN
    RAISE EXCEPTION 'Cannot claim slots in the past';
  END IF;
  IF NEW.status = 'active' AND EXISTS (
    SELECT 1 FROM slot_claims
    WHERE hall_slot = NEW.hall_slot AND date = NEW.date AND status = 'active'
      AND id IS DISTINCT FROM NEW.id
  ) THEN
    RAISE EXCEPTION 'This slot is already claimed for this date';
  END IF;
  RETURN NEW;
END;
$function$;

COMMIT;
