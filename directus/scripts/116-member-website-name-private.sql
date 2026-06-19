-- Migration 116: website_name_private privacy flag (website-scoped, mirrors hide_email).
--
-- When true, the member's PUBLIC website footprint is minimised: on the public
-- club website (kscw-website) their surname is shown as an initial only
-- ("Anna M.") and their year of birth is hidden. First name, number, position
-- and photo (the photo is independently gated by website_visible) are unaffected.
--
-- This is a WEBSITE-only control — it does NOT change what logged-in members or
-- coaches see inside wiedisync (they still see full names). Enforcement is
-- server-side in two places, never the browser:
--   1. the /kscw/public/team/:id endpoint (kscw-endpoints) — the roster source
--      the website actually reads; abbreviates surname + drops yob there.
--   2. the kscw-hooks "Member Privacy" members.items.read filter — for ANONYMOUS
--      callers only, closing the raw /items/members public-read path too.
--
-- Schema-only + idempotent. Permissions for the new field live in
-- setup-permissions.mjs (added to MEMBER_EDITABLE_FIELDS). Members toggle it
-- from Profile → Privacy.

BEGIN;

ALTER TABLE members ADD COLUMN IF NOT EXISTS website_name_private boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN members.website_name_private IS
  'When true, the member''s public website roster entry shows the surname as an initial only ("Anna M.") and hides the year of birth. Website-scoped only — internal app shows full names. Enforced server-side in the /public/team/:id endpoint and the kscw-hooks Member Privacy filter (anonymous callers).';

-- Directus field metadata so the column is editable from the admin UI.
-- Mirrors the existing hide_email field row (special=NULL, boolean interface).
INSERT INTO directus_fields (collection, field, special, interface, sort, hidden, note)
SELECT 'members', 'website_name_private', NULL, 'boolean', 19, false,
  'Show only first name (+ surname initial) and hide year of birth on the public website. Enforced server-side.'
WHERE NOT EXISTS (
  SELECT 1 FROM directus_fields WHERE collection = 'members' AND field = 'website_name_private'
);

COMMIT;
