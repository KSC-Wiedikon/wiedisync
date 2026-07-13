-- Migration 205: teams.clubdesk_group — the ClubDesk group token per team.
--
-- Until now the team → ClubDesk group mapping lived as a hardcoded inline SQL
-- CASE inside /clubdesk-group-sync (7 special cases). Two problems with that:
--
--   1. A renamed or newly created team silently changes/loses its mapping, and
--      the group checks then quietly stop covering it — the same failure class
--      as the hardcoded sv-sync team allow-list. Nothing surfaces.
--   2. The endpoint's own comment claimed it was "keyed on teams.clubdesk_group
--      (migration 201)" — but no such column and no such migration ever existed.
--
-- This materialises the mapping as data, with a deliberate three-state semantic
-- so a new team can never be silently skipped:
--
--   clubdesk_group IS NULL  → NOT configured yet  → the endpoint FLAGS it
--                             ("unmapped team"). This is the default for any
--                             newly inserted team, which is exactly what we want.
--   clubdesk_group = ''     → intentionally has NO ClubDesk group (the league
--                             umbrella teams) → excluded from the checks, and
--                             deliberately NOT flagged.
--   otherwise               → the exact ClubDesk group token, e.g. 'VB D1'.
--
-- The backfill below reproduces the previous inline CASE exactly, so the checks
-- return identical results the moment the endpoint switches to reading it.
-- Schema-only + idempotent, per the migration policy.

BEGIN;

ALTER TABLE teams ADD COLUMN IF NOT EXISTS clubdesk_group text;

COMMENT ON COLUMN teams.clubdesk_group IS
  'ClubDesk group token for this team (e.g. ''VB D1''). NULL = not configured yet (flagged by the ClubDesk group check); '''' = intentionally no ClubDesk group (league umbrella).';

-- Backfill — reproduces the retired inline CASE 1:1. Only touches rows that are
-- still NULL, so re-running never clobbers a hand-corrected mapping.
UPDATE teams SET clubdesk_group = ''       WHERE clubdesk_group IS NULL AND name IN ('H-Classics 1LR', 'Damen D-Classics 1LR');
UPDATE teams SET clubdesk_group = 'BB H1'  WHERE clubdesk_group IS NULL AND sport = 'basketball' AND name = 'Herren 1 H1';
UPDATE teams SET clubdesk_group = 'BB H2'  WHERE clubdesk_group IS NULL AND sport = 'basketball' AND name = 'Herren 2 H3';
UPDATE teams SET clubdesk_group = 'BB H3'  WHERE clubdesk_group IS NULL AND sport = 'basketball' AND name = 'Herren 3 (Unicorns) H4';
UPDATE teams SET clubdesk_group = 'BB Lions'  WHERE clubdesk_group IS NULL AND sport = 'basketball' AND name = 'Lions D1';
UPDATE teams SET clubdesk_group = 'BB Rhinos' WHERE clubdesk_group IS NULL AND sport = 'basketball' AND name = 'Rhinos D3';
UPDATE teams SET clubdesk_group = 'VB ' || name WHERE clubdesk_group IS NULL AND sport = 'volleyball';
UPDATE teams SET clubdesk_group = 'BB ' || name WHERE clubdesk_group IS NULL AND sport = 'basketball';
-- Any other sport has no ClubDesk group concept → intentionally none.
UPDATE teams SET clubdesk_group = ''       WHERE clubdesk_group IS NULL AND sport NOT IN ('volleyball', 'basketball');

-- Expose it in the Directus items API / admin so the mapping can be corrected
-- without a migration (that is the whole point of moving it out of code).
INSERT INTO directus_fields (collection, field, interface, readonly, hidden, sort, width, note)
SELECT 'teams', 'clubdesk_group', 'input', false, false, 60, 'half',
  'ClubDesk group token (e.g. "VB D1"). Empty = intentionally no ClubDesk group. Leave unset on a new team and the ClubDesk group check will flag it.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'teams' AND field = 'clubdesk_group');

COMMIT;
