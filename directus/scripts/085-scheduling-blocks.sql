-- Migration 085: Team-level scheduling blackouts (Team blocking).
--
-- `scheduling_blocks` — coach/TR-created date-range blocks that HARD-block
-- game scheduling for a whole team, regardless of how many players are absent.
--
-- Motivation: away-proposal slot 3 is intentionally lenient (it tolerates up
-- to 2 absent players — see game-scheduling.js `absMax = i < 2 ? 0 : 2`), so a
-- team that simply doesn't want games in a given window can't rely on a couple
-- of player absences to stop a proposal. Team events already hard-block every
-- proposal, but they carry RSVP/chat/notification baggage and aren't the right
-- semantic. This collection is the dedicated "no games for this team on these
-- dates" control: the endpoint treats a covering block exactly like a team
-- event (a hard block on home-slot offering AND all three away proposals).
--
-- Team-level (not a per-player absence flag) on purpose: coaches/TRs attach to
-- a team via teams_coaches / teams_responsibles, NOT member_teams, so a
-- per-player flag created by a coach would never scope to the team. A direct
-- `team` FK is unambiguous.
--
-- Permissions live ONLY in setup-permissions.mjs (per CLAUDE.md hard rule):
-- LEADER (coach/TR) read/update/delete scoped to their teams, create enforced
-- in the kscw-hooks `scheduling_blocks.items.create` filter. This migration is
-- schema-only + idempotent.

BEGIN;

-- ── scheduling_blocks ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS scheduling_blocks (
  id              serial PRIMARY KEY,
  team            integer NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  start_date      date NOT NULL,
  end_date        date NOT NULL,
  reason          text,
  created_by      integer REFERENCES members(id) ON DELETE SET NULL,
  date_created    timestamptz NOT NULL DEFAULT now(),
  date_updated    timestamptz NOT NULL DEFAULT now(),
  user_created    uuid,
  user_updated    uuid,
  CONSTRAINT scheduling_blocks_dates_check CHECK (end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS scheduling_blocks_team_idx ON scheduling_blocks (team);
-- Hot path: "is there a block covering date D for team T?" (endpoint overlap check)
CREATE INDEX IF NOT EXISTS scheduling_blocks_team_range_idx
  ON scheduling_blocks (team, start_date, end_date);

COMMENT ON TABLE scheduling_blocks IS
  'Team-level game-scheduling blackouts (Team blocking). A row hard-blocks game scheduling for `team` on every date in [start_date, end_date] — home-slot offering AND all three away proposals — exactly like a team event, but coach/TR-managed with no RSVP/chat. Created via the app by coaches/TRs (scoped in setup-permissions.mjs + enforced in the kscw-hooks create filter).';
COMMENT ON COLUMN scheduling_blocks.reason IS
  'Optional free text shown to schedulers / on the team absence calendar (e.g. "Exam period", "League closure", "Tournament prep").';
COMMENT ON COLUMN scheduling_blocks.created_by IS
  'Member (coach/TR) who created the block. Stamped by the kscw-hooks create filter from accountability.user.';

-- ── Directus admin metadata ──────────────────────────────────────────
INSERT INTO directus_collections (collection, icon, color, "group", sort, archive_field, archive_value, unarchive_value, archive_app_filter)
SELECT 'scheduling_blocks', 'event_busy', '#DC2626', NULL, NULL, NULL, NULL, NULL, true
WHERE NOT EXISTS (SELECT 1 FROM directus_collections WHERE collection = 'scheduling_blocks');

INSERT INTO directus_fields (collection, field, special, interface, display, sort, width, note)
SELECT 'scheduling_blocks', 'team', 'm2o', 'select-dropdown-m2o', 'related-values', 1, 'half', 'Team this blackout applies to.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'scheduling_blocks' AND field = 'team');

INSERT INTO directus_fields (collection, field, special, interface, sort, width, note)
SELECT 'scheduling_blocks', 'start_date', NULL, 'datetime', 2, 'half', 'First blocked day (inclusive).'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'scheduling_blocks' AND field = 'start_date');

INSERT INTO directus_fields (collection, field, special, interface, sort, width, note)
SELECT 'scheduling_blocks', 'end_date', NULL, 'datetime', 3, 'half', 'Last blocked day (inclusive).'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'scheduling_blocks' AND field = 'end_date');

INSERT INTO directus_fields (collection, field, special, interface, sort, width, note)
SELECT 'scheduling_blocks', 'reason', NULL, 'input', 4, 'full', 'Optional reason shown to schedulers.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'scheduling_blocks' AND field = 'reason');

INSERT INTO directus_fields (collection, field, special, interface, sort, width)
SELECT 'scheduling_blocks', 'created_by', 'm2o', 'select-dropdown-m2o', 5, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'scheduling_blocks' AND field = 'created_by');

INSERT INTO directus_fields (collection, field, special, interface, readonly, hidden, sort)
SELECT 'scheduling_blocks', 'date_created', 'date-created', 'datetime', true, true, 90
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'scheduling_blocks' AND field = 'date_created');

INSERT INTO directus_fields (collection, field, special, interface, readonly, hidden, sort)
SELECT 'scheduling_blocks', 'date_updated', 'date-updated', 'datetime', true, true, 91
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'scheduling_blocks' AND field = 'date_updated');

INSERT INTO directus_fields (collection, field, special, interface, readonly, hidden, sort)
SELECT 'scheduling_blocks', 'user_created', 'user-created', 'select-dropdown-m2o', true, true, 92
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'scheduling_blocks' AND field = 'user_created');

INSERT INTO directus_fields (collection, field, special, interface, readonly, hidden, sort)
SELECT 'scheduling_blocks', 'user_updated', 'user-updated', 'select-dropdown-m2o', true, true, 93
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'scheduling_blocks' AND field = 'user_updated');

-- ── Directus relations metadata ──────────────────────────────────────
INSERT INTO directus_relations (many_collection, many_field, one_collection, one_field, one_collection_field, one_allowed_collections, junction_field, sort_field, one_deselect_action)
SELECT 'scheduling_blocks', 'team', 'teams', NULL, NULL, NULL, NULL, NULL, 'nullify'
WHERE NOT EXISTS (SELECT 1 FROM directus_relations WHERE many_collection = 'scheduling_blocks' AND many_field = 'team');

INSERT INTO directus_relations (many_collection, many_field, one_collection, one_field, one_collection_field, one_allowed_collections, junction_field, sort_field, one_deselect_action)
SELECT 'scheduling_blocks', 'created_by', 'members', NULL, NULL, NULL, NULL, NULL, 'nullify'
WHERE NOT EXISTS (SELECT 1 FROM directus_relations WHERE many_collection = 'scheduling_blocks' AND many_field = 'created_by');

COMMIT;
