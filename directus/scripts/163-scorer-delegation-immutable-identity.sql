-- Migration 163: scorer_delegations — freeze the delegation's identity on UPDATE.
--
-- Audit 2026-07-02 (#3, HIGH). Migration 148 forces status='pending' only on
-- INSERT, and the Member `scorer_delegations.update` grant was fields:['*']
-- scoped merely by OWN_DELEGATION (from_member OR to_member = me). A member who
-- is a party to ANY delegation could therefore PATCH `from_member`/`to_member`/
-- `game`/`role`/`to_team` and flip `status='accepted'`, driving the kscw-hooks
-- delegation-transfer to reassign a game's scorer/timekeeper duty via raw knex
-- — bypassing the LEADER-only games.update permission and defeating the consent
-- model (from_member is forced to the creator on INSERT, but was mutable after).
--
-- Defense in depth: setup-permissions.mjs now restricts the Member update grant
-- to fields:['status'] (the recipient's accept is the only legitimate item-API
-- mutation). This trigger is the DB-layer backstop so the identity columns are
-- immutable regardless of the field whitelist — a raw write or a future grant
-- widening can no longer forge a transfer. `status`, the timestamps and the
-- derived `same_team` flag remain editable.
--
-- Admin/service writes go through the same trigger by design: nothing should
-- re-point a delegation's parties after creation; issue a new row instead.
--
-- Idempotent: CREATE OR REPLACE FUNCTION + DROP TRIGGER IF EXISTS then CREATE.
-- Self-wrapped in a transaction (the runner does not add an outer one).

BEGIN;

CREATE OR REPLACE FUNCTION trg_scorer_delegation_freeze_identity()
RETURNS trigger AS $$
BEGIN
  IF NEW.from_member IS DISTINCT FROM OLD.from_member
     OR NEW.to_member IS DISTINCT FROM OLD.to_member
     OR NEW.game        IS DISTINCT FROM OLD.game
     OR NEW.role        IS DISTINCT FROM OLD.role
     OR NEW.from_team   IS DISTINCT FROM OLD.from_team
     OR NEW.to_team     IS DISTINCT FROM OLD.to_team THEN
    RAISE EXCEPTION 'scorer_delegations: from_member/to_member/game/role/team are immutable after creation (issue a new delegation instead)'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS trg_scorer_delegation_freeze_identity ON scorer_delegations;
CREATE TRIGGER trg_scorer_delegation_freeze_identity
  BEFORE UPDATE ON scorer_delegations
  FOR EACH ROW EXECUTE FUNCTION trg_scorer_delegation_freeze_identity();

COMMIT;
