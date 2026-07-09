-- Migration 200: standing VB referee → team duty map.
--
-- Until now a VB referee was just a member with `referee_vb = true`, and referee
-- "duty" only existed per-game (`games.referee_duty_team` / `referee_member`),
-- filled ad-hoc by the scorer-assign engine. This table is the standing record
-- of which team(s) each referee covers — set by admin / VB admin on the new
-- "Volley Referees" page (`/admin/vb-referees`), used as a coverage check and
-- (phase 2) as input to the scorer-assignment engine.
--
--   * Many-to-many: a referee covers 1+ teams; a team can have several referees.
--     One row per (referee, team) duty.
--   * "External" duty (referee does duty outside Wiedikon) → external = true,
--     team NULL, optional external_label (which club/pool).
--   * A duty must name a team OR be external (CHECK).
--
-- Schema-only + idempotent. Permissions in setup-permissions.mjs (Sport Admin
-- CRUD; full admins bypass via admin_access).

BEGIN;

CREATE TABLE IF NOT EXISTS vb_referee_duty (
  id              serial PRIMARY KEY,
  -- The referee (a referee_vb member). CASCADE: a duty is meaningless without
  -- the person; members are effectively never hard-deleted anyway.
  referee         integer NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  -- The team whose referee obligation they cover. NULL only for external duty.
  team            integer REFERENCES teams(id) ON DELETE CASCADE,
  external        boolean NOT NULL DEFAULT false,
  external_label  varchar(200),
  note            varchar(500),
  date_created    timestamptz NOT NULL DEFAULT now(),
  user_created    uuid,
  -- A duty must reference a team OR be flagged external.
  CONSTRAINT vb_referee_duty_team_or_external CHECK (team IS NOT NULL OR external = true),
  -- No duplicate (referee, team) rows. External rows have NULL team, which
  -- Postgres treats as distinct — a referee may hold >1 external row, harmless.
  CONSTRAINT vb_referee_duty_unique UNIQUE (referee, team)
);
CREATE INDEX IF NOT EXISTS vb_referee_duty_referee_idx ON vb_referee_duty (referee);
CREATE INDEX IF NOT EXISTS vb_referee_duty_team_idx ON vb_referee_duty (team);

COMMENT ON TABLE vb_referee_duty IS
  'Standing VB referee → team duty map. Set on /admin/vb-referees; many-to-many; external=true (team NULL) for duty outside Wiedikon. Coverage check now, scorer-assign input later.';

-- ── Directus admin metadata ────────────────────────────────────────────
INSERT INTO directus_collections (collection, icon, color, "group", sort, archive_app_filter)
SELECT 'vb_referee_duty', 'sports_volleyball', '#2563eb', NULL, NULL, true
WHERE NOT EXISTS (SELECT 1 FROM directus_collections WHERE collection = 'vb_referee_duty');

INSERT INTO directus_fields (collection, field, special, interface, display, sort, width, note)
SELECT 'vb_referee_duty', 'referee', 'm2o', 'select-dropdown-m2o', 'related-values', 1, 'half', 'The referee (a referee_vb member).'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'vb_referee_duty' AND field = 'referee');
INSERT INTO directus_fields (collection, field, special, interface, display, sort, width, note)
SELECT 'vb_referee_duty', 'team', 'm2o', 'select-dropdown-m2o', 'related-values', 2, 'half', 'Team whose referee obligation they cover (NULL for external).'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'vb_referee_duty' AND field = 'team');
INSERT INTO directus_fields (collection, field, interface, sort, width, note)
SELECT 'vb_referee_duty', 'external', 'boolean', 3, 'half', 'Duty stays outside Wiedikon.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'vb_referee_duty' AND field = 'external');
INSERT INTO directus_fields (collection, field, interface, sort, width, note)
SELECT 'vb_referee_duty', 'external_label', 'input', 4, 'half', 'Which external club / pool (optional).'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'vb_referee_duty' AND field = 'external_label');
INSERT INTO directus_fields (collection, field, interface, sort, width)
SELECT 'vb_referee_duty', 'note', 'input-multiline', 5, 'full'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'vb_referee_duty' AND field = 'note');
INSERT INTO directus_fields (collection, field, special, interface, readonly, hidden, sort)
SELECT 'vb_referee_duty', 'date_created', 'date-created', 'datetime', true, true, 90
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'vb_referee_duty' AND field = 'date_created');
INSERT INTO directus_fields (collection, field, special, interface, readonly, hidden, sort)
SELECT 'vb_referee_duty', 'user_created', 'user-created', 'select-dropdown-m2o', true, true, 91
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'vb_referee_duty' AND field = 'user_created');

INSERT INTO directus_relations (many_collection, many_field, one_collection, one_deselect_action)
SELECT 'vb_referee_duty', 'referee', 'members', 'nullify'
WHERE NOT EXISTS (SELECT 1 FROM directus_relations WHERE many_collection = 'vb_referee_duty' AND many_field = 'referee');
INSERT INTO directus_relations (many_collection, many_field, one_collection, one_deselect_action)
SELECT 'vb_referee_duty', 'team', 'teams', 'nullify'
WHERE NOT EXISTS (SELECT 1 FROM directus_relations WHERE many_collection = 'vb_referee_duty' AND many_field = 'team');

COMMIT;
