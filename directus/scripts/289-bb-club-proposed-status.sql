-- 289-bb-club-proposed-status.sql
--
-- Lets the OPPONENT start a proposal, instead of only answering ours.
--
-- WHY
-- ---
-- Migration 280's lifecycle assumes KSCW proposes and the club answers:
--   draft → offered → accepted | declined | countered
-- The wanted flow is volleyball's (`/terminplanung/slots/:token` → `propose-home`):
-- the club sees which pitches are FREE and picks the ones that suit it. That first move has
-- no status today — 'countered' is an answer to an existing offer, and reusing it would make
-- a club-initiated date indistinguishable from a rejection of something we proposed.
--
-- Adds 'club_proposed': the club picked this pitch, a planner has not confirmed it yet.
--
-- ⚠ Deliberately NOT a booking. ProBasket assigns the actual fixtures at the Spielplansitzung
-- (05.09.2026); until a planner confirms, a club_proposed row is a preference, and several
-- clubs may name the same pitch. The generator's inventory (`basketball_slots`) is therefore
-- NOT consumed here — a slot is only claimed when a plan row is confirmed.
--
-- ⚠ `basketball_slot_plan_offer_needs_club_check` already requires opponent_club on anything
-- that is not a draft, which is exactly right for a club-initiated row: it always has a club.
-- The constraint is left alone.
--
-- Schema-only, idempotent (DROP … IF EXISTS then re-add).

BEGIN;

ALTER TABLE basketball_slot_plan
  DROP CONSTRAINT IF EXISTS basketball_slot_plan_proposal_status_check;

ALTER TABLE basketball_slot_plan
  ADD CONSTRAINT basketball_slot_plan_proposal_status_check
  CHECK (proposal_status::text = ANY (ARRAY[
    'draft'::text,          -- ours, not yet published to the club
    'offered'::text,        -- ours, published
    'club_proposed'::text,  -- THEIRS, awaiting a planner
    'accepted'::text,
    'declined'::text,
    'countered'::text
  ]));

COMMENT ON COLUMN basketball_slot_plan.proposal_status IS
  'Who proposed and where it stands. draft/offered = KSCW proposed; club_proposed = the opponent picked a free pitch through its portal and a planner has not confirmed it; accepted/declined/countered = an answer to an offer. A club_proposed row is a preference, not a booking — ProBasket assigns fixtures at the Spielplansitzung.';

DO $$
DECLARE ok boolean;
BEGIN
  -- Assert the constraint actually admits the new value rather than trusting the DDL.
  BEGIN
    PERFORM 1 FROM basketball_slot_plan WHERE proposal_status = 'club_proposed';
    ok := true;
  EXCEPTION WHEN others THEN
    ok := false;
  END;
  IF NOT ok THEN
    RAISE EXCEPTION 'migration 289: club_proposed not accepted by the CHECK';
  END IF;
  RAISE NOTICE 'migration 289: proposal_status now admits club_proposed';
END $$;

COMMIT;
