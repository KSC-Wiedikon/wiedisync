-- Migration 400: basketball tournament weekend wishes + per-team preferences.
--
-- New tournament batches open the moment Basketplan publishes them, so a
-- coach has nothing to pick in advance. Instead a coach names the WEEKENDS
-- the team wants to play; the registration worker (bb-tournament-worker.js)
-- watches the list and, when an open tournament for the team's league appears
-- in such a week, creates the pick itself and registers it — at most one per
-- team and week.
--   * bb_tournament_wishes — one row per team + week (week_start = Monday).
--   * bb_tournament_team_prefs — per team: places to avoid (matched against
--     host club and hall) and whether the team is hidden from /tournaments.
--   * bb_tournament_picks.wish — the wish a pick was made from (NULL = by hand).
--
-- Endpoint-only, no /items grant, no permission rows (CLAUDE.md rule 1).
-- Schema-only + idempotent (one backfill: MU8 hidden, decided 05.10.2026).

BEGIN;

CREATE TABLE IF NOT EXISTS bb_tournament_wishes (
  id              serial PRIMARY KEY,
  team            integer NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  week_start      date NOT NULL CHECK (extract(isodow FROM week_start) = 1),
  wished_by       integer REFERENCES members(id) ON DELETE SET NULL,
  wished_by_name  varchar(200),
  date_created    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bb_tournament_wishes_team_week_uq UNIQUE (team, week_start)
);
CREATE INDEX IF NOT EXISTS bb_tournament_wishes_week_idx ON bb_tournament_wishes (week_start);

CREATE TABLE IF NOT EXISTS bb_tournament_team_prefs (
  team             integer PRIMARY KEY REFERENCES teams(id) ON DELETE CASCADE,
  hidden           boolean NOT NULL DEFAULT false,
  avoid            text[] NOT NULL DEFAULT '{}',
  updated_by_name  varchar(200),
  date_updated     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE bb_tournament_picks
  ADD COLUMN IF NOT EXISTS wish integer REFERENCES bb_tournament_wishes(id) ON DELETE SET NULL;

-- MU8 organises its tournaments in its own chat and does not pick here.
INSERT INTO bb_tournament_team_prefs (team, hidden)
SELECT id, true FROM teams WHERE sport = 'basketball' AND active AND name = 'MU8'
ON CONFLICT (team) DO NOTHING;

COMMENT ON TABLE bb_tournament_wishes IS
  'Weekends a youth basketball team wants a tournament; the registration worker picks the first open fitting one per week. Migration 400.';
COMMENT ON TABLE bb_tournament_team_prefs IS
  'Per tournament team: places to avoid for weekend wishes, hidden from /tournaments. Migration 400.';

COMMIT;
