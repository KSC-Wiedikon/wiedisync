-- Migration 399: basketball tournament registration worker.
--
-- The coaches' picks (migration 398) are registered on Basketplan by a worker
-- in kscw-endpoints (bb-tournament-worker.js) instead of by hand:
--   * bb_tournament_worker — one settings row: mode (off | dry | live), an
--     optional "opening" window during which Basketplan's list is polled every
--     poll_seconds, and who changed it last. Default OFF.
--     ⚠ dev's DB is a nightly prod clone and both containers share the club's
--     Basketplan login, so 'live' only takes effect where the container env
--     sets BASKETPLAN_REGISTER_LIVE=1 (prod). Elsewhere it runs as 'dry'.
--   * bb_tournament_registrations — the journal: one row per attempt. A live
--     attempt writes its row as 'submitting' BEFORE the request goes out; the
--     partial unique index makes a second submission for the same
--     tournament + team impossible, even after a crash mid-request
--     ('submitting' is never retried — a person looks at it).
--   * bb_tournaments.list_status — the list's raw action column ("Anmelden",
--     "Anmeldefrist abgelaufen", or whatever a not-yet-open tournament shows),
--     so a tournament listed before sign-up opens can be picked in advance.
--
-- Endpoint-only, no /items grant, no permission rows (CLAUDE.md rule 1).
-- Schema-only + idempotent.

BEGIN;

ALTER TABLE bb_tournaments ADD COLUMN IF NOT EXISTS list_status varchar(60);

CREATE TABLE IF NOT EXISTS bb_tournament_worker (
  id               integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  mode             varchar(10) NOT NULL DEFAULT 'off' CHECK (mode IN ('off', 'dry', 'live')),
  rush_from        timestamptz,
  rush_until       timestamptz,
  poll_seconds     integer NOT NULL DEFAULT 30 CHECK (poll_seconds BETWEEN 20 AND 300),
  updated_by_name  varchar(200),
  date_updated     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bb_tournament_worker_window_ck CHECK (
    (rush_from IS NULL AND rush_until IS NULL)
    OR (rush_from IS NOT NULL AND rush_until IS NOT NULL AND rush_until > rush_from
        AND rush_until - rush_from <= interval '3 hours'))
);
INSERT INTO bb_tournament_worker (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS bb_tournament_registrations (
  id            serial PRIMARY KEY,
  tournament    integer NOT NULL REFERENCES bb_tournaments(id) ON DELETE CASCADE,
  team          integer NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  mode          varchar(10) NOT NULL CHECK (mode IN ('dry', 'live')),
  -- submitting → registered | unconfirmed | error ; or, without a submission:
  -- dry_run | already | not_offered | closed
  result        varchar(20) NOT NULL,
  message       varchar(300),
  attempted_at  timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz
);

-- Never two live submissions for one tournament + team.
CREATE UNIQUE INDEX IF NOT EXISTS bb_tournament_registrations_live_uq
  ON bb_tournament_registrations (tournament, team)
  WHERE result IN ('submitting', 'registered', 'unconfirmed');
CREATE INDEX IF NOT EXISTS bb_tournament_registrations_attempted_idx
  ON bb_tournament_registrations (attempted_at DESC);

COMMENT ON TABLE bb_tournament_worker IS
  'Settings of the Basketplan registration worker (bb-tournament-worker.js): mode off|dry|live, opening window. Live only where BASKETPLAN_REGISTER_LIVE=1. Migration 399.';
COMMENT ON TABLE bb_tournament_registrations IS
  'Journal of the Basketplan registration worker: one row per attempt; a live attempt is written as submitting before the request (partial unique = never twice). Migration 399.';

COMMIT;
