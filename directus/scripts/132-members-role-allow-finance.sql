-- Migration 132: allow 'finance' in the members.role allow-list.
--
-- Adds a new ORTHOGONAL app-role 'finance' (treasurer / finance team). Like
-- is_spielplaner, it's a capability layered on top of whatever base Directus
-- role a member has — the role-sync hook + setup-permissions.mjs §13 attach the
-- `KSCW Finance` policy directly to the member's directus user. The base-role
-- mapping (resolveDirectusRole) is unchanged; a ['finance'] member stays a
-- Directus "Member" and simply gains the Finance policy on top.
--
-- Fixes FORWARD over migration 005 (the apply-once runner forbids editing an
-- already-applied migration): drop the old CHECK and recreate it with 'finance'
-- appended. Schema-only + idempotent.

BEGIN;

ALTER TABLE members DROP CONSTRAINT IF EXISTS members_role_values_valid;
ALTER TABLE members ADD CONSTRAINT members_role_values_valid
  CHECK (role::jsonb <@ '["user","admin","superuser","vb_admin","bb_admin","vorstand","website_admin","finance"]'::jsonb);

COMMIT;
