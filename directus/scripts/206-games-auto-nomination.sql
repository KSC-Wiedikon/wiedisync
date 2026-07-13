-- Migration 206: auto-file the Volleymanager Einsatzliste (nomination list) from our RSVPs.
--
-- Before every game someone has to open Volleymanager and hand-type the nomination
-- list — the licensed players the club may field. We already know who is playing:
-- they RSVP'd. A cron picks the game up ~60 min before kickoff, matches the confirmed
-- RSVPs to VM's licence holders, files the list, and (when it is safe to) closes it.
--
-- Opt-in, and off by default, because this writes into the real Swiss Volley
-- production system — there is no VM staging. The control surface mirrors the
-- existing auto-confirm-RSVP cascade exactly (games.auto_confirm_rsvp +
-- teams.features_enabled.game_auto_confirm), so there is one toggle idiom, not two:
--
--   games.auto_nomination_list IS NULL  → inherit the team default
--                            = true     → file this game's list
--                            = false    → never file this game's list
--   teams.features_enabled.auto_nomination_list → the team default (JSON key,
--                            same bag as game_auto_confirm; no teams migration)
--
-- Effective value, resolved at push time (NOT at game-create time, which is why —
-- unlike auto-confirm — this needs no backfill hook and is immune to the sweep gap
-- where raw-knex-inserted games bypass Directus hooks):
--
--   COALESCE(g.auto_nomination_list,
--            NULLIF(t.features_enabled->>'auto_nomination_list','')::boolean,
--            false)
--
-- The vm_nomination_* columns are the push journal: they make the cron idempotent
-- (never re-file a closed list) and surface failures in the UI instead of swallowing
-- them. Same shape as the vm_push_* columns migration 104 put on
-- game_scheduling_bookings for the schedule push.
--
-- Schema-only + idempotent, per the migration policy.

BEGIN;

-- Per-game toggle. Deliberately NULLABLE: null = inherit the team default, so a new
-- game (including the ~350/season inserted by sv-sync via raw knex) picks up the
-- team's setting without anyone touching it.
ALTER TABLE games ADD COLUMN IF NOT EXISTS auto_nomination_list boolean;

COMMENT ON COLUMN games.auto_nomination_list IS
  'Auto-file the Volleymanager Einsatzliste from confirmed RSVPs ~60 min before kickoff. '
  'NULL = inherit teams.features_enabled.auto_nomination_list; true/false = per-game override.';

-- Push journal.
ALTER TABLE games ADD COLUMN IF NOT EXISTS vm_nomination_status varchar(16);
ALTER TABLE games ADD COLUMN IF NOT EXISTS vm_nomination_list_id varchar(64);
ALTER TABLE games ADD COLUMN IF NOT EXISTS vm_nomination_count integer;
ALTER TABLE games ADD COLUMN IF NOT EXISTS vm_nomination_pushed_at timestamptz;
ALTER TABLE games ADD COLUMN IF NOT EXISTS vm_nomination_error text;

COMMENT ON COLUMN games.vm_nomination_status IS
  'filled = players written, list left OPEN (a fineable validation issue blocked the close, '
  'or the team asked us not to close). closed = filed AND closed, nothing left to do. '
  'skipped = nothing to file (no licensed confirmed players). failed = see vm_nomination_error. '
  'NULL = never attempted. The cron re-attempts anything not in (closed, skipped).';
COMMENT ON COLUMN games.vm_nomination_list_id IS
  'Volleymanager nominationList __identity (uuid). Set once created; lets a retry update the '
  'existing list instead of creating a second one.';
COMMENT ON COLUMN games.vm_nomination_count IS 'Players actually filed on the last successful push.';
COMMENT ON COLUMN games.vm_nomination_error IS 'Last push failure, surfaced to the coach in the game detail modal.';

-- The cron scans by kickoff window; without this it seq-scans games on every 5-min tick.
-- Partial: only games that are still candidates.
CREATE INDEX IF NOT EXISTS idx_games_nomination_pending
  ON games (date, "time")
  WHERE status = 'scheduled'
    AND COALESCE(vm_nomination_status, '') NOT IN ('closed', 'skipped');

-- Register in directus_fields — without this the items API and the admin dashboard
-- cannot see the columns at all (CLAUDE.md: schema-only migration, but the field
-- registration belongs with the DDL that created the column).
INSERT INTO directus_fields (collection, field, interface, options, readonly, hidden, sort, width, note)
SELECT 'games', 'auto_nomination_list', 'select-dropdown',
       '{"choices":[{"text":"Use team default","value":null},{"text":"On","value":true},{"text":"Off","value":false}]}',
       false, false, 90, 'half',
       'Auto-file the Volleymanager Einsatzliste from confirmed RSVPs ~60 min before kickoff. Empty = use the team default.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'games' AND field = 'auto_nomination_list');

INSERT INTO directus_fields (collection, field, interface, readonly, hidden, sort, width, note)
SELECT 'games', v.field, v.interface, true, false, v.sort, 'half', v.note
FROM (VALUES
  ('vm_nomination_status',    'input', 91, 'Volleymanager Einsatzliste push status (read-only, written by the cron).'),
  ('vm_nomination_list_id',   'input', 92, 'Volleymanager nominationList uuid (read-only).'),
  ('vm_nomination_count',     'input', 93, 'Players filed on the last push (read-only).'),
  ('vm_nomination_pushed_at', 'datetime', 94, 'Last successful Einsatzliste push (read-only).'),
  ('vm_nomination_error',     'input', 95, 'Last Einsatzliste push failure (read-only).')
) AS v(field, interface, sort, note)
WHERE NOT EXISTS (
  SELECT 1 FROM directus_fields df WHERE df.collection = 'games' AND df.field = v.field
);

COMMIT;
