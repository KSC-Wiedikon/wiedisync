-- Migration 214: Basketball hall availability — per-team, per-date home-hall
-- availability for the ProBasket "prep view".
--
-- Basketball scheduling is NOT the volleyball bilateral engine. ProBasket (Nord-
-- Ostschweizer BV) owns the schedule: regional teams are scheduled in person at the
-- Spielplansitzung (5 Sep), ~5 teams submit hall availability by 17 Aug, and finalized
-- games flow back through Basketplan (bp-sync.js → games). There are NO opponents,
-- tokens, or bookings on the basketball side.
--
-- This table records, per basketball team, which candidate home dates (Fri/Sat/Sun)
-- the KWI halls are available — editable in the app's Basketball prep view. It prepares
-- the rep for the Spielplansitzung and is the foundation for the future 17-Aug ProBasket
-- Excel export. `unavailable` = the template's "Nicht verfügbar" x; `windows` = the
-- up-to-3 {hall,from,to} time blocks the template asks for.
--
-- Schema-only + idempotent per the CLAUDE.md migration policy. Item permissions for the
-- readers/writers live in setup-permissions.mjs (SPORT_ADMIN_FULL_CRUD), NOT here.

BEGIN;

CREATE TABLE IF NOT EXISTS public.basketball_hall_availability (
  id            serial PRIMARY KEY,
  season        integer NOT NULL REFERENCES public.game_scheduling_seasons(id) ON DELETE CASCADE,
  team          integer NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  date          date    NOT NULL,
  unavailable   boolean NOT NULL DEFAULT false,
  windows       jsonb   NOT NULL DEFAULT '[]'::jsonb,
  note          text,
  created_by    integer REFERENCES public.members(id) ON DELETE SET NULL,
  date_created  timestamptz NOT NULL DEFAULT now(),
  date_updated  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT basketball_hall_availability_season_team_date_unique UNIQUE (season, team, date)
);

CREATE INDEX IF NOT EXISTS basketball_hall_availability_season_team_idx
  ON public.basketball_hall_availability (season, team);

COMMENT ON TABLE public.basketball_hall_availability IS
  'Per basketball team, per candidate home date (Fri/Sat/Sun) KWI hall availability for ProBasket scheduling. unavailable = the ProBasket template "Nicht verfügbar" x; windows = jsonb array of {hall,from,to} (up to 3). One row per (season, team, date). Edited via the Basketball prep view (Directus items API → auto actor log); feeds the future 17-Aug ProBasket Excel export. Basketball has no opponent/token/booking flow — the association owns the schedule.';

-- ── Directus admin metadata (visibility/debugging; item perms in setup-permissions.mjs) ──
INSERT INTO directus_collections (collection, icon, color, "group", sort, archive_field, archive_value, unarchive_value, archive_app_filter)
SELECT 'basketball_hall_availability', 'sports_basketball', '#e8590c', NULL, NULL, NULL, NULL, NULL, true
WHERE NOT EXISTS (SELECT 1 FROM directus_collections WHERE collection = 'basketball_hall_availability');

INSERT INTO directus_fields (collection, field, special, interface, display, sort, width, note)
SELECT 'basketball_hall_availability', 'season', 'm2o', 'select-dropdown-m2o', 'related-values', 1, 'half', 'Game-scheduling season (shared sport-neutral identity).'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'basketball_hall_availability' AND field = 'season');

INSERT INTO directus_fields (collection, field, special, interface, display, sort, width, note)
SELECT 'basketball_hall_availability', 'team', 'm2o', 'select-dropdown-m2o', 'related-values', 2, 'half', 'Basketball team (teams.sport = basketball).'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'basketball_hall_availability' AND field = 'team');

INSERT INTO directus_fields (collection, field, special, interface, sort, width, note)
SELECT 'basketball_hall_availability', 'date', NULL, 'datetime', 3, 'half', 'Candidate home date (Fri/Sat/Sun).'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'basketball_hall_availability' AND field = 'date');

INSERT INTO directus_fields (collection, field, special, interface, sort, width, note)
SELECT 'basketball_hall_availability', 'unavailable', 'cast-boolean', 'boolean', 4, 'half', 'Hall not available this day (ProBasket "Nicht verfügbar" x).'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'basketball_hall_availability' AND field = 'unavailable');

INSERT INTO directus_fields (collection, field, special, interface, sort, width, note)
SELECT 'basketball_hall_availability', 'windows', 'cast-json', 'input-code', 5, 'full', 'Array of {hall,from,to} time windows (up to 3), matching the ProBasket template.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'basketball_hall_availability' AND field = 'windows');

INSERT INTO directus_fields (collection, field, special, interface, sort, width, note)
SELECT 'basketball_hall_availability', 'note', NULL, 'input-multiline', 6, 'full', 'Per-date remark.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'basketball_hall_availability' AND field = 'note');

INSERT INTO directus_fields (collection, field, special, interface, sort, width, note)
SELECT 'basketball_hall_availability', 'created_by', 'm2o', 'select-dropdown-m2o', 7, 'half', 'Member who last set this row (actor).'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'basketball_hall_availability' AND field = 'created_by');

INSERT INTO directus_fields (collection, field, special, interface, readonly, hidden, sort)
SELECT 'basketball_hall_availability', 'date_created', 'date-created', 'datetime', true, true, 90
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'basketball_hall_availability' AND field = 'date_created');

INSERT INTO directus_fields (collection, field, special, interface, readonly, hidden, sort)
SELECT 'basketball_hall_availability', 'date_updated', 'date-updated', 'datetime', true, true, 91
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'basketball_hall_availability' AND field = 'date_updated');

INSERT INTO directus_relations (many_collection, many_field, one_collection, one_field, one_collection_field, one_allowed_collections, junction_field, sort_field, one_deselect_action)
SELECT 'basketball_hall_availability', 'season', 'game_scheduling_seasons', NULL, NULL, NULL, NULL, NULL, 'nullify'
WHERE NOT EXISTS (SELECT 1 FROM directus_relations WHERE many_collection = 'basketball_hall_availability' AND many_field = 'season');

INSERT INTO directus_relations (many_collection, many_field, one_collection, one_field, one_collection_field, one_allowed_collections, junction_field, sort_field, one_deselect_action)
SELECT 'basketball_hall_availability', 'team', 'teams', NULL, NULL, NULL, NULL, NULL, 'nullify'
WHERE NOT EXISTS (SELECT 1 FROM directus_relations WHERE many_collection = 'basketball_hall_availability' AND many_field = 'team');

INSERT INTO directus_relations (many_collection, many_field, one_collection, one_field, one_collection_field, one_allowed_collections, junction_field, sort_field, one_deselect_action)
SELECT 'basketball_hall_availability', 'created_by', 'members', NULL, NULL, NULL, NULL, NULL, 'nullify'
WHERE NOT EXISTS (SELECT 1 FROM directus_relations WHERE many_collection = 'basketball_hall_availability' AND many_field = 'created_by');

COMMIT;
