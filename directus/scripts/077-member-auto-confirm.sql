-- Migration 077: per-member auto-confirm RSVP opt-in
--
-- Adds three member-level booleans that let an individual opt themselves into
-- auto-confirmation, independently of (and OR-ed with) the team-level
-- `training_auto_confirm` / `game_auto_confirm` settings in teams.features_enabled.
--
-- While a flag is on, the kscw-hooks auto-confirm pass inserts a `confirmed`
-- participation for this member on every newly-created activity of that type
-- (trainings.items.create / games.items.create / events.items.create + the
-- slot-cascade callsites), and flipping a flag on backfills all existing
-- upcoming activities (members.items.update hook). Both paths use NOT EXISTS,
-- so they never touch a row the member already answered or an absence already
-- declined.
--
-- Distinct from the team setting: team-on confirms everyone; these let a
-- single member opt in even when the team default is off. There is no team
-- equivalent for events — events auto-confirm is member-opt-in only.
--
-- Schema-only + idempotent. Permissions for the new fields live in
-- setup-permissions.mjs (MEMBER_EDITABLE_FIELDS).

BEGIN;

ALTER TABLE members ADD COLUMN IF NOT EXISTS auto_confirm_trainings boolean NOT NULL DEFAULT false;
ALTER TABLE members ADD COLUMN IF NOT EXISTS auto_confirm_games boolean NOT NULL DEFAULT false;
ALTER TABLE members ADD COLUMN IF NOT EXISTS auto_confirm_events boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN members.auto_confirm_trainings IS
  'When true, this member is auto-confirmed on every new training of their teams (OR-ed with teams.features_enabled.training_auto_confirm). Flipping on backfills existing upcoming trainings. Never overrides a manual answer or an absence-decline.';
COMMENT ON COLUMN members.auto_confirm_games IS
  'When true, this member is auto-confirmed on every new game of their teams (OR-ed with teams.features_enabled.game_auto_confirm). Guests (guest_level > 0) are still excluded by trg_participations_guest_block.';
COMMENT ON COLUMN members.auto_confirm_events IS
  'When true, this member is auto-confirmed on every new event they are eligible for (invited team / individual invite / club-wide), whole-event mode only. No team-level equivalent exists for events.';

-- Directus field metadata so the columns are recognized by the schema and
-- editable from the admin UI (mirrors the existing boolean rows on members).
INSERT INTO directus_fields (collection, field, special, interface, sort, hidden, note)
SELECT 'members', v.field, NULL, 'boolean', v.sort, false, v.note
FROM (VALUES
  ('auto_confirm_trainings', 200, 'Auto-confirm this member on new trainings (member opt-in, OR-ed with the team setting).'),
  ('auto_confirm_games',     201, 'Auto-confirm this member on new games (member opt-in, OR-ed with the team setting).'),
  ('auto_confirm_events',    202, 'Auto-confirm this member on new events they are eligible for (member opt-in).')
) AS v(field, sort, note)
WHERE NOT EXISTS (
  SELECT 1 FROM directus_fields WHERE collection = 'members' AND field = v.field
);

COMMIT;
