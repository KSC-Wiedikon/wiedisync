-- Migration 121: scorer delegations always require the recipient to accept.
--
-- Previously trg_scorer_delegation_validate() (migration 001) auto-accepted
-- same-team delegations: `IF NEW.same_team THEN NEW.status := 'accepted'`. Per
-- product decision, EVERY delegation — to a teammate OR an external member —
-- must be accepted by the recipient. Drop the auto-accept. The same_team flag
-- is still computed (the UI uses it only to group "Your team" vs "Other members").
--
-- Pairs with the frontend change that inserts status='pending' unconditionally.
-- Either side alone is harmless (a delegation only goes instant when BOTH the
-- frontend writes 'accepted' AND the trigger leaves it), so deploy order is free.
--
-- Idempotent: CREATE OR REPLACE FUNCTION.

CREATE OR REPLACE FUNCTION trg_scorer_delegation_validate()
RETURNS trigger AS $$
BEGIN
  -- Keep the same_team flag (UI grouping only). Do NOT auto-accept: every
  -- delegation stays 'pending' until the recipient accepts it.
  NEW.same_team := (NEW.from_team = NEW.to_team);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;
