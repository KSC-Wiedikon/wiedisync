-- Migration 396: `game_vm_sheets` — the Einsatzliste as read from Volleymanager, ONCE.
--
-- WHY
-- ---
-- Until now every open of the match sheet — and of Show IDs, which reads the sheet to
-- learn who is on it — logged the SHARED Volleymanager account in and read the
-- Einsatzliste live (memoised for 60 s). A coach opening and re-opening the sheet at the
-- table fired VM again and again, on the account svrz_rc also uses.
--
-- Now the list is read ONCE, 45 min before kickoff (kscw-hooks cron, after the auto-filing
-- push's T-65…T-35 window has had its go), stored here, and every surface reads THIS row:
-- the match sheet, Show IDs, live scoring and the result participant check
-- (scorer-roster.js → loadVmRoster). A coach or admin can re-read it by hand ("Recheck",
-- POST /kscw/scorer/game/:gameId/vm-check), which replaces the row.
--
-- One row per game. `status` is the LATEST attempt:
--   ok           a list was read (players may still be empty: officials filed, no players)
--   no_list      VM answered — no Einsatzliste filed for our side
--   busy         another job held the shared account — nothing was read; the cron retries
--   failed       VM could not be read (login, timeout, error) — `error` says why
--   unavailable  no VM fixture for the game, or no VM credentials — nothing to retry
-- `list` + `list_at` are the last list VM actually answered with. A failed or busy
-- attempt never wipes them — the sheet keeps the last good list and flags the failure.
--
-- Raw-knex only (vm-sheet-check.js, scorer-roster.js, kscw-hooks): not a Directus
-- collection, no permission rows. The list carries full birthdates of minors, which only
-- the roster endpoint may hand out.
--
-- Schema-only, idempotent.

CREATE TABLE IF NOT EXISTS game_vm_sheets (
  game             integer      PRIMARY KEY,
  status           varchar(16)  NOT NULL,
  list             jsonb,                        -- { players, coaches, closed_at } (vm-nomination-list.js)
  list_at          timestamptz,                  -- when `list` was read (NULL: VM never answered)
  error            text,
  checked_at       timestamptz  NOT NULL DEFAULT NOW(),   -- the latest attempt
  checked_by       integer,                      -- members.id; NULL = the −45 min cron
  checked_by_name  varchar(255),
  CONSTRAINT game_vm_sheets_status_check
    CHECK (status IN ('ok', 'no_list', 'busy', 'failed', 'unavailable'))
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'game_vm_sheets_game_fk') THEN
    ALTER TABLE game_vm_sheets
      ADD CONSTRAINT game_vm_sheets_game_fk
      FOREIGN KEY (game) REFERENCES games(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'game_vm_sheets_checked_by_fk') THEN
    ALTER TABLE game_vm_sheets
      ADD CONSTRAINT game_vm_sheets_checked_by_fk
      FOREIGN KEY (checked_by) REFERENCES members(id) ON DELETE SET NULL;
  END IF;
END $$;

COMMENT ON TABLE game_vm_sheets IS
  'Einsatzliste read from Volleymanager once at kickoff -45 min (or by a coach''s Recheck). Every match-sheet surface reads this row instead of VM. Raw-knex only.';
