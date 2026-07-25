-- Migration 237: staging for the FIVB VIS international-transfer read.
--
-- `members.transfer_status` (migration 234) is what the CLUB believes; this table
-- is what FIVB actually says. Keeping them apart matters: the club's toggle is a
-- workflow marker somebody sets by hand, while VIS is the authoritative record of
-- whether the ITC exists. Conflating them would let a stale toggle mask an
-- incomplete transfer — and a player without a validated licence is not eligible
-- to play (Swiss Volley: "vorher ist die Lizenz/der Einsatz nicht gültig").
--
-- Filled by `vis-transfer-sync.mjs`, which replays the VIS app's own read request
-- over its XML-in/JSON-out proxy. Read-only by construction — the request type is
-- a hardcoded constant checked against a read-verb allowlist, because the same
-- endpoint also serves Sign/Confirm/Release/CancelVolleyTransfer.
--
-- Keyed on the VIS transfer number, so a re-sync updates in place. Player identity
-- is stored as VIS's own numbers plus the cached names; matching to `members` is
-- deliberately NOT done here — VIS player numbers are not something we hold, so
-- the join is by name and stays in the reporting layer where a wrong match is
-- visible rather than persisted.
--
-- Schema-only + idempotent.

BEGIN;

CREATE TABLE IF NOT EXISTS vis_transfers (
  vis_no             integer PRIMARY KEY,
  season_no          integer NOT NULL,
  no_by_season       integer,
  status_code        integer,
  status_label       text,
  percent_complete   integer,
  is_player_minor    boolean,
  is_player_blocked  boolean,
  start_on           date,
  end_on             date,
  player_no          integer,
  player_first_name  text,
  player_last_name   text,
  from_federation_no integer,
  to_club_no         integer,
  to_club_name       text,
  to_team_name       text,
  to_division_name   text,
  deleted_at         timestamptz,
  synced_at          timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE vis_transfers IS
  'FIVB VIS international transfers for KSC Wiedikon (club 13021), read-only mirror. status_code 200/210/215/220 = ended (ITC issued); 239/240 cancelled; 255 refused. Authoritative, unlike members.transfer_status which is the club''s own workflow marker.';

CREATE INDEX IF NOT EXISTS vis_transfers_season_idx ON vis_transfers (season_no);
CREATE INDEX IF NOT EXISTS vis_transfers_name_idx
  ON vis_transfers (lower(player_last_name), lower(player_first_name));

COMMIT;
