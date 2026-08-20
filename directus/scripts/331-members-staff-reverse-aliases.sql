-- Migration 331: name the reverse side of the two staff junctions on `members`
--
-- A coach/TR could not edit the `position` or `number` of a STAFF-ONLY person on
-- their own team — someone linked through `teams_coaches` / `teams_responsibles`
-- who has no `member_teams` row. TeamDetail's Staff section renders exactly
-- those people (the `extraCoaches` fetch, TeamDetail.tsx:110-128) with an
-- editable number + position cell, but the only `members.update` row scoped to a
-- leader's own team walks `member_teams.team.{coach,team_responsible}` — which a
-- staff-only person does not have. Every such edit 403'd, and MemberRow.saveField
-- swallowed the rejection, so the value just snapped back with no message.
-- Surfaced 2026-08-20 by D2's (volleyball) coach; 38 people across 25 active
-- teams are staff-only right now, so it was reachable on nearly every team.
--
-- The fix needs a filter that walks from a MEMBER to the teams they are staff
-- of, and no such path was expressible: `teams.coach` / `teams.team_responsible`
-- name the team side of each junction, but the member side of both relations had
-- `one_field` NULL. This names them.
--
-- Metadata only. The junction tables, their columns and both relation rows
-- already exist — this fills in `one_field` (Directus's "one field" on an
-- existing relation) and registers the matching alias so the items API and the
-- permission engine can resolve it. No DDL, no data, no new column.
--
-- ⚠ Deliberately mirrors `members.member_teams` (special `o2m`, interface
-- `list-o2m`) rather than declaring m2m: that shape is already proven to walk
-- correctly in a policy filter (`COACH_TEAM_MEMBERS` filters
-- `member_teams.team.…`), and it keeps the junction row itself addressable, so
-- the new rule reads `coach_of.teams_id.…` — the junction's FK, not a synthetic
-- m2m hop. `teams.coach` stays m2m and is untouched.
--
-- ⚠ Both aliases are `hidden` — they exist so `setup-permissions.mjs` can scope a
-- row, not to add two lists to the member detail form. Hidden affects the admin
-- UI only; filters resolve regardless.
--
-- ⚠ Directus caches the schema at boot, and `db:deploy:*` does NOT restart
-- between `db:migrate:*` and `db:setup-perms:*`. Restart the container by hand
-- in between, or the new rule is written against aliases the running instance
-- cannot resolve:
--   npm run db:migrate:prod
--   ssh hetzner "sudo docker restart directus-kscw"
--   npm run db:setup-perms:prod && npm run db:smoke:prod
--
-- ⚠ The permission half CANNOT be verified on dev: dev runs keyless (memory
-- `directus-v12-license`), so `POST /permissions` 403s on every FILTERED row and
-- `db:setup-perms:dev` cannot apply this one. What dev does prove is that the
-- aliases resolve — filter `/items/members?filter[coach_of][teams_id][_eq]=<id>`
-- with an admin token returns rows instead of erroring on an unknown field.
--
-- Permissions are NOT set here — see setup-permissions.mjs (§ Members update,
-- COACH_TEAM_STAFF). Idempotent.

BEGIN;

UPDATE directus_relations
   SET one_field = 'coach_of'
 WHERE many_collection = 'teams_coaches'
   AND many_field = 'members_id'
   AND one_collection = 'members'
   AND one_field IS DISTINCT FROM 'coach_of';

UPDATE directus_relations
   SET one_field = 'team_responsible_of'
 WHERE many_collection = 'teams_responsibles'
   AND many_field = 'members_id'
   AND one_collection = 'members'
   AND one_field IS DISTINCT FROM 'team_responsible_of';

-- ⚠ NULL in a VALUES list types as text and `options` is json — cast it.
INSERT INTO directus_fields (collection, field, special, interface, options, readonly, hidden, sort, width, "group", note)
SELECT 'members', 'coach_of', 'o2m', 'list-o2m', NULL::json, true, true, 13, 'full', 'grp_club_status',
       'Reverse of teams.coach — the teams this member coaches. Alias (no column); exists so a permission filter can walk member → staff team.'
WHERE NOT EXISTS (
  SELECT 1 FROM directus_fields WHERE collection = 'members' AND field = 'coach_of'
);

INSERT INTO directus_fields (collection, field, special, interface, options, readonly, hidden, sort, width, "group", note)
SELECT 'members', 'team_responsible_of', 'o2m', 'list-o2m', NULL::json, true, true, 14, 'full', 'grp_club_status',
       'Reverse of teams.team_responsible — the teams this member is responsible for. Alias (no column); exists so a permission filter can walk member → staff team.'
WHERE NOT EXISTS (
  SELECT 1 FROM directus_fields WHERE collection = 'members' AND field = 'team_responsible_of'
);

COMMIT;

-- Verification (dev/prod):
--   SELECT many_collection, many_field, one_collection, one_field FROM directus_relations
--    WHERE many_collection IN ('teams_coaches','teams_responsibles') AND many_field = 'members_id';
--     -- → one_field = coach_of / team_responsible_of
--   SELECT field, special, interface, hidden FROM directus_fields
--    WHERE collection = 'members' AND field IN ('coach_of','team_responsible_of');
--     -- → 2 rows, o2m / list-o2m / hidden = t
-- After restart, as a coach/TR bearer token, PATCH /items/members/<staff-only id>
-- with { "position": [...] } → 200 (was 403).
