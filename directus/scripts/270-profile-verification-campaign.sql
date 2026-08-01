-- Migration 270: annual "check your data" gate — members confirm their own
-- record before the licence run.
--
-- Every season the club pushes member data into the licence process (Swiss
-- Volley / Basketplan) and into the ClubDesk register, and every season a
-- handful of addresses, phone numbers and IBANs turn out to be stale. Migration
-- 262 added a HARD gate for members whose core contact set was never collected
-- at all; this adds the recurring counterpart: a one-off confirmation that the
-- data already on file is still correct.
--
-- It is deliberately a CONFIRMATION, not a completeness check. A large share of
-- members legitimately have no IBAN and no AHV number, so requiring every field
-- would trap exactly the people who have nothing to fix. The core contact set
-- stays required (that is 262's rule, unchanged); everything else is shown,
-- and pressing "everything is correct" stamps profile_verified_at.
--
-- Two moving parts:
--   members.profile_verified_at  — when this member last confirmed.
--   app_settings.value           — free-text value next to the existing
--                                  `enabled` switch, so a campaign is
--                                  (key='profile_review', enabled=true,
--                                  value='2026-08-15'). A member is due when
--                                  profile_verified_at IS NULL OR < value, so
--                                  next season is two field edits in the admin
--                                  UI rather than a redeploy.
--
-- ⚠ profile_verified_at is also added to MEMBER_EDITABLE_FIELDS in
-- setup-permissions.mjs in the same commit — without that grant the member's
-- own save silently drops it (Directus strips ungranted fields rather than
-- erroring) and the gate would reappear on every single login.
--
-- Schema-only + idempotent.

BEGIN;

ALTER TABLE members
  ADD COLUMN IF NOT EXISTS profile_verified_at timestamptz;

COMMENT ON COLUMN members.profile_verified_at IS
  'When the member last confirmed their own profile is correct (the annual pre-licence data check). NULL = never confirmed. Compared against app_settings key=''profile_review'' value=<ISO date>; older than that ⇒ the hard confirmation gate shows at next login.';

-- Partial index: the admin "who has not confirmed yet" list is the whole point
-- of the campaign, and it always reads the NULL / stale end.
CREATE INDEX IF NOT EXISTS members_profile_verified_at_idx
  ON members (profile_verified_at NULLS FIRST)
  WHERE kscw_membership_active;

INSERT INTO directus_fields (collection, field, interface, readonly, hidden, sort, width, note)
SELECT 'members', 'profile_verified_at', 'datetime', true, false, 210, 'half',
  'Last time the member confirmed their profile is correct (annual pre-licence data check). Read-only here — it is stamped by the member''s own confirmation, not by staff.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'members' AND field = 'profile_verified_at');

-- app_settings has only (key, enabled) — a boolean switch with nowhere to put
-- the campaign cutoff. One nullable text column keeps every existing flag row
-- working untouched (scorer_reminders_enabled etc. simply leave it NULL).
ALTER TABLE app_settings
  ADD COLUMN IF NOT EXISTS value text;

COMMENT ON COLUMN app_settings.value IS
  'Optional payload for flags that need more than on/off, e.g. profile_review holds the ISO cutoff date a confirmation must be newer than. NULL for plain boolean flags.';

INSERT INTO directus_fields (collection, field, interface, readonly, hidden, sort, width, note)
SELECT 'app_settings', 'value', 'input', false, false, 10, 'half',
  'Optional value for flags that need more than on/off. For key=profile_review: the ISO cutoff date (YYYY-MM-DD); confirmations older than this are re-requested.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'app_settings' AND field = 'value');

-- Seed the campaign row DISABLED. Enabling it gates every member who can log
-- in, so it is switched on deliberately from the admin UI after the club has
-- announced it — never as a side effect of a deploy.
INSERT INTO app_settings (key, enabled, value, date_created)
SELECT 'profile_review', false, NULL, NOW()
WHERE NOT EXISTS (SELECT 1 FROM app_settings WHERE key = 'profile_review');

COMMIT;
