-- Migration 106: Per-team scheduling contacts (team responsibles).
--
-- Opponent contacts came in two flavours: the club-level Spielplanverantwortlicher
-- (the "calendar responsible", bulk feed) and — only as a fallback when a club had
-- none — a Teamverantwortlicher harvested per game. The team responsible is the
-- person who actually handles THAT team's scheduling, so we now pull them for every
-- opponent team and MERGE them with the calendar responsible (calendar + team
-- responsibles, not either/or).
--
-- To attach a harvested team responsible to the specific opponent TEAM (not the
-- whole club — a club can field several teams against us) we key it by the VM
-- staticTeamIdentifier. `team_identifier` holds that id for team-responsible rows
-- (synthetic `tr:` persistence ids); it is NULL for the club-level Spielplaner rows
-- and for legacy fallback rows (both treated as club-wide).
--
-- Schema-only + idempotent per the CLAUDE.md migration policy. svrz_spielplaner_contacts
-- is endpoint-gated and the scheduling read policies grant fields ['*'], so no
-- permission row is needed.

BEGIN;

ALTER TABLE svrz_spielplaner_contacts
  ADD COLUMN IF NOT EXISTS team_identifier character varying(255);

-- Register the field with Directus so the items API (the sync script writes via
-- REST) can read AND write it.
INSERT INTO directus_fields (collection, field, special, interface, sort, width, note)
SELECT 'svrz_spielplaner_contacts', 'team_identifier', NULL, 'input', 50, 'half',
       'Opponent team staticTeamIdentifier for team-responsible (tr:) rows; NULL for club-level Spielplaner rows.'
WHERE NOT EXISTS (
  SELECT 1 FROM directus_fields
  WHERE collection = 'svrz_spielplaner_contacts' AND field = 'team_identifier'
);

COMMIT;
