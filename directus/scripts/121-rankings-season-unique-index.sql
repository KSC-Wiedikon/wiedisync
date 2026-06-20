-- Migration 121: enforce one ranking row per (team_id, league, season).
--
-- The ranking syncs (kscw-endpoints/src/sv-sync.js, bp-sync.js) historically
-- upserted by (team_id, league) only — season was ignored in the lookup key, so
-- a new season's standings OVERWROTE the prior season's row in place (the
-- league caption "2L" / "Herren 2. Liga" is identical across seasons). That
-- destroyed the archive on every season rollover; only youth/regional groups
-- whose caption bakes in "Saison YY/YY" survived by accident.
--
-- Both syncs now include `season` in their upsert lookup key, so each season
-- accumulates its own rows. This index makes that invariant a hard guarantee at
-- the DB level (and turns any future regression or concurrent-run race into a
-- loud error instead of silent duplicates). Verified zero existing duplicate
-- (team_id, league, season) triples on dev + prod before adding.
--
-- Idempotent: CREATE UNIQUE INDEX IF NOT EXISTS.

CREATE UNIQUE INDEX IF NOT EXISTS rankings_team_league_season_uniq
  ON rankings (team_id, league, season);
