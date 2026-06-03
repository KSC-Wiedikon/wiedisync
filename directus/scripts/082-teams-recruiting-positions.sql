-- Migration 082: team-level recruiting positions.
--
-- Adds `teams.recruiting_positions jsonb` (nullable). When a team is open for
-- new players (open_for_players=true), this holds the MemberPosition[] the team
-- is recruiting for (e.g. ["setter","middle"]). NULL/[] = open to all positions.
--
-- Supersedes the per-trial-training `trainings.recruiting_positions` (migration
-- 060): recruiting is now a single team-level setting edited next to the
-- "Open for new players" toggle, not a per-Probetraining choice. The selector
-- moved out of the trial-training form into the team settings (RosterEditor).
--
-- The old `trainings.recruiting_positions` column is intentionally LEFT IN PLACE
-- (dormant, no longer written by the app). Dropping it would require rewriting
-- the delicate trial-transform triggers (056/061) that COALESCE it onto the
-- regular row — not worth the risk for a now-unused column. It just stops being
-- populated.
--
-- Surfaced publicly via /kscw/public/team/:id (no endpoint change — the handler
-- spreads the full teams row into the public payload) for teams with
-- open_for_players=true.
--
-- Idempotent.

BEGIN;

-- ── Column ───────────────────────────────────────────────────────
ALTER TABLE teams ADD COLUMN IF NOT EXISTS recruiting_positions jsonb;

COMMENT ON COLUMN teams.recruiting_positions IS
  'Positions the team is recruiting for (e.g. ["setter","middle"]). NULL/[] = open to all positions. Surfaced on the public team page when open_for_players=true.';

-- Directus field metadata so the column is editable from the admin UI
-- (same pattern as migration 060's trainings.recruiting_positions field row).
INSERT INTO directus_fields (collection, field, special, interface, sort, hidden, note)
SELECT 'teams', 'recruiting_positions', 'cast-json', 'tags', 60, false,
  'Positions the team is recruiting for. Empty = open to all positions. Shown on the public team page when open for new players.'
WHERE NOT EXISTS (
  SELECT 1 FROM directus_fields WHERE collection = 'teams' AND field = 'recruiting_positions'
);

COMMIT;
