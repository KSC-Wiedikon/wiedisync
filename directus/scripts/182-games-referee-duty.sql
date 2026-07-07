-- Migration 182: referee duty on games (HU20 home games use scorer + referee
-- instead of scorer + Täfeler).
--
-- Model mirrors the scorer duty exactly: a duty team (referee_duty_team) is
-- assigned, a member of that team is named/claims it (referee_member), and the
-- games.items.update hook stamps referee_confirmed_by_name/at when a person is
-- set (see kscw-hooks). NO licence is required to referee (unlike the historical
-- scorer-licence gate, which is being dropped) — any member of the duty team can
-- take it. Only HU20 home games use this role; the algorithm & UI gate on the
-- HU20 team name.
--
-- Columns are plain integer FKs like the other *_duty_team / *_member columns
-- (no PG foreign-key constraint — the relation is Directus-only, matching
-- scorer_duty_team/scorer_member). Registered in directus_fields (so the items
-- API returns them under `*` and the admin Data Model shows M2O dropdowns) and
-- directus_relations (so the M2O resolves). Requires a Directus restart to pick
-- up the new fields — the ext:deploy step that ships the confirm-hook change
-- restarts the container.
--
-- Schema-only + idempotent. games.read is already ['*'] and LEADER_POLICY
-- games.update grants ['*'], so no permission change is needed (setup-permissions
-- untouched). After applying, regenerate SCHEMA.sql (npm run db:baseline:prod).

BEGIN;

-- 1) Columns
ALTER TABLE games ADD COLUMN IF NOT EXISTS referee_duty_team integer;
ALTER TABLE games ADD COLUMN IF NOT EXISTS referee_member integer;
ALTER TABLE games ADD COLUMN IF NOT EXISTS referee_confirmed_by_name varchar(255);
ALTER TABLE games ADD COLUMN IF NOT EXISTS referee_confirmed_at timestamptz;

-- 2) Register in directus_fields (M2O for the FK cols; input/datetime for the
--    system-set confirm cols, matching migration 123).
INSERT INTO directus_fields (collection, field, special, interface, display, sort, hidden, note)
SELECT 'games', v.field, v.special, v.interface, v.display, v.sort, false, v.note
FROM (VALUES
  ('referee_duty_team',          'm2o',  'select-dropdown-m2o', 'related-values', 34,  'HU20 referee duty team (migration 182).'),
  ('referee_member',             'm2o',  'select-dropdown-m2o', 'related-values', 35,  'HU20 referee, the person (migration 182).'),
  ('referee_confirmed_by_name',  NULL,   'input',               NULL,             142, 'Per-duty confirmation actor (system-set by hook; shown to admins).'),
  ('referee_confirmed_at',       NULL,   'datetime',            NULL,             143, 'Per-duty confirmation time (system-set by hook; shown to admins).')
) AS v(field, special, interface, display, sort, note)
WHERE NOT EXISTS (
  SELECT 1 FROM directus_fields df WHERE df.collection = 'games' AND df.field = v.field
);

-- 3) Register the M2O relations (mirror scorer_duty_team / scorer_member).
INSERT INTO directus_relations (many_collection, many_field, one_collection, one_deselect_action)
SELECT 'games', v.many_field, v.one_collection, 'nullify'
FROM (VALUES
  ('referee_duty_team', 'teams'),
  ('referee_member',    'members')
) AS v(many_field, one_collection)
WHERE NOT EXISTS (
  SELECT 1 FROM directus_relations dr WHERE dr.many_collection = 'games' AND dr.many_field = v.many_field
);

COMMIT;
