-- Migration 340: a meeting time (Besammlung) for games, trainings and events.
--
-- "Be at the hall at 15:00 for a 16:00 game" is currently carried in the
-- training notes, in a WhatsApp message, or nowhere — every team re-invents it
-- and a called-up guest player has no way to know it. This puts it on the
-- record next to the start time, where every RSVP surface already looks.
--
-- ⚠⚠ THE STORAGE MODEL DIFFERS BY TABLE, AND THAT IS DELIBERATE.
--
--   games / trainings → `meeting_offset_minutes` (minutes BEFORE start)
--   events           → `meeting_time`            (an absolute wall clock)
--
-- Games and trainings are MACHINE-OWNED rows. `sv-sync.js` rewrites
-- `games.time` from the Swiss Volley feed on every reschedule (it is in
-- COMPARE_FIELDS), and `slot-cascade.js` generates `trainings` from
-- `hall_slots`. An absolute meeting time on those rows is stale the moment a
-- fixture moves — and stale in the worst direction, because 15:00 against an
-- 18:00 kickoff still LOOKS like a deliberate answer. Nothing would flag it.
-- An offset is the single source of truth: it is re-derived at display time and
-- follows a reschedule for free, with zero code in either generator.
--
-- ⚠ The column DEFAULT is what makes that "zero code" true. sv-sync INSERTs a
-- game without naming this column, so Postgres supplies 60; slot-cascade
-- INSERTs a training and Postgres supplies 10. Neither script is touched by
-- this migration, and neither has to be touched again.
--
-- Events are HAND-AUTHORED — no sync writes `events.start_date` — so the
-- staleness argument does not apply. What does apply is `all_day`: the event in
-- the report that prompted this (Rämi Turnier, a full-day tournament) has no
-- start clock to be N minutes before, and a tournament is exactly where a
-- Besammlung matters most. An offset from an all-day event's midnight would be
-- meaningless, so events store the clock time itself. Default NULL: most events
-- (a Sitzung, an Apéro) have no meeting time and must not invent one.
--
-- ⚠ NULL means "no meeting time" on all three, and stays reachable: the column
-- DEFAULT only fires when an INSERT omits the column, so a coach clearing the
-- field on a game writes NULL and it stays NULL.
--
-- ⚠ Backfill covers EVERY existing row, past ones included (the alternative —
-- upcoming only — leaves the club with two silently different conventions
-- depending on when a fixture was created). Past rows showing a meeting time is
-- harmless; a coach clears the ones whose team does not actually meet early.
--
-- ⚠ CHECK-bounded to [0, 1440]. A negative offset would render a meeting time
-- AFTER the start, and anything past a day is a typo, not an intent.
--
-- ⚠ `meeting_offset_minutes` must be added to KEEP_AS_NUMBER in src/lib/api.ts
-- in the same commit — `stringifyId()` turns every unlisted integer into a
-- STRING, and `start - '60'` is not arithmetic. Done in this commit.
--
-- ⚠ Registering the fields in `directus_fields` is required (CLAUDE.md → schema
-- rule) so the items API and the Data Explorer can read them.
--
-- ⚠⚠ Directus caches the schema at boot and a raw-SQL `directus_fields` insert
-- does NOT bust that cache (2026-08-22, `events.open_roster` read back as
-- `type: alias` until the container was restarted). Restart after applying:
--   npm run db:migrate:dev && ssh hetzner "sudo docker restart directus-kscw-dev"
--
-- Schema-only + idempotent. No permission rows (CLAUDE.md rule 1) — the columns
-- ride the existing grants, except `games`, whose coach/spielplaner writes go
-- through the GAME_WRITE_FIELDS allow-list in setup-permissions.mjs. That entry
-- is added in the same commit; without it the column is silently read-only to
-- every non-admin.

BEGIN;

-- ── games: 1 hour before kickoff ────────────────────────────────────────────
ALTER TABLE games
  ADD COLUMN IF NOT EXISTS meeting_offset_minutes integer DEFAULT 60;

ALTER TABLE games DROP CONSTRAINT IF EXISTS games_meeting_offset_range;
ALTER TABLE games
  ADD CONSTRAINT games_meeting_offset_range
  CHECK (meeting_offset_minutes IS NULL
         OR (meeting_offset_minutes >= 0 AND meeting_offset_minutes <= 1440));

COMMENT ON COLUMN games.meeting_offset_minutes IS
  'Besammlung: minutes BEFORE `time` that the team meets. NULL = no meeting time shown. Stored as an offset, not a clock, so it follows a Swiss Volley reschedule (sv-sync rewrites `time`) without going stale. DEFAULT 60 is what gives sync-created fixtures a meeting time with no code in sv-sync.';

-- ── trainings: 10 minutes before start ──────────────────────────────────────
ALTER TABLE trainings
  ADD COLUMN IF NOT EXISTS meeting_offset_minutes integer DEFAULT 10;

ALTER TABLE trainings DROP CONSTRAINT IF EXISTS trainings_meeting_offset_range;
ALTER TABLE trainings
  ADD CONSTRAINT trainings_meeting_offset_range
  CHECK (meeting_offset_minutes IS NULL
         OR (meeting_offset_minutes >= 0 AND meeting_offset_minutes <= 1440));

COMMENT ON COLUMN trainings.meeting_offset_minutes IS
  'Besammlung: minutes BEFORE `start_time` that the team meets. NULL = no meeting time shown. An offset, not a clock, so slot-cascade regeneration and the game-shorten hook can move a training without stranding it. DEFAULT 10 is what gives cascade-generated trainings a meeting time with no code in slot-cascade.js.';

-- ── events: an absolute clock, because an all-day event has no start ────────
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS meeting_time time without time zone;

COMMENT ON COLUMN events.meeting_time IS
  'Besammlung: the wall-clock time the group meets on the event''s start date. NULL (the default) = none, which is right for most events. Absolute rather than an offset because `all_day` events — tournaments, the case this was built for — have no start clock to count back from, and because no sync rewrites events.start_date.';

-- ── Backfill: every existing row, past included (see the header) ────────────
UPDATE games     SET meeting_offset_minutes = 60 WHERE meeting_offset_minutes IS NULL;
UPDATE trainings SET meeting_offset_minutes = 10 WHERE meeting_offset_minutes IS NULL;
-- events: deliberately NOT backfilled — no event gets an invented meeting time.

-- ── Register the fields so the items API + Data Explorer can read them ──────
-- ⚠ NULL in a VALUES list types as text and `options` is json — cast it.
INSERT INTO directus_fields (collection, field, special, interface, options, readonly, hidden, sort, width, note)
SELECT 'games', 'meeting_offset_minutes', NULL, 'input', NULL::json, false, false, 60, 'half',
       'Besammlung: minutes before kickoff that the team meets. Empty = no meeting time. An offset, so it survives a reschedule.'
WHERE NOT EXISTS (
  SELECT 1 FROM directus_fields WHERE collection = 'games' AND field = 'meeting_offset_minutes'
);

INSERT INTO directus_fields (collection, field, special, interface, options, readonly, hidden, sort, width, note)
SELECT 'trainings', 'meeting_offset_minutes', NULL, 'input', NULL::json, false, false, 60, 'half',
       'Besammlung: minutes before the start that the team meets. Empty = no meeting time. An offset, so it survives a regeneration.'
WHERE NOT EXISTS (
  SELECT 1 FROM directus_fields WHERE collection = 'trainings' AND field = 'meeting_offset_minutes'
);

INSERT INTO directus_fields (collection, field, special, interface, options, readonly, hidden, sort, width, note)
SELECT 'events', 'meeting_time', NULL, 'datetime', NULL::json, false, false, 60, 'half',
       'Besammlung: the clock time the group meets on the start date. Empty = none. Absolute, because an all-day event has no start time to count back from.'
WHERE NOT EXISTS (
  SELECT 1 FROM directus_fields WHERE collection = 'events' AND field = 'meeting_time'
);

COMMIT;

-- Verification (dev/prod):
--   SELECT count(*) FILTER (WHERE meeting_offset_minutes = 60) AS defaulted,
--          count(*) FILTER (WHERE meeting_offset_minutes IS NULL) AS cleared
--     FROM games;                       -- → every row defaulted, none cleared
--   SELECT count(*) FILTER (WHERE meeting_offset_minutes = 10) FROM trainings;
--   SELECT count(*) FROM events WHERE meeting_time IS NOT NULL;   -- → 0
--   -- The DEFAULT is what sync-created rows rely on — prove it applies:
--   BEGIN;
--     INSERT INTO games (game_id, date, "time") VALUES ('probe', CURRENT_DATE, '16:00');
--     SELECT meeting_offset_minutes FROM games WHERE game_id = 'probe';   -- → 60
--   ROLLBACK;
--   -- The CHECK actually rejects nonsense:
--   BEGIN;
--     UPDATE games SET meeting_offset_minutes = -30 WHERE id = (SELECT min(id) FROM games);
--   ROLLBACK;                          -- → violates games_meeting_offset_range
--   -- After applying, restart the container or the fields read back as aliases.
