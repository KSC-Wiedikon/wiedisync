-- Migration 313: stage the FIVB VIS player index we already download.
--
-- `vis-player-check` resolves each member against the player index of their
-- federation of origin by downloading that federation's WHOLE roster and
-- matching locally. Those rosters were thrown away the moment the run ended, so
-- only the verdict survived (`members.in_vis` / `vis_player_no`) and the
-- evidence did not. Two consequences worth removing:
--
--   • "Why did this member not match?" was unanswerable after the fact. The
--     only way to look was to run the whole download again — and the index may
--     have changed in between, so the answer was not even the same question.
--   • Every consumer re-downloaded the same rosters. The on-demand endpoint and
--     the cron each pull tens of thousands of rows to match ~102 members.
--
-- ⚠ This changes RETENTION, not exposure: these rows are already fetched on
-- every run. What is new is that they persist, so keep the footprint minimal and
-- self-pruning:
--
--   • Only the federations our own members claim as origin (28 on prod
--     2026-08-13, not the 69 in the directory). A federation stops being synced
--     the moment no member points at it, and the next run drops its rows.
--   • Names and the VIS player number ONLY. The upstream request asks for
--     `Properties="No"` plus `FirstName LastName` — no birthdate, no club, no
--     contact detail — and this table deliberately cannot hold more than that
--     request returns.
--   • The writer REPLACES the whole table inside one transaction on every run,
--     so `synced_at` is uniform, a dropped federation cannot linger, and the
--     table is always exactly "the last successful download" rather than an
--     accreting archive. That is the TTL: nothing here outlives one run.
--
-- ⚠ PK is (federation_iso, player_no), NOT player_no alone. A VIS player number
-- is believed to be global, but nothing we control guarantees a player cannot
-- appear in two federations' lists (that is, after all, what a transfer moves),
-- and a bare PK would abort the whole sync on the first such row. The composite
-- is correct either way; the writer logs any number seen under two federations
-- so the question gets ANSWERED by data instead of assumed.
--
-- Schema-only + idempotent. Read-only mirror: written by cron, never by the UI.

BEGIN;

CREATE TABLE IF NOT EXISTS vis_players (
  federation_iso  varchar(2)  NOT NULL,
  player_no       integer     NOT NULL,
  federation_code varchar(3),
  federation_no   integer,
  first_name      text,
  last_name       text,
  synced_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (federation_iso, player_no)
);

COMMENT ON TABLE vis_players IS
  'FIVB VIS player index, mirrored ONLY for the federations our members claim as federation of origin. Fully replaced on each vis-player-check run — never an archive. Holds names + VIS player number only, matching what the upstream GetPlayerList request asks for.';
COMMENT ON COLUMN vis_players.federation_iso IS
  'ISO alpha-2, the key members.federation_of_origin uses. federation_code is the FIVB 3-letter code for the same body.';
COMMENT ON COLUMN vis_players.player_no IS
  'VIS player number — the value that lands in members.vis_player_no on a match.';

-- The reverse lookup (given a player number, who is it?) is what makes a stored
-- `vis_player_no` and a hand-set `vis_player_no_manual` checkable; the PK's
-- leading column cannot serve it.
CREATE INDEX IF NOT EXISTS vis_players_player_no_idx ON vis_players (player_no);

-- The matcher's own access pattern: surname first, then given name.
CREATE INDEX IF NOT EXISTS vis_players_name_idx
  ON vis_players (lower(last_name), lower(first_name));

COMMIT;

-- After applying: run `npm run db:setup-perms:dev|prod` — vis_players joins the
-- Sport Admin read list beside vis_transfers / vis_federations.
