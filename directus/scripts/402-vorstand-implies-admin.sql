-- Migration 402: a board member (vorstand) is always a club admin.
--
-- WHY
-- ---
-- Decided 09.10.2026: the board sees and runs everything the admins do. Until now
-- `vorstand` was its own narrower tier (finance, forms, registrations, invites) and
-- two of the five board members could not open most of the admin pages.
--
-- The `admin` check is spread over ~56 call sites (frontend flags, 34 endpoint files,
-- the role-sync hook that picks the Directus role, setup-permissions' tier reconcile).
-- Teaching each of them that vorstand counts too would miss the next one somebody
-- writes. So the rule lives where the roles live: `members.role` itself.
--
-- WHAT CHANGES
-- ------------
--   1. members_vorstand_implies_admin() BEFORE INSERT/UPDATE OF role:
--        - role has 'vorstand' and lacks 'admin'       → 'admin' is added.
--        - an UPDATE drops 'vorstand' but leaves 'admin' → 'admin' is dropped with it,
--          so leaving the board never leaves a stray admin behind. Someone who should
--          stay admin after leaving the board gets 'admin' re-ticked in a second save.
--      Unticking 'admin' alone on a board member does nothing — it comes straight back.
--   2. Backfill: every current vorstand member gets 'admin'.
--   3. Their login moves to the Directus `Superuser` role — what the role-sync hook
--      (kscw-hooks resolveDirectusRole) assigns to any 'admin' member. The hook only
--      runs on items-API writes, so the raw backfill sets it here. A user already on
--      `Administrator` is left alone.
--
-- ⚠ `admin` = Directus admin_access: every permission check is bypassed, every PII
-- column is readable. That is the intent; only admin/superuser can write
-- members.role (kscw-hooks priv-strip filter), so nobody else can mint a vorstand.
--
-- Schema-only + idempotent, per the migration policy. No permission rows.

BEGIN;

-- ── 1. The rule ──────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION members_vorstand_implies_admin() RETURNS trigger AS $$
BEGIN
  IF NEW.role IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.role @> '["vorstand"]'::jsonb AND NOT NEW.role @> '["admin"]'::jsonb THEN
    NEW.role := NEW.role || '["admin"]'::jsonb;
  ELSIF TG_OP = 'UPDATE'
    AND OLD.role IS NOT NULL
    AND OLD.role @> '["vorstand"]'::jsonb
    AND NOT NEW.role @> '["vorstand"]'::jsonb
    AND OLD.role @> '["admin"]'::jsonb
    AND NEW.role @> '["admin"]'::jsonb THEN
    NEW.role := NEW.role - 'admin';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_members_vorstand_implies_admin ON members;
CREATE TRIGGER trg_members_vorstand_implies_admin
  BEFORE INSERT OR UPDATE OF role ON members
  FOR EACH ROW EXECUTE FUNCTION members_vorstand_implies_admin();

-- ── 2. Backfill the role array ───────────────────────────────────────────────

UPDATE members
SET role = role || '["admin"]'::jsonb
WHERE role @> '["vorstand"]'::jsonb
  AND NOT role @> '["admin"]'::jsonb;

-- ── 3. Their logins move to the Superuser Directus role ──────────────────────

UPDATE directus_users u
SET role = su.id
FROM members m,
     directus_roles su
WHERE m."user" = u.id
  AND m.role @> '["vorstand"]'::jsonb
  AND su.name = 'Superuser'
  AND u.role IS DISTINCT FROM su.id
  AND u.role NOT IN (SELECT id FROM directus_roles WHERE name = 'Administrator');

COMMIT;
