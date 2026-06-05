-- Migration 087: forms_teams M2M junction (forms ⇄ teams).
--
-- Scopes a form (audience='teams') to one or more teams, mirroring events_teams.
-- Per CLAUDE.md an M2M is normally created via the Directus admin UI (the
-- Directus *fields* API botches M2M setup). Here we instead replicate the EXACT
-- metadata of the known-good events_teams M2M directly in directus_* tables —
-- reproducible to prod (a hand-clicked field is not) and verified against
-- /relations after apply (with a Directus schema reload).
--
-- events_teams reference wiring (read from dev directus_relations, 2026-06-05):
--   rel 1: events_teams.events_id → events  one_field='teams'  junction_field='teams_id'  nullify
--   rel 2: events_teams.teams_id  → teams   one_field=NULL     junction_field='events_id' nullify
--   events.teams alias: special=['m2m'] interface='list-m2m'
--   events_teams collection: hidden=true icon='import_export'
--   junction fields id/events_id/teams_id: hidden=true
--
-- Idempotent.

BEGIN;

-- ── Junction table (mirrors events_teams: nullable FKs, ON DELETE CASCADE) ──
CREATE TABLE IF NOT EXISTS forms_teams (
  id        serial PRIMARY KEY,
  forms_id  integer REFERENCES forms(id) ON DELETE CASCADE,
  teams_id  integer REFERENCES teams(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS forms_teams_forms_id_idx ON forms_teams (forms_id);
CREATE INDEX IF NOT EXISTS forms_teams_teams_id_idx ON forms_teams (teams_id);

COMMENT ON TABLE forms_teams IS
  'M2M junction: forms ⇄ teams. Scopes a form (audience=teams) to specific teams. Mirrors events_teams.';

-- ── Directus collection metadata (hidden junction) ───────────────────
INSERT INTO directus_collections (collection, icon, hidden, "group", sort_field)
SELECT 'forms_teams', 'import_export', true, NULL, NULL
WHERE NOT EXISTS (SELECT 1 FROM directus_collections WHERE collection = 'forms_teams');

-- ── Directus field metadata: junction columns (hidden) ───────────────
INSERT INTO directus_fields (collection, field, hidden, sort)
SELECT 'forms_teams', 'id', true, 1
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'forms_teams' AND field = 'id');

INSERT INTO directus_fields (collection, field, hidden, sort)
SELECT 'forms_teams', 'forms_id', true, 2
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'forms_teams' AND field = 'forms_id');

INSERT INTO directus_fields (collection, field, hidden, sort)
SELECT 'forms_teams', 'teams_id', true, 3
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'forms_teams' AND field = 'teams_id');

-- ── Directus field metadata: the m2m alias on forms ──────────────────
INSERT INTO directus_fields (collection, field, special, interface, sort, width)
SELECT 'forms', 'teams', 'm2m', 'list-m2m', 11, 'full'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'forms' AND field = 'teams');

-- ── Directus relations metadata (two rows, mirror events_teams) ──────
INSERT INTO directus_relations (many_collection, many_field, one_collection, one_field, one_collection_field, one_allowed_collections, junction_field, sort_field, one_deselect_action)
SELECT 'forms_teams', 'forms_id', 'forms', 'teams', NULL, NULL, 'teams_id', NULL, 'nullify'
WHERE NOT EXISTS (SELECT 1 FROM directus_relations WHERE many_collection = 'forms_teams' AND many_field = 'forms_id');

INSERT INTO directus_relations (many_collection, many_field, one_collection, one_field, one_collection_field, one_allowed_collections, junction_field, sort_field, one_deselect_action)
SELECT 'forms_teams', 'teams_id', 'teams', NULL, NULL, NULL, 'forms_id', NULL, 'nullify'
WHERE NOT EXISTS (SELECT 1 FROM directus_relations WHERE many_collection = 'forms_teams' AND many_field = 'teams_id');

COMMIT;
