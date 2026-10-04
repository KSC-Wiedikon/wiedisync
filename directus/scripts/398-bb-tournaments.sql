-- Migration 398: basketball youth tournaments + the coaches' picks.
--
-- Youth basketball (DU12, HU12, MU10, MU8…) plays no league, only one-day
-- tournaments hosted by other clubs and published on Basketplan. Until now
-- the sport admin signed every team up by hand from coaches' messages.
--
--   * bb_tournaments — a copy of Basketplan's tournament list, refreshed by the
--     daily bp-sync (bp-tournaments.js). Keyed by Basketplan's own tournament
--     id. Holds what the picking page needs: date, host, hall, leagues (age
--     categories), registration deadline, whether sign-up is open, how many
--     teams are in, and which KSCW teams are registered. NO contact data — a
--     Basketplan tournament page lists every club's coach with phone and
--     e-mail; none of it is copied.
--   * bb_tournament_picks — a coach / TR of the team (or a basketball admin)
--     ticks the tournaments the team should play. No approval step: the
--     club decided on 04.10.2026 that the choice is the coach's. The sport
--     admin registers the picks on Basketplan (later a worker may do it).
--
-- ⚠ Read and written ONLY through kscw-endpoints (bb-tournament-picks.js),
-- same model as carpools (migration 378): not registered in Directus, no
-- /items grant, no permission rows (CLAUDE.md rule 1).
--
-- Actor capture: every pick write is raw knex → the endpoint calls
-- writeUserLog, and the row keeps picked_by / picked_by_name.
--
-- Schema-only + idempotent.

BEGIN;

CREATE TABLE IF NOT EXISTS bb_tournaments (
  -- Basketplan's tournamentId (findTournamentById.do?tournamentId=N).
  id                integer PRIMARY KEY,
  date              date NOT NULL,
  -- Last day, for the rare two-day tournament; NULL = one day.
  end_date          date,
  host_club         varchar(200),
  hall              varchar(200),
  time_from         time without time zone,
  time_to           time without time zone,
  -- Basketplan league codes ('DU12Tu', 'MixU10M', 'MixU 8M'…) — the same
  -- codes teams.league carries, matched with spaces/case ignored.
  leagues           text[] NOT NULL DEFAULT '{}',
  deadline          date,
  -- Sign-up open on Basketplan right now ("Anmelden" on the list).
  registration_open boolean NOT NULL DEFAULT false,
  registered_count  integer,
  -- Basketplan team ids of KSCW teams registered (teams.bb_source_id).
  kscw_bp_team_ids  text[] NOT NULL DEFAULT '{}',
  first_seen_at     timestamptz NOT NULL DEFAULT now(),
  last_seen_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS bb_tournaments_date_idx ON bb_tournaments (date);

COMMENT ON TABLE bb_tournaments IS
  'Basketplan youth tournaments, mirrored by bp-sync (bp-tournaments.js). id = Basketplan tournamentId. No contact data. Endpoint-only (migration 398).';

CREATE TABLE IF NOT EXISTS bb_tournament_picks (
  id              serial PRIMARY KEY,
  tournament      integer NOT NULL REFERENCES bb_tournaments(id) ON DELETE CASCADE,
  team            integer NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  picked_by       integer REFERENCES members(id) ON DELETE SET NULL,
  picked_by_name  varchar(200),
  note            varchar(300),
  date_created    timestamptz NOT NULL DEFAULT now(),
  date_updated    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bb_tournament_picks_tournament_team_uq UNIQUE (tournament, team)
);

CREATE INDEX IF NOT EXISTS bb_tournament_picks_team_idx ON bb_tournament_picks (team);

COMMENT ON TABLE bb_tournament_picks IS
  'A team''s wish to play a Basketplan tournament, ticked by its coach/TR or a basketball admin. No approval step. Whether the team is actually registered is read from bb_tournaments.kscw_bp_team_ids, never stored here. Endpoint-only (migration 398).';

COMMIT;
