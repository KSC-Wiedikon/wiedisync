-- Migration 298: split "open for new players" by gender on mixed teams.
--
-- Adds `teams.open_for_girls` / `teams.open_for_boys` (boolean, default false).
-- Both are sub-toggles of the existing `open_for_players`: they are only read
-- while it is on, and only for mixed (MU) youth teams, where the club recruits
-- girls and boys separately because the squad is capped per gender.
--
-- Edited in wiedisync's team settings (src/modules/teams/RosterEditor.tsx),
-- under the "Open for new players" switch next to `recruiting_positions`.
--
-- The kscw-website Nachwuchs page reads them to split the MU cards in half:
-- the gender being taken keeps the green badge + contact form, the other gets
-- the gold "Team voll" badge + the club-wide waiting list. Exactly one flag on
-- splits the card; both on — and both off, the state every team starts in —
-- render the single generic "open" row the card has always shown, so nothing
-- changes until a coach opts in.
--
-- Idempotent (ADD COLUMN IF NOT EXISTS + NOT EXISTS/NOT LIKE guards).
-- Apply to dev first, restart that Directus container so the permission cache
-- picks the new fields up, smoke-test, then prod.

BEGIN;

-- ── Columns ──────────────────────────────────────────────────────
ALTER TABLE teams ADD COLUMN IF NOT EXISTS open_for_girls boolean DEFAULT false;
ALTER TABLE teams ADD COLUMN IF NOT EXISTS open_for_boys  boolean DEFAULT false;

COMMENT ON COLUMN teams.open_for_girls IS
  'Mixed (MU) teams only: recruiting girls. Sub-toggle of open_for_players — ignored while that is false. Both this and open_for_boys false/true = the team recruits without a gender split.';
COMMENT ON COLUMN teams.open_for_boys IS
  'Mixed (MU) teams only: recruiting boys. Sub-toggle of open_for_players — see open_for_girls.';

-- ── Directus field metadata ──────────────────────────────────────
-- So the columns are editable from the admin UI too, not just from wiedisync
-- (same pattern as migration 082's teams.recruiting_positions).
INSERT INTO directus_fields (collection, field, interface, sort, hidden, note)
SELECT 'teams', v.field, 'boolean', v.sort, false, v.note
FROM (VALUES
  ('open_for_girls', 61, 'Mixed teams: open for new girls. Only used when "Open for players" is on.'),
  ('open_for_boys',  62, 'Mixed teams: open for new boys. Only used when "Open for players" is on.')
) AS v(field, sort, note)
WHERE NOT EXISTS (
  SELECT 1 FROM directus_fields WHERE collection = 'teams' AND field = v.field
);

-- ── Public read permission ───────────────────────────────────────
-- The website builds and refreshes anonymously, so the two flags have to be
-- publicly readable or the card can't show the split. Directus 403s the WHOLE
-- request when one requested field is not permitted, which is why this is not
-- optional: without it the site's team query fails outright rather than
-- degrading. (kscw-website retries without the two fields precisely so a
-- half-applied rollout doesn't take every badge down — but that fallback is a
-- safety net, not the intended end state.)
--
-- `setup-permissions.mjs`'s PUBLIC_TEAM_FIELDS is the AUTHORITATIVE list and
-- has both fields added alongside this migration — `npm run db:deploy:*` runs
-- setup-perms right after the migration and rewrites this row from it. The
-- UPDATE below only covers the `npm run db:migrate:*`-alone case, so the flags
-- are readable even if setup-perms is not run. Keep the two in step.
--
-- Targeted by capability rather than by policy name/id: any read row that can
-- already see open_for_players is the row that needs these too. Rows with
-- fields = '*' already include them.
UPDATE directus_permissions
SET fields = fields
  || ',open_for_girls'
  || ',open_for_boys'
WHERE collection = 'teams'
  AND action = 'read'
  AND fields IS NOT NULL
  AND fields <> '*'
  AND (',' || fields || ',') LIKE '%,open_for_players,%'
  AND (',' || fields || ',') NOT LIKE '%,open_for_girls,%';

COMMIT;

-- ── Verification ─────────────────────────────────────────────────
-- Expect both columns, both field rows, and every teams/read policy that could
-- see open_for_players now also listing the two new flags.
--
--   SELECT column_name, column_default
--     FROM information_schema.columns
--    WHERE table_name = 'teams' AND column_name LIKE 'open_for_%';
--
--   SELECT p.id, pol.name, p.fields
--     FROM directus_permissions p
--     JOIN directus_policies pol ON pol.id = p.policy
--    WHERE p.collection = 'teams' AND p.action = 'read';
--
-- Then, after restarting the container, anonymously:
--   curl -gs 'https://directus.kscw.ch/items/teams?limit=1&fields=name,open_for_girls,open_for_boys'
-- A 403 here means the permission row was not matched — check the SELECT above.
