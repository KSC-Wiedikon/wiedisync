-- 311-games-referees-public.sql
-- Grant anonymous read on `games.referees_json` — the field the kscw-website
-- calendar has been asking for, and 403ing on, since it shipped.
--
-- WHAT BROKE. kscw-website's /weiteres/kalender game-detail popup lists the
-- match officials ("1. Schiedsrichter: …"), added in website commits 3f1bff7 /
-- 4ef1898. That feature put `referees_json` into the calendar's games query:
--
--   GET /items/games?fields=…,league,referees_json,kscw_team.id,…
--
-- but `referees_json` was never added to the public policy's games/read grant
-- (setup-permissions.mjs → PUBLIC_GAME_FIELDS). Directus field permissions are
-- an allow-list and it rejects the WHOLE request when ONE requested field is
-- not permitted — so this did not merely hide the referee rows, it 403'd the
-- entire games fetch. Result: an empty games array for EVERY month on the live
-- calendar (21 games in Sept 2026, 16 in Oct, 288 in the fetch window — all
-- invisible) while events, closures and the toolbar kept rendering, so the page
-- looked "just quiet" rather than broken. Same failure mode migration 298
-- documents for teams.open_for_* — see its Public-read note.
--
-- WHY THIS IS SAFE TO EXPOSE. `referees_json` is the referee assignment as
-- published by Swiss Volley (filled by the SV sync; basketball and unassigned
-- new-season fixtures are empty). It is the officials' names on a public
-- fixture list — already public on the SVRZ portal — and carries no contact
-- details, member ids or internal ops data. It is NOT one of the internal
-- columns PUBLIC_GAME_FIELDS deliberately withholds (duty assignments,
-- auto_confirm_rsvp, auto_nomination_list, vm_nomination_*): those stay out.
--
-- `setup-permissions.mjs`'s PUBLIC_GAME_FIELDS is the AUTHORITATIVE list and has
-- 'referees_json' added alongside this migration — `npm run db:deploy:*` runs
-- setup-perms right after the migration and rewrites this row from it. The
-- UPDATE below covers the `npm run db:migrate:*`-alone case (the path used here,
-- since setup-perms is destructive on the keyless dev instance). Keep the two in
-- step.
--
-- Targeted at the built-in public policy only, matched by the same name
-- setup-permissions.mjs looks it up by ('$t:public_label'). The Member and Sport
-- Admin games/read rows are already `fields = '*'` and need nothing.
--
-- Idempotent (NOT LIKE guard). Apply to dev first, restart that Directus
-- container so the permission cache picks the change up, smoke-test anonymously,
-- then prod.

BEGIN;

UPDATE directus_permissions p
SET fields = p.fields || ',referees_json'
FROM directus_policies pol
WHERE pol.id = p.policy
  AND pol.name = '$t:public_label'
  AND p.collection = 'games'
  AND p.action = 'read'
  AND p.fields IS NOT NULL
  AND p.fields <> '*'
  AND (',' || p.fields || ',') NOT LIKE '%,referees_json,%';

COMMIT;

-- ── Verification ─────────────────────────────────────────────────
-- Expect the public row to end with ",referees_json"; Member/Sport Admin stay '*'.
--
--   SELECT p.id, pol.name, p.fields
--     FROM directus_permissions p
--     JOIN directus_policies pol ON pol.id = p.policy
--    WHERE p.collection = 'games' AND p.action = 'read'
--    ORDER BY p.id;
--
-- Then, after restarting the container, anonymously — this is the calendar's
-- exact field list, so a 200 here is the bug fixed:
--
--   curl -gs -o /dev/null -w '%{http_code}\n' \
--     'https://directus.kscw.ch/items/games?limit=1&fields=id,game_id,date,time,home_team,away_team,home_score,away_score,status,type,league,referees_json,kscw_team.id,kscw_team.name,kscw_team.sport,kscw_team.color,hall.id,hall.name,hall.address'
--
-- A 403 means the permission row was not matched (check the SELECT above) or the
-- container was not restarted — the permission cache does not expire on its own.
