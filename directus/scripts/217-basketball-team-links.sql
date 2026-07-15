-- Migration 217: basketball_team_links — coach/player-sharing links between teams.
--
-- Some basketball teams share coaches/players, which constrains when their games can
-- be scheduled. Two link types:
--   'diff' — the teams share a person who plays/coaches both, so their games must NOT
--            be at the same time (e.g. DU14 ↔ Rhinos: the DU14 coaches play in Rhinos).
--   'same' — the teams should be kept at the SAME time (e.g. DU14 + DU18-2).
-- The Basketball prep planner uses these to highlight suggested slots and warn on
-- conflicts when a team is selected. Edited in the Basketball → Settings page.
--
-- Schema-only + idempotent per the CLAUDE.md migration policy. Item permissions live
-- in setup-permissions.mjs (SPORT_ADMIN_FULL_CRUD), NOT here.

BEGIN;

CREATE TABLE IF NOT EXISTS public.basketball_team_links (
  id            serial PRIMARY KEY,
  season        integer NOT NULL REFERENCES public.game_scheduling_seasons(id) ON DELETE CASCADE,
  team_a        integer NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  team_b        integer NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  link_type     varchar(8) NOT NULL,   -- 'same' | 'diff'
  created_by    integer REFERENCES public.members(id) ON DELETE SET NULL,
  date_created  timestamptz NOT NULL DEFAULT now(),
  date_updated  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT basketball_team_links_unique UNIQUE (season, team_a, team_b)
);

CREATE INDEX IF NOT EXISTS basketball_team_links_season_idx
  ON public.basketball_team_links (season);

COMMENT ON TABLE public.basketball_team_links IS
  'Coach/player-sharing links between basketball teams, per season. link_type diff = must not play the same time (shared person); same = keep at the same time. Drives the Basketball prep planner slot highlights. Edited via Basketball → Settings.';

INSERT INTO directus_collections (collection, icon, color, "group", sort, archive_field, archive_value, unarchive_value, archive_app_filter)
SELECT 'basketball_team_links', 'link', '#e8590c', NULL, NULL, NULL, NULL, NULL, true
WHERE NOT EXISTS (SELECT 1 FROM directus_collections WHERE collection = 'basketball_team_links');

INSERT INTO directus_fields (collection, field, special, interface, display, sort, width, note)
SELECT 'basketball_team_links', 'season', 'm2o', 'select-dropdown-m2o', 'related-values', 1, 'half', 'Game-scheduling season.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'basketball_team_links' AND field = 'season');

INSERT INTO directus_fields (collection, field, special, interface, display, sort, width, note)
SELECT 'basketball_team_links', 'team_a', 'm2o', 'select-dropdown-m2o', 'related-values', 2, 'half', 'First team.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'basketball_team_links' AND field = 'team_a');

INSERT INTO directus_fields (collection, field, special, interface, display, sort, width, note)
SELECT 'basketball_team_links', 'team_b', 'm2o', 'select-dropdown-m2o', 'related-values', 3, 'half', 'Second team.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'basketball_team_links' AND field = 'team_b');

INSERT INTO directus_fields (collection, field, special, interface, sort, width, note)
SELECT 'basketball_team_links', 'link_type', NULL, 'input', 4, 'half', 'same = keep same time | diff = must differ (shared person).'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'basketball_team_links' AND field = 'link_type');

INSERT INTO directus_fields (collection, field, special, interface, display, sort, width, note)
SELECT 'basketball_team_links', 'created_by', 'm2o', 'select-dropdown-m2o', 'related-values', 5, 'half', 'Member who added the link.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'basketball_team_links' AND field = 'created_by');

INSERT INTO directus_fields (collection, field, special, interface, readonly, hidden, sort)
SELECT 'basketball_team_links', 'date_created', 'date-created', 'datetime', true, true, 90
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'basketball_team_links' AND field = 'date_created');

INSERT INTO directus_fields (collection, field, special, interface, readonly, hidden, sort)
SELECT 'basketball_team_links', 'date_updated', 'date-updated', 'datetime', true, true, 91
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'basketball_team_links' AND field = 'date_updated');

INSERT INTO directus_relations (many_collection, many_field, one_collection, one_field, one_collection_field, one_allowed_collections, junction_field, sort_field, one_deselect_action)
SELECT 'basketball_team_links', 'season', 'game_scheduling_seasons', NULL, NULL, NULL, NULL, NULL, 'nullify'
WHERE NOT EXISTS (SELECT 1 FROM directus_relations WHERE many_collection = 'basketball_team_links' AND many_field = 'season');

INSERT INTO directus_relations (many_collection, many_field, one_collection, one_field, one_collection_field, one_allowed_collections, junction_field, sort_field, one_deselect_action)
SELECT 'basketball_team_links', 'team_a', 'teams', NULL, NULL, NULL, NULL, NULL, 'nullify'
WHERE NOT EXISTS (SELECT 1 FROM directus_relations WHERE many_collection = 'basketball_team_links' AND many_field = 'team_a');

INSERT INTO directus_relations (many_collection, many_field, one_collection, one_field, one_collection_field, one_allowed_collections, junction_field, sort_field, one_deselect_action)
SELECT 'basketball_team_links', 'team_b', 'teams', NULL, NULL, NULL, NULL, NULL, 'nullify'
WHERE NOT EXISTS (SELECT 1 FROM directus_relations WHERE many_collection = 'basketball_team_links' AND many_field = 'team_b');

INSERT INTO directus_relations (many_collection, many_field, one_collection, one_field, one_collection_field, one_allowed_collections, junction_field, sort_field, one_deselect_action)
SELECT 'basketball_team_links', 'created_by', 'members', NULL, NULL, NULL, NULL, NULL, 'nullify'
WHERE NOT EXISTS (SELECT 1 FROM directus_relations WHERE many_collection = 'basketball_team_links' AND many_field = 'created_by');

COMMIT;
