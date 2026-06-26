-- Migration 148: scorer delegations — force status='pending' on INSERT.
--
-- Audit 2026-06-25 (PG-1, HIGH). Migration 121 dropped the same-team
-- auto-accept, but the validate trigger still does NOT constrain `status` on
-- INSERT and the Member create grant exposes the column. A low-privilege
-- member could POST /items/scorer_delegations with status='accepted' (and an
-- arbitrary game id), firing the kscw-hooks delegation-transfer that reassigns
-- a game's scorer/timekeeper duty via raw knex — bypassing the LEADER-only
-- games.update permission, and able to force a duty onto a non-consenting
-- victim. Force every freshly inserted delegation to 'pending' at the DB level
-- so acceptance ALWAYS requires the recipient's explicit accept (the
-- recipient-gated endpoint or the recipient-gated items-API update path).
--
-- This is the DB layer; kscw-hooks transferDelegatedDuty additionally gates the
-- transfer on (acting user == recipient) AND (delegator currently holds the
-- duty), and the /scorer-delegation/accept endpoint re-checks duty ownership.
--
-- Idempotent: CREATE OR REPLACE FUNCTION (trigger binding from 001 unchanged).

CREATE OR REPLACE FUNCTION trg_scorer_delegation_validate()
RETURNS trigger AS $$
BEGIN
  -- Keep the same_team flag (UI grouping only).
  NEW.same_team := (NEW.from_team = NEW.to_team);
  -- Every delegation starts pending; only the recipient's accept may flip it.
  IF TG_OP = 'INSERT' THEN
    NEW.status := 'pending';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;
