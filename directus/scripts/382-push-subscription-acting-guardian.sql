-- 382: a push subscription registered while acting ends with the grant
--
-- Security audit 2026-09-28, F37 (Low). A main account acting for a linked
-- member (households, migration 348) registers HER OWN device for the member's
-- pushes — `push_subscriptions.member` is the child, the endpoint is the
-- parent's browser. Nothing ever unbound it: after the guardian link was
-- revoked, or the child got a login of her own (migration 377 revokes the
-- managed link then), the parent's device kept receiving every push meant for
-- the child — fines, RSVP reminders, carpool pickups — for as long as the
-- browser kept the subscription.
--
-- WHAT
-- ----
-- push_subscriptions.acting_guardian_user  uuid, the guardian login that
--     registered the row while acting; NULL for an ordinary own-device row.
--     Stamped server-side only: kscw-hooks `push_subscriptions.items.create`
--     (items API) and /kscw/web-push/subscribe (raw knex) take it from the
--     acting swap (`accountability.kscwGuardian.user`), never from the body;
--     kscw-hooks strips it from items-API updates. ON DELETE CASCADE: a deleted
--     guardian login takes her device rows with it.
-- trg_member_guardians_unbind_push  a DEFERRED constraint trigger on
--     member_guardians DELETE. At COMMIT it deletes the child's subscriptions
--     registered by that guardian — unless the grant still exists then.
--
-- ⚠ Why deferred: member_guardians is DERIVED. rebuild_member_guardians()
-- (348) DELETEs every row of a household and re-INSERTs the survivors in the
-- same transaction on ANY household_members change (a new sibling linked, an
-- accent colour edited). A plain AFTER DELETE trigger would fire between the
-- two statements, see no grant, and unbind every acting device on every
-- rebuild. Checked at commit, only a grant that is really gone unbinds.
--
-- Logout is NOT covered: Directus emits no `auth.logout` hook, so the server
-- cannot tell a logout happened. Unbinding on logout is a frontend change
-- (the logout path calling /kscw/web-push/unsubscribe, which it does not today).
--
-- The column is registered hidden + readonly (no directus_fields row would
-- read back as an alias until restart — CLAUDE.md "raw-SQL directus_fields
-- insert does NOT bust the schema cache": restart after deploying).
-- No permission rows. Schema-only + idempotent per the CLAUDE.md policy.

BEGIN;

ALTER TABLE push_subscriptions
  ADD COLUMN IF NOT EXISTS acting_guardian_user uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'push_subscriptions_acting_guardian_user_fkey'
       AND conrelid = 'public.push_subscriptions'::regclass
  ) THEN
    ALTER TABLE push_subscriptions
      ADD CONSTRAINT push_subscriptions_acting_guardian_user_fkey
      FOREIGN KEY (acting_guardian_user) REFERENCES directus_users(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS push_subscriptions_acting_guardian_ix
  ON push_subscriptions (acting_guardian_user, member)
  WHERE acting_guardian_user IS NOT NULL;

COMMENT ON COLUMN push_subscriptions.acting_guardian_user IS
  'Guardian login that registered this device while acting for `member` (households, migration 348). NULL = the member''s own device. Server-stamped; the row is deleted when that grant ends (migration 382).';

CREATE OR REPLACE FUNCTION trg_member_guardians_unbind_push()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  -- Deferred to COMMIT: the grant may have been re-inserted by the same
  -- rebuild that deleted it (any household) — then nothing ended.
  IF EXISTS (
    SELECT 1 FROM member_guardians
     WHERE member = OLD.member AND guardian_user = OLD.guardian_user
  ) THEN
    RETURN NULL;
  END IF;
  DELETE FROM push_subscriptions
   WHERE member = OLD.member
     AND acting_guardian_user = OLD.guardian_user;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_member_guardians_unbind_push ON member_guardians;
CREATE CONSTRAINT TRIGGER trg_member_guardians_unbind_push
  AFTER DELETE ON member_guardians
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION trg_member_guardians_unbind_push();

INSERT INTO directus_fields (collection, field, hidden, readonly, sort, width, note)
SELECT 'push_subscriptions', 'acting_guardian_user', true, true, 20, 'full',
       'Guardian login that registered this device while acting. Server-stamped (migration 382).'
WHERE NOT EXISTS (
  SELECT 1 FROM directus_fields WHERE collection = 'push_subscriptions' AND field = 'acting_guardian_user'
);

COMMIT;
