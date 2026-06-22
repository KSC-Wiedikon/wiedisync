-- Migration 123: per-duty confirmation actor + timestamp (supersedes 122).
--
-- Model: a duty is "Confirmed" iff it has a person on it (no separate Assigned
-- state). Each duty role records WHO put the person there and WHEN, shown on the
-- scorer page TO ADMINS ONLY. "Confirmed" itself is derived from member presence
-- in the UI, so there's no boolean here and no data backfill — historical filled
-- games simply read as Confirmed, with a blank actor (not recorded retroactively).
--
-- Replaces the game-level columns from migration 122 (duty_confirmed_by_name,
-- duty_confirmed_at). The legacy boolean games.duty_confirmed is left in place
-- (vestigial — the UI now derives confirmed-ness from member presence) to avoid
-- SCHEMA.sql / setup-schema.mjs / manualGamePayload churn.
--
-- Roles → member FK column:
--   scorer            → scorer_member
--   scoreboard        → scoreboard_member
--   scorer_scoreboard → scorer_scoreboard_member   (VB combined mode)
--   bb_scorer         → bb_scorer_member
--   bb_timekeeper     → bb_timekeeper_member
--   bb_24s            → bb_24s_official
--
-- Schema-only + idempotent. No permission change (games.read already ['*']).

BEGIN;

-- 1) Drop the superseded game-level columns from migration 122.
ALTER TABLE games DROP COLUMN IF EXISTS duty_confirmed_by_name;
ALTER TABLE games DROP COLUMN IF EXISTS duty_confirmed_at;
DELETE FROM directus_fields WHERE collection = 'games'
  AND field IN ('duty_confirmed_by_name', 'duty_confirmed_at');

-- 2) Add per-role actor + timestamp columns.
ALTER TABLE games ADD COLUMN IF NOT EXISTS scorer_confirmed_by_name varchar(255);
ALTER TABLE games ADD COLUMN IF NOT EXISTS scorer_confirmed_at timestamptz;
ALTER TABLE games ADD COLUMN IF NOT EXISTS scoreboard_confirmed_by_name varchar(255);
ALTER TABLE games ADD COLUMN IF NOT EXISTS scoreboard_confirmed_at timestamptz;
ALTER TABLE games ADD COLUMN IF NOT EXISTS scorer_scoreboard_confirmed_by_name varchar(255);
ALTER TABLE games ADD COLUMN IF NOT EXISTS scorer_scoreboard_confirmed_at timestamptz;
ALTER TABLE games ADD COLUMN IF NOT EXISTS bb_scorer_confirmed_by_name varchar(255);
ALTER TABLE games ADD COLUMN IF NOT EXISTS bb_scorer_confirmed_at timestamptz;
ALTER TABLE games ADD COLUMN IF NOT EXISTS bb_timekeeper_confirmed_by_name varchar(255);
ALTER TABLE games ADD COLUMN IF NOT EXISTS bb_timekeeper_confirmed_at timestamptz;
ALTER TABLE games ADD COLUMN IF NOT EXISTS bb_24s_confirmed_by_name varchar(255);
ALTER TABLE games ADD COLUMN IF NOT EXISTS bb_24s_confirmed_at timestamptz;

-- 3) Register the columns in directus_fields (admin Data Model + items API).
INSERT INTO directus_fields (collection, field, special, interface, sort, hidden, note)
SELECT 'games', v.field, NULL, v.interface, v.sort, false, 'Per-duty confirmation actor/time (system-set by hook; shown to admins).'
FROM (VALUES
  ('scorer_confirmed_by_name', 'input', 130),
  ('scorer_confirmed_at', 'datetime', 131),
  ('scoreboard_confirmed_by_name', 'input', 132),
  ('scoreboard_confirmed_at', 'datetime', 133),
  ('scorer_scoreboard_confirmed_by_name', 'input', 134),
  ('scorer_scoreboard_confirmed_at', 'datetime', 135),
  ('bb_scorer_confirmed_by_name', 'input', 136),
  ('bb_scorer_confirmed_at', 'datetime', 137),
  ('bb_timekeeper_confirmed_by_name', 'input', 138),
  ('bb_timekeeper_confirmed_at', 'datetime', 139),
  ('bb_24s_confirmed_by_name', 'input', 140),
  ('bb_24s_confirmed_at', 'datetime', 141)
) AS v(field, interface, sort)
WHERE NOT EXISTS (
  SELECT 1 FROM directus_fields df WHERE df.collection = 'games' AND df.field = v.field
);

COMMIT;
