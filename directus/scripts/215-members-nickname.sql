-- Migration 215: members.nickname — the preferred display name shown INSTEAD of
-- the legal first name across the app UI.
--
-- Some members go by a short/friendly name rather than their legal first name —
-- e.g. Jan Cerny → "Honza", Thamalayant → "Thamy", Sharusant → "Sharu". The app
-- only stored first_name/last_name, so these members appeared under names nobody
-- uses day-to-day. This adds a nullable `nickname` column that the UI prefers
-- over first_name when set.
--
-- SCOPE — where nickname is used vs. the legal first_name:
--   * UI display (rosters, RSVP lists, chat, absences, delegation, scheduling
--     pairing cards, home, admin/finance record views) → nickname ?? first_name.
--   * Legal/official surfaces ALWAYS keep first_name: match sheets / VM
--     Einsatzliste, ClubDesk sync, invoices & QR-bills, identity documents,
--     official emails, and the public website (kscw.ch) rosters.
--
-- Editable by the member (own profile) and admins (member editor). Permissions
-- for the field live in setup-permissions.mjs (added to MEMBER_VISIBLE_FIELDS,
-- MEMBER_EDITABLE_FIELDS, LEADER_TEAM_MEMBER_FIELDS, FINANCE_MEMBER_FIELDS) —
-- NOT here (repo migration policy #1: numbered migrations are schema-only).
--
-- Schema-only + idempotent (repo policy #2). The kscw-hooks `trimMemberStrings`
-- filter already trims every members text column on write, so nickname is
-- auto-trimmed — no hook change needed.

BEGIN;

ALTER TABLE members ADD COLUMN IF NOT EXISTS nickname text;

COMMENT ON COLUMN members.nickname IS
  'Preferred display name shown instead of first_name across the app UI (e.g. "Honza" for Jan Cerny). NULL/empty = fall back to first_name. Legal/official surfaces (match sheets, VM, ClubDesk, invoices, public website) always use first_name.';

-- Expose it in the Directus items API / admin member editor so it can be set
-- without a migration.
INSERT INTO directus_fields (collection, field, interface, readonly, hidden, sort, width, note)
SELECT 'members', 'nickname', 'input', false, false, 5, 'half',
  'Preferred display name shown instead of the first name across the app (e.g. "Honza"). Leave empty to use the legal first name. Official documents always use the legal name.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'members' AND field = 'nickname');

COMMIT;
