-- Migration 395: provisional game result + Volleymanager result-report journal.
--
-- From kickoff +3 h until the official result arrives (sv-sync sets
-- games.status = 'completed'), a participant of a volleyball game can enter the
-- set scores in the game modal (endpoint `kscw-endpoints/src/game-result.js`).
-- The score is stored here as PROVISIONAL at once — every surface shows it with a
-- "Provisional" badge — and a spawned worker (`scripts/vm-push-result.mjs`) files
-- our result report in Volleymanager in the background.
--
-- Two groups of columns, both on `games`:
--   provisional_*   the score we show until the official one lands. Left in place
--                   once the game is 'completed' — history, not cleared; every
--                   reader prefers the official score by status.
--   vm_result_*     the push journal, same idea as the vm_nomination_* columns
--   vm_opponent_*   (migration 206): status, error, lease, VM ids, and the
--                   opponent's report as last read from Volleymanager.
--
-- ALL of them are endpoint-owned: written by raw knex in game-result.js, by the
-- worker and by the hourly read sweep (kscw-hooks). setup-permissions.mjs keeps
-- them OUT of GAME_WRITE_FIELDS, so a coach cannot forge a result state or park a
-- push at 'pending'. Members read them through the existing club-wide games read;
-- none of them goes into PUBLIC_GAME_FIELDS — the website shows official results
-- only.
--
-- Schema-only, idempotent.

BEGIN;

ALTER TABLE games ADD COLUMN IF NOT EXISTS provisional_sets_json json;
ALTER TABLE games ADD COLUMN IF NOT EXISTS provisional_home_score integer;
ALTER TABLE games ADD COLUMN IF NOT EXISTS provisional_away_score integer;
ALTER TABLE games ADD COLUMN IF NOT EXISTS provisional_source varchar(16);
ALTER TABLE games ADD COLUMN IF NOT EXISTS provisional_by_name varchar(255);
ALTER TABLE games ADD COLUMN IF NOT EXISTS provisional_at timestamptz;
ALTER TABLE games ADD COLUMN IF NOT EXISTS vm_result_status varchar(16);
ALTER TABLE games ADD COLUMN IF NOT EXISTS vm_result_error text;
ALTER TABLE games ADD COLUMN IF NOT EXISTS vm_result_pushed_at timestamptz;
ALTER TABLE games ADD COLUMN IF NOT EXISTS vm_result_claimed_at timestamptz;
ALTER TABLE games ADD COLUMN IF NOT EXISTS vm_result_report_id varchar(64);
ALTER TABLE games ADD COLUMN IF NOT EXISTS vm_opponent_report json;
ALTER TABLE games ADD COLUMN IF NOT EXISTS vm_result_checked_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'games_provisional_source_check') THEN
    ALTER TABLE games
      ADD CONSTRAINT games_provisional_source_check
      CHECK (provisional_source IN ('own', 'opponent', 'confirmed', 'vm_official'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'games_vm_result_status_check') THEN
    ALTER TABLE games
      ADD CONSTRAINT games_vm_result_status_check
      CHECK (vm_result_status IN ('pending', 'reported', 'confirmed', 'conflict', 'failed', 'skipped'));
  END IF;
END $$;

COMMENT ON COLUMN games.provisional_sets_json IS
  'Provisional set scores [{"home":25,"away":21}, …] (same shape as sets_json). Shown until status = completed; kept afterwards as history.';
COMMENT ON COLUMN games.provisional_home_score IS
  'Provisional sets won by the home team.';
COMMENT ON COLUMN games.provisional_away_score IS
  'Provisional sets won by the away team.';
COMMENT ON COLUMN games.provisional_source IS
  'own = our team entered it; opponent = read from the opponent''s VM report, unconfirmed; confirmed = our report equals the opponent''s; vm_official = VM already holds the official result the SV feed has not delivered yet.';
COMMENT ON COLUMN games.provisional_by_name IS
  'Member who entered the provisional result (actor capture; NULL when it came from Volleymanager).';
COMMENT ON COLUMN games.provisional_at IS
  'When the provisional result was stored.';
COMMENT ON COLUMN games.vm_result_status IS
  'Volleymanager result-report push: pending / reported / confirmed / conflict / failed / skipped. Endpoint- and worker-owned.';
COMMENT ON COLUMN games.vm_result_error IS
  'Why the push failed or was skipped (e.g. derby, home_team_reports, not_reportable, no_vm_game, dry_run).';
COMMENT ON COLUMN games.vm_result_pushed_at IS
  'Last successful result-report write to Volleymanager.';
COMMENT ON COLUMN games.vm_result_claimed_at IS
  'Row lease for the result push (10 min): only one worker per game in flight.';
COMMENT ON COLUMN games.vm_result_report_id IS
  'Our Volleymanager gameResultReport __identity.';
COMMENT ON COLUMN games.vm_opponent_report IS
  'The opponent''s VM result report as last read: {"sets":[{home,away}],"home":3,"away":2,"reported_at":iso,"party":"hometeam"} or NULL.';
COMMENT ON COLUMN games.vm_result_checked_at IS
  'Last Volleymanager read of this game''s result reports (sweep or game modal).';

INSERT INTO directus_fields (collection, field, special, interface, options, readonly, hidden, sort, width, note)
SELECT 'games', v.field, 'cast-json', 'input-code', '{"language":"json"}'::json, true, false, v.sort, 'full', v.note
FROM (VALUES
  ('provisional_sets_json', 210, 'Provisional set scores, shown until the official result arrives (read-only).'),
  ('vm_opponent_report',    221, 'Opponent''s Volleymanager result report as last read (read-only).')
) AS v(field, sort, note)
WHERE NOT EXISTS (
  SELECT 1 FROM directus_fields df WHERE df.collection = 'games' AND df.field = v.field
);

INSERT INTO directus_fields (collection, field, interface, readonly, hidden, sort, width, note)
SELECT 'games', v.field, v.interface, true, false, v.sort, 'half', v.note
FROM (VALUES
  ('provisional_home_score', 'input',    211, 'Provisional sets won by the home team (read-only).'),
  ('provisional_away_score', 'input',    212, 'Provisional sets won by the away team (read-only).'),
  ('provisional_source',     'input',    213, 'own / opponent / confirmed / vm_official (read-only).'),
  ('provisional_by_name',    'input',    214, 'Who entered the provisional result (read-only).'),
  ('provisional_at',         'datetime', 215, 'When the provisional result was stored (read-only).'),
  ('vm_result_status',       'input',    216, 'Volleymanager result push status (read-only, written by the endpoint + worker).'),
  ('vm_result_error',        'input',    217, 'Last result push failure or skip reason (read-only).'),
  ('vm_result_pushed_at',    'datetime', 218, 'Last successful result report to Volleymanager (read-only).'),
  ('vm_result_claimed_at',   'datetime', 219, 'Result push row lease (read-only).'),
  ('vm_result_report_id',    'input',    220, 'Our Volleymanager gameResultReport uuid (read-only).'),
  ('vm_result_checked_at',   'datetime', 222, 'Last Volleymanager read of the result reports (read-only).')
) AS v(field, interface, sort, note)
WHERE NOT EXISTS (
  SELECT 1 FROM directus_fields df WHERE df.collection = 'games' AND df.field = v.field
);

COMMIT;
