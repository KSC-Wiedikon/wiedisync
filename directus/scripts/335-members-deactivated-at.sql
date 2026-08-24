-- Migration 335: stamp WHEN a member was deactivated, so a retention clock has a start.
--
-- Deactivation currently means "stop processing" — `kscw_membership_active`
-- false, dropped from every roster, out of every mail audience (audience.js
-- gates on the flag) — but not "stop storing". The `members` row survives whole:
-- name, birthdate, address, phone, email, and for some of them IBAN, AHV number,
-- photo. Nothing in this codebase ever removes any of it: there is no retention
-- schedule, no sweep, no cron.
--
-- Some of that retention is defensible (dues + invoice history is accounting —
-- OR Art. 958f wants ten years). An IBAN for expense reimbursements or an AHV
-- number a year after somebody left is much harder to justify, and storage
-- limitation (FADP Art. 6(4) / GDPR Art. 5(1)(e)) is not satisfied by "forever".
--
-- ⚠⚠ The blocker was never the policy — it was that the clock had NO RELIABLE
-- START. The only departure date is `austritt`, which comes from the ClubDesk
-- register, and on prod 3 of the 37 deactivated members do not have one. So even
-- a decided rule ("clear IBAN 12 months after departure") had no column to key
-- off for those rows. This adds one.
--
-- ⚠⚠ A TRIGGER, not an endpoint write, and that is the whole point. Members are
-- deactivated from at least three directions — /kscw/clubdesk-deactivate (the
-- departed + broken-link flows), a plain items-API PATCH from the Data Explorer,
-- and raw SQL — and a clock that only starts when the deactivation happened to
-- go through one particular endpoint is a clock that silently does not start.
-- The trigger is the enforcement point; no caller has to remember.
--
-- ⚠ Reactivation CLEARS the stamp. A returning member is not serving out a
-- retention period, and a stale timestamp under a live membership would read to
-- any future sweep as "eligible for erasure" — the one wrong answer this column
-- must never give. Set on true→false, cleared on false→true, untouched otherwise
-- (so an ordinary edit to an already-inactive member never moves the clock).
--
-- ⚠ Backfilled from `austritt` where the register has one, deliberately NOT from
-- `date_updated` or now(): a fabricated start date is worse than a missing one,
-- because it looks authoritative. The rows that end up NULL are exactly the ones
-- a human has to date by hand, and they stay visible as NULL until someone does.
--
-- ⚠ `austritt` is a DATE; the column is timestamptz. Casting a bare date gives
-- midnight in the SERVER's zone. Pinned to Europe/Zurich so the club's own
-- calendar day is what a retention period counts from, not UTC's.
--
-- ⚠ Registering the field in `directus_fields` is required (CLAUDE.md → schema
-- rule) AND it is what keeps the Data Explorer honest: an unregistered members
-- column falls through memberFieldSchema.ts into the amber "Unmapped column"
-- group — the exact wart removed on 2026-08-23. The matching entry is added to
-- memberFieldSchema.ts in the same commit.
--
-- ⚠⚠ Directus caches the schema at boot and a raw-SQL `directus_fields` insert
-- does NOT bust that cache (2026-08-22, `events.open_roster` read back as
-- `type: alias` until the container was restarted). Restart after applying:
--   npm run db:migrate:dev && ssh hetzner "sudo docker restart directus-kscw-dev"
--
-- Schema-only + idempotent. No permission rows (CLAUDE.md rule 1) — the column
-- rides the existing `members` grants.

BEGIN;

ALTER TABLE members
  ADD COLUMN IF NOT EXISTS deactivated_at timestamptz;

COMMENT ON COLUMN members.deactivated_at IS
  'When kscw_membership_active last went true→false. Trigger-owned (trg_members_deactivated_at); cleared on reactivation. The start of any retention period for an ex-member.';

CREATE OR REPLACE FUNCTION members_stamp_deactivated_at()
RETURNS trigger AS $$
BEGIN
  -- Deactivated now: start the clock. COALESCE so a re-run of the same
  -- transition (or a backfilled row being touched) never moves an existing stamp.
  IF NEW.kscw_membership_active IS DISTINCT FROM OLD.kscw_membership_active THEN
    IF NEW.kscw_membership_active IS FALSE THEN
      NEW.deactivated_at := COALESCE(NEW.deactivated_at, now());
    ELSIF NEW.kscw_membership_active IS TRUE THEN
      -- Back in the club — no retention period is running.
      NEW.deactivated_at := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_members_deactivated_at ON members;
CREATE TRIGGER trg_members_deactivated_at
  BEFORE UPDATE ON members
  FOR EACH ROW
  EXECUTE FUNCTION members_stamp_deactivated_at();

-- Backfill: the register's exit date, at Zurich midnight. Only where we have one.
UPDATE members
   SET deactivated_at = (austritt::timestamp AT TIME ZONE 'Europe/Zurich')
 WHERE kscw_membership_active IS FALSE
   AND deactivated_at IS NULL
   AND austritt IS NOT NULL;

-- Register the field so the items API + Data Explorer can read it.
-- ⚠ NULL in a VALUES list types as text and `options` is json — cast it.
INSERT INTO directus_fields (collection, field, special, interface, options, readonly, hidden, sort, width, "group", note)
SELECT 'members', 'deactivated_at', NULL, 'datetime', NULL::json, true, false, 15, 'half', 'grp_club_status',
       'When the club membership was last switched off. Set and cleared by trigger — the start of any retention period for an ex-member.'
WHERE NOT EXISTS (
  SELECT 1 FROM directus_fields WHERE collection = 'members' AND field = 'deactivated_at'
);

COMMIT;

-- Verification (dev/prod):
--   SELECT count(*) FILTER (WHERE deactivated_at IS NOT NULL) AS stamped,
--          count(*) FILTER (WHERE deactivated_at IS NULL)     AS undated
--     FROM members WHERE kscw_membership_active IS FALSE;
--     -- → prod expects 34 stamped / 3 undated (the 3 with no austritt)
--   -- Trigger, in a rolled-back transaction:
--   BEGIN;
--     UPDATE members SET kscw_membership_active = false WHERE id = <active id>;
--     SELECT deactivated_at FROM members WHERE id = <id>;   -- → now()
--     UPDATE members SET kscw_membership_active = true  WHERE id = <id>;
--     SELECT deactivated_at FROM members WHERE id = <id>;   -- → NULL
--   ROLLBACK;
