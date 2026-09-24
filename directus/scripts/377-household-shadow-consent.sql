-- 377-household-shadow-consent.sql
--
-- A household link to a MANAGED member ends the moment that member stops being
-- a managed shadow — i.e. the moment she has a login of her own.
--
-- WHY
-- ---
-- Consent in the households model (migration 348) is structural: a grant may
-- only target a member with no usable login — `members."user"` NULL, or a
-- shadow user on @managed.wiedisync.kscw.ch with status 'draft' and no
-- password. The link endpoint enforced that at LINK time only. Nothing
-- enforced it afterwards: when a managed child later got a real login (her own
-- signup, an admin attaching an account, someone setting a password or
-- activating the shadow row), the link stayed live and the acting middleware
-- kept accepting it through its `status = 'active'` branch. The child could
-- log in herself while a parent silently went on acting as her.
--
-- The middleware now accepts draft shadows only (kscw-hooks acting-member.js).
-- This migration makes the DATA agree, so /admin/households never shows a live
-- link the middleware refuses, and member_guardians (rebuilt by migration 348's
-- trigger on household_members) drops the grant in the same statement.
--
-- WHAT
-- ----
-- is_managed_shadow_row(email, status, password) — the one definition, pure.
-- is_managed_shadow(uuid)                        — the same, by user id. NULL
--                                                  and unknown ids are false.
-- trg_members_user_revoke_managed    AFTER UPDATE OF "user" ON members:
--     the member's login changed to something that is NOT a shadow → revoke
--     her live `managed` rows. Setting "user" to NULL does NOT revoke: a member
--     with no login at all is still a legitimate managed target.
-- trg_directus_users_revoke_managed  AFTER UPDATE OF email, status, password
--     ON directus_users: the row WAS a shadow and no longer is → revoke the
--     live `managed` rows of every member pointing at it.
-- One backfill: live managed rows whose member ALREADY holds a non-shadow
--     login are revoked now (the middleware refuses them since this release
--     anyway; this only makes the admin page truthful). Prints the count.
--
-- revoked_by stays NULL on these rows — migration 348's CHECK allows that
-- precisely for the automatic revocation paths, which have no acting human.
--
-- ⚠ The domain literal is mirrored in kscw-endpoints/src/household.js and
-- kscw-hooks/src/acting-member.js (MANAGED_EMAIL_DOMAIN). Change all three.
--
-- ⚠ Dev refresh: the nightly PII scrub (refresh-dev-daily.sh +
-- refresh-dev-from-prod.sh) rewrites directus_users.email. It MUST exclude
-- '%@managed.wiedisync.kscw.ch' (synthetic, no PII) — otherwise the second
-- trigger sees every shadow "stop being a shadow" and revokes every live
-- managed link on dev each night.
--
-- ⚠ No permission rows (migrations are SCHEMA-ONLY) and no directus_fields
-- rows: nothing here is a Directus-visible field, so no restart is needed for
-- schema-cache reasons.
--
-- Schema-only + idempotent per the CLAUDE.md migration policy.

BEGIN;

CREATE OR REPLACE FUNCTION is_managed_shadow_row(p_email text, p_status text, p_password text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(lower(p_email) LIKE '%@managed.wiedisync.kscw.ch', false)
     AND coalesce(p_status = 'draft', false)
     AND p_password IS NULL
$$;

COMMENT ON FUNCTION is_managed_shadow_row(text, text, text) IS
  'True for an unloginnable managed shadow login: @managed.wiedisync.kscw.ch, status draft, no password (migration 377). Mirrors isShadowUser() in kscw-endpoints household.js and the resolveGrant check in kscw-hooks acting-member.js.';

CREATE OR REPLACE FUNCTION is_managed_shadow(p_user uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT coalesce((
    SELECT is_managed_shadow_row(u.email, u.status, u.password)
      FROM directus_users u
     WHERE u.id = p_user
  ), false)
$$;

COMMENT ON FUNCTION is_managed_shadow(uuid) IS
  'is_managed_shadow_row() by directus_users id; NULL or unknown id → false (migration 377).';

-- ── members."user" changed ──────────────────────────────────────────

CREATE OR REPLACE FUNCTION trg_members_user_revoke_managed()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."user" IS NOT NULL AND NOT is_managed_shadow(NEW."user") THEN
    UPDATE household_members
       SET revoked_at = now()
     WHERE member = NEW.id
       AND role = 'managed'
       AND revoked_at IS NULL;
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_members_user_revoke_managed ON members;
CREATE TRIGGER trg_members_user_revoke_managed
  AFTER UPDATE OF "user" ON members
  FOR EACH ROW WHEN (OLD."user" IS DISTINCT FROM NEW."user")
  EXECUTE FUNCTION trg_members_user_revoke_managed();

-- ── the shadow login itself stopped being a shadow ──────────────────

CREATE OR REPLACE FUNCTION trg_directus_users_revoke_managed()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF is_managed_shadow_row(OLD.email, OLD.status, OLD.password)
     AND NOT is_managed_shadow_row(NEW.email, NEW.status, NEW.password) THEN
    UPDATE household_members hm
       SET revoked_at = now()
      FROM members m
     WHERE m."user" = NEW.id
       AND hm.member = m.id
       AND hm.role = 'managed'
       AND hm.revoked_at IS NULL;
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_directus_users_revoke_managed ON directus_users;
CREATE TRIGGER trg_directus_users_revoke_managed
  AFTER UPDATE OF email, status, password ON directus_users
  FOR EACH ROW WHEN (
    OLD.email    IS DISTINCT FROM NEW.email
    OR OLD.status   IS DISTINCT FROM NEW.status
    OR OLD.password IS DISTINCT FROM NEW.password
  )
  EXECUTE FUNCTION trg_directus_users_revoke_managed();

-- ── backfill: links that already violate the rule ───────────────────

DO $$
DECLARE n integer;
BEGIN
  UPDATE household_members hm
     SET revoked_at = now()
    FROM members m
   WHERE hm.member = m.id
     AND hm.role = 'managed'
     AND hm.revoked_at IS NULL
     AND m."user" IS NOT NULL
     AND NOT is_managed_shadow(m."user");
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE '377: revoked % live managed link(s) whose member holds a real login', n;
END $$;

COMMIT;
