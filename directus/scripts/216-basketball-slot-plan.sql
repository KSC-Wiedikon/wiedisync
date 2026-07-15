-- Migration 216: basketball_slot_plan — games placed into fixed KWI hall slots.
--
-- v2 of the basketball prep view turns it into a slot-grid planner for the
-- Spielplansitzung: KSCW places games (KSCW team vs opponent) into fixed slots
-- (Fri 20:00; Sat 11/13:30/16/18:30; Sun 10/12:30/15) in KWI A/B/C (or the combined
-- A+B court). Free slots and blackout/closure defaults are COMPUTED at display time,
-- not stored — this table only holds the placed games.
--
-- The per-team, per-date `unavailable` overrides for the ProBasket availability
-- EXPORT stay on basketball_hall_availability (migration 214); its `windows` column
-- is now unused (the fixed slots supersede free time windows) — left in place.
--
-- Schema-only + idempotent per the CLAUDE.md migration policy. Item permissions live
-- in setup-permissions.mjs (SPORT_ADMIN_FULL_CRUD), NOT here.

BEGIN;

CREATE TABLE IF NOT EXISTS public.basketball_slot_plan (
  id                serial PRIMARY KEY,
  season            integer NOT NULL REFERENCES public.game_scheduling_seasons(id) ON DELETE CASCADE,
  date              date    NOT NULL,
  "time"            varchar(5)  NOT NULL,               -- 'HH:MM' tip-off
  hall              varchar(16) NOT NULL,               -- 'KWI A' | 'KWI B' | 'KWI C' | 'KWI A+B'
  kscw_team         integer REFERENCES public.teams(id) ON DELETE SET NULL,
  kscw_team_label   text,                               -- free-text KSCW team when kscw_team is null
  opponent          text,
  sex               varchar(8),                         -- 'm' | 'f' | 'mixed' (derived from the team's group)
  game_type         varchar(8) NOT NULL DEFAULT 'home', -- 'home' (KSCW hosts) | 'guest' (guest game using the hall)
  note              text,
  created_by        integer REFERENCES public.members(id) ON DELETE SET NULL,
  date_created      timestamptz NOT NULL DEFAULT now(),
  date_updated      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT basketball_slot_plan_season_date_time_hall_unique UNIQUE (season, date, "time", hall)
);

CREATE INDEX IF NOT EXISTS basketball_slot_plan_season_date_idx
  ON public.basketball_slot_plan (season, date);

COMMENT ON TABLE public.basketball_slot_plan IS
  'A basketball game placed into a fixed KWI hall slot for the ProBasket Spielplansitzung. One row per (season, date, time, hall). kscw_team (or kscw_team_label free-text) vs opponent (from the ProBasket Gruppeneinteilung, or free-text). Free slots + blackout/closure defaults are computed at display time, not stored. Edited via the Basketball prep view (Directus items API → auto actor log).';

-- ── Directus admin metadata (visibility/debugging; item perms in setup-permissions.mjs) ──
INSERT INTO directus_collections (collection, icon, color, "group", sort, archive_field, archive_value, unarchive_value, archive_app_filter)
SELECT 'basketball_slot_plan', 'sports_basketball', '#e8590c', NULL, NULL, NULL, NULL, NULL, true
WHERE NOT EXISTS (SELECT 1 FROM directus_collections WHERE collection = 'basketball_slot_plan');

INSERT INTO directus_fields (collection, field, special, interface, display, sort, width, note)
SELECT 'basketball_slot_plan', 'season', 'm2o', 'select-dropdown-m2o', 'related-values', 1, 'half', 'Game-scheduling season.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'basketball_slot_plan' AND field = 'season');

INSERT INTO directus_fields (collection, field, special, interface, sort, width, note)
SELECT 'basketball_slot_plan', v.field, NULL, 'input', v.sort, 'half', v.note
FROM (VALUES
  ('date',    2, 'Candidate home date (Fri/Sat/Sun).'),
  ('time',    3, 'Tip-off time HH:MM (Fri 20:00; Sat 11/13:30/16/18:30; Sun 10/12:30/15).'),
  ('hall',    4, 'KWI A | KWI B | KWI C | KWI A+B (combined court).'),
  ('opponent',6, 'Opponent team (ProBasket group, or free text).'),
  ('sex',     7, 'Derived sex of the KSCW team''s group (m/f/mixed).'),
  ('game_type', 8, 'home (KSCW hosts) | guest (a guest game occupying the hall).')
) AS v(field, sort, note)
WHERE NOT EXISTS (SELECT 1 FROM directus_fields f WHERE f.collection = 'basketball_slot_plan' AND f.field = v.field);

INSERT INTO directus_fields (collection, field, special, interface, display, sort, width, note)
SELECT 'basketball_slot_plan', 'kscw_team', 'm2o', 'select-dropdown-m2o', 'related-values', 5, 'half', 'KSCW basketball team (nullable — free text in kscw_team_label).'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'basketball_slot_plan' AND field = 'kscw_team');

INSERT INTO directus_fields (collection, field, special, interface, sort, width, note)
SELECT 'basketball_slot_plan', 'kscw_team_label', NULL, 'input', 8, 'half', 'Free-text KSCW team when kscw_team is not set.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'basketball_slot_plan' AND field = 'kscw_team_label');

INSERT INTO directus_fields (collection, field, special, interface, sort, width, note)
SELECT 'basketball_slot_plan', 'note', NULL, 'input-multiline', 9, 'full', 'Remark.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'basketball_slot_plan' AND field = 'note');

INSERT INTO directus_fields (collection, field, special, interface, display, sort, width, note)
SELECT 'basketball_slot_plan', 'created_by', 'm2o', 'select-dropdown-m2o', 'related-values', 10, 'half', 'Member who placed this game (actor).'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'basketball_slot_plan' AND field = 'created_by');

INSERT INTO directus_fields (collection, field, special, interface, readonly, hidden, sort)
SELECT 'basketball_slot_plan', 'date_created', 'date-created', 'datetime', true, true, 90
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'basketball_slot_plan' AND field = 'date_created');

INSERT INTO directus_fields (collection, field, special, interface, readonly, hidden, sort)
SELECT 'basketball_slot_plan', 'date_updated', 'date-updated', 'datetime', true, true, 91
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'basketball_slot_plan' AND field = 'date_updated');

INSERT INTO directus_relations (many_collection, many_field, one_collection, one_field, one_collection_field, one_allowed_collections, junction_field, sort_field, one_deselect_action)
SELECT 'basketball_slot_plan', 'season', 'game_scheduling_seasons', NULL, NULL, NULL, NULL, NULL, 'nullify'
WHERE NOT EXISTS (SELECT 1 FROM directus_relations WHERE many_collection = 'basketball_slot_plan' AND many_field = 'season');

INSERT INTO directus_relations (many_collection, many_field, one_collection, one_field, one_collection_field, one_allowed_collections, junction_field, sort_field, one_deselect_action)
SELECT 'basketball_slot_plan', 'kscw_team', 'teams', NULL, NULL, NULL, NULL, NULL, 'nullify'
WHERE NOT EXISTS (SELECT 1 FROM directus_relations WHERE many_collection = 'basketball_slot_plan' AND many_field = 'kscw_team');

INSERT INTO directus_relations (many_collection, many_field, one_collection, one_field, one_collection_field, one_allowed_collections, junction_field, sort_field, one_deselect_action)
SELECT 'basketball_slot_plan', 'created_by', 'members', NULL, NULL, NULL, NULL, NULL, 'nullify'
WHERE NOT EXISTS (SELECT 1 FROM directus_relations WHERE many_collection = 'basketball_slot_plan' AND many_field = 'created_by');

COMMIT;
