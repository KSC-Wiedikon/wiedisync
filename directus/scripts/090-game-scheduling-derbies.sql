-- Migration 090: Intra-club derby anchoring for game scheduling (Art. 27 SVRZ).
--
-- `game_scheduling_derbies` — when two KSC Wiedikon teams share the same group
-- of a league (e.g. H1 & H3 both in 2L), SVRZ Volleyballreglement Art. 27 Abs. 6
-- lit. a requires their two head-to-head games to be played as the FIRST game of
-- the Vorrunde and the FIRST game of the Rückrunde respectively — even if the
-- Spielplanraster would order them otherwise. Violation = forfait for the home
-- team (lit. c + ER Strafbestimmungen).
--
-- The spielplaner fixes the two derby dates MANUALLY (one Vorrunde leg, one
-- Rückrunde leg). Once confirmed, the "external" opponent flow (home-slot offers
-- + away-date proposals) for BOTH teams is clamped to dates AFTER the relevant
-- derby date, per half — so nothing can accidentally land before the derby and
-- trigger a forfait. The app never auto-schedules the derby; it only makes the
-- rest line up behind the two dates the spielplaner sets.
--
-- One row per (season, team pair). team_a/team_b are stored sorted (team_a <
-- team_b by id) so the (season, team_a, team_b) unique key dedupes regardless of
-- which side the detector saw first. Each leg records the SVRZ game it maps to
-- (svrz_persistence_id), which KSCW team hosts it, and the date the spielplaner
-- set. The Vorrunde/Rückrunde half of each leg is derived from its date vs the
-- 01.01 boundary at read time — not stored — so re-dating just works.
--
-- Accessed ONLY via the kscw-endpoints game-scheduling routes (knex, gated by
-- isAdminOrSpielplaner) — never the Directus items API — so NO permission rows
-- are needed (admins bypass; the endpoint is the gate). This migration is
-- schema-only + idempotent per the CLAUDE.md migration policy.

BEGIN;

-- ── game_scheduling_derbies ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS game_scheduling_derbies (
  id              serial PRIMARY KEY,
  season          integer NOT NULL REFERENCES game_scheduling_seasons(id) ON DELETE CASCADE,
  team_a          integer NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  team_b          integer NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  -- Leg 1 / leg 2 = the two head-to-head fixtures (home-and-away). Which half a
  -- leg belongs to is derived from its date, not from the leg number.
  leg1_svrz_id    character varying(255),
  leg1_home_team  integer REFERENCES teams(id) ON DELETE SET NULL,
  leg1_date       date,
  leg2_svrz_id    character varying(255),
  leg2_home_team  integer REFERENCES teams(id) ON DELETE SET NULL,
  leg2_date       date,
  confirmed       boolean NOT NULL DEFAULT false,
  date_created    timestamptz NOT NULL DEFAULT now(),
  date_updated    timestamptz NOT NULL DEFAULT now(),
  user_created    uuid,
  user_updated    uuid,
  CONSTRAINT game_scheduling_derbies_team_order_check CHECK (team_a < team_b),
  CONSTRAINT game_scheduling_derbies_unique UNIQUE (season, team_a, team_b)
);

CREATE INDEX IF NOT EXISTS game_scheduling_derbies_season_idx
  ON game_scheduling_derbies (season);
-- Hot path: "confirmed derbies involving team T" (slot clamp + gap feed).
CREATE INDEX IF NOT EXISTS game_scheduling_derbies_team_a_idx
  ON game_scheduling_derbies (team_a) WHERE confirmed;
CREATE INDEX IF NOT EXISTS game_scheduling_derbies_team_b_idx
  ON game_scheduling_derbies (team_b) WHERE confirmed;

COMMENT ON TABLE game_scheduling_derbies IS
  'Intra-club derby anchors (Art. 27 SVRZ). One row per season + KSCW team pair sharing a league group. The spielplaner sets the two head-to-head game dates (one Vorrunde leg, one Rückrunde leg); once confirmed, the opponent home-slot + away-date flow for both teams is clamped to after the relevant derby date per half. Managed only via the kscw game-scheduling endpoints (knex, admin/spielplaner-gated).';
COMMENT ON COLUMN game_scheduling_derbies.leg1_svrz_id IS
  'svrz_games.svrz_persistence_id of the first head-to-head fixture this anchor maps to.';
COMMENT ON COLUMN game_scheduling_derbies.leg1_date IS
  'Date the spielplaner fixed for leg 1. Its Vor-/Rückrunde half is derived from this date vs the 01.01 boundary at read time.';
COMMENT ON COLUMN game_scheduling_derbies.confirmed IS
  'true once both leg dates are set + the spielplaner confirms. Only confirmed rows clamp the external slot flow.';

-- ── Directus admin metadata (visibility/debugging only; no item perms) ──
INSERT INTO directus_collections (collection, icon, color, "group", sort, archive_field, archive_value, unarchive_value, archive_app_filter)
SELECT 'game_scheduling_derbies', 'swap_horiz', '#7C3AED', NULL, NULL, NULL, NULL, NULL, true
WHERE NOT EXISTS (SELECT 1 FROM directus_collections WHERE collection = 'game_scheduling_derbies');

INSERT INTO directus_fields (collection, field, special, interface, display, sort, width, note)
SELECT 'game_scheduling_derbies', 'season', 'm2o', 'select-dropdown-m2o', 'related-values', 1, 'half', 'Game-scheduling season.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'game_scheduling_derbies' AND field = 'season');

INSERT INTO directus_fields (collection, field, special, interface, display, sort, width, note)
SELECT 'game_scheduling_derbies', 'team_a', 'm2o', 'select-dropdown-m2o', 'related-values', 2, 'half', 'First KSCW team (lower id).'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'game_scheduling_derbies' AND field = 'team_a');

INSERT INTO directus_fields (collection, field, special, interface, display, sort, width, note)
SELECT 'game_scheduling_derbies', 'team_b', 'm2o', 'select-dropdown-m2o', 'related-values', 3, 'half', 'Second KSCW team (higher id).'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'game_scheduling_derbies' AND field = 'team_b');

INSERT INTO directus_fields (collection, field, special, interface, sort, width, note)
SELECT 'game_scheduling_derbies', 'leg1_date', NULL, 'datetime', 4, 'half', 'Date fixed for leg 1.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'game_scheduling_derbies' AND field = 'leg1_date');

INSERT INTO directus_fields (collection, field, special, interface, sort, width, note)
SELECT 'game_scheduling_derbies', 'leg2_date', NULL, 'datetime', 5, 'half', 'Date fixed for leg 2.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'game_scheduling_derbies' AND field = 'leg2_date');

INSERT INTO directus_fields (collection, field, special, interface, sort, width)
SELECT 'game_scheduling_derbies', 'confirmed', 'cast-boolean', 'boolean', 6, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'game_scheduling_derbies' AND field = 'confirmed');

INSERT INTO directus_fields (collection, field, special, interface, readonly, hidden, sort)
SELECT 'game_scheduling_derbies', 'date_created', 'date-created', 'datetime', true, true, 90
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'game_scheduling_derbies' AND field = 'date_created');

INSERT INTO directus_fields (collection, field, special, interface, readonly, hidden, sort)
SELECT 'game_scheduling_derbies', 'date_updated', 'date-updated', 'datetime', true, true, 91
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'game_scheduling_derbies' AND field = 'date_updated');

INSERT INTO directus_fields (collection, field, special, interface, readonly, hidden, sort)
SELECT 'game_scheduling_derbies', 'user_created', 'user-created', 'select-dropdown-m2o', true, true, 92
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'game_scheduling_derbies' AND field = 'user_created');

INSERT INTO directus_fields (collection, field, special, interface, readonly, hidden, sort)
SELECT 'game_scheduling_derbies', 'user_updated', 'user-updated', 'select-dropdown-m2o', true, true, 93
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'game_scheduling_derbies' AND field = 'user_updated');

-- ── Directus relations metadata ──────────────────────────────────────
INSERT INTO directus_relations (many_collection, many_field, one_collection, one_field, one_collection_field, one_allowed_collections, junction_field, sort_field, one_deselect_action)
SELECT 'game_scheduling_derbies', 'season', 'game_scheduling_seasons', NULL, NULL, NULL, NULL, NULL, 'nullify'
WHERE NOT EXISTS (SELECT 1 FROM directus_relations WHERE many_collection = 'game_scheduling_derbies' AND many_field = 'season');

INSERT INTO directus_relations (many_collection, many_field, one_collection, one_field, one_collection_field, one_allowed_collections, junction_field, sort_field, one_deselect_action)
SELECT 'game_scheduling_derbies', 'team_a', 'teams', NULL, NULL, NULL, NULL, NULL, 'nullify'
WHERE NOT EXISTS (SELECT 1 FROM directus_relations WHERE many_collection = 'game_scheduling_derbies' AND many_field = 'team_a');

INSERT INTO directus_relations (many_collection, many_field, one_collection, one_field, one_collection_field, one_allowed_collections, junction_field, sort_field, one_deselect_action)
SELECT 'game_scheduling_derbies', 'team_b', 'teams', NULL, NULL, NULL, NULL, NULL, 'nullify'
WHERE NOT EXISTS (SELECT 1 FROM directus_relations WHERE many_collection = 'game_scheduling_derbies' AND many_field = 'team_b');

COMMIT;
