-- Migration 246 — participations integrity: purge orphans, dedupe, and give
-- the RSVP its missing identity
--
-- Context (DB review 2026-07-27, findings ri-01/EVT-03, jix-02/EVT-02, jix-06,
-- EVT-06). participations links to its activity polymorphically
-- (activity_type + activity_id varchar) — not FK-able — and nothing has ever
-- compensated for that:
--   • No cleanup on activity deletion: migration 017 scoped its delete trigger
--     to activity-chat conversations on events only; the kscw-hooks
--     participations DELETEs only unwind absence auto-declines and date-moves.
--     Trainings ARE hard-deleted (slot-cascade regeneration — the 162
--     tombstones exist precisely because deletions happen), so RSVPs pile up
--     pointing at nothing. Live orphans on prod 2026-07-27: 244 training,
--     3 game, 4 event (newest 2026-05-11 — the leak was active this season).
--   • No unique constraint: migration 062's dedupe was one-time and its own
--     header admits there is no backstop. Duplicates recurred: 11 duplicate
--     (activity_type, activity_id, member, session) groups live — 9 training
--     pairs from raced raw-knex hook inserts (NOT EXISTS guards are not
--     atomic) and 2 game pairs from items-API double-submits 0.4s apart.
--     Duplicate confirmed rows double-count in every RSVP tally, including
--     the min-participants auto-cancel gate.
--   • No per-activity index: every roster/NOT EXISTS probe walked the member
--     index or the heap (pg_stat: 3,794 seq scans / 17.2M tuples read).
--
-- Fix:
--   1. One-time purge of the 251 orphans (participations + the matching
--      polymorphic notifications rows)
--   2. Generalized 062-style dedupe (newest intent wins — highest id)
--   3. Partial unique indexes that are BOTH the duplicate backstop and the
--      per-activity lookup index. The DEFINITIONS are load-bearing (not the
--      names): kscw-hooks / game-auto-confirm-sweep use TARGETLESS
--      `ON CONFLICT DO NOTHING`, which arbitrates on whichever of these two
--      indexes the row violates — change the column sets or WHERE predicates
--      only together with those writers.
--   4. CHECK constraints on activity_type and status (vocabulary verified
--      against live data AND every writer: confirmed / declined / tentative /
--      waitlisted — src/types/index.ts:670, kscw-hooks inserts)
--   5. AFTER DELETE triggers on trainings/games/events purging the
--      polymorphic participations + notifications rows so the orphan class
--      can never re-accumulate
--
-- Schema + data repair; idempotent (safe to re-run).

BEGIN;

-- ── (1) Purge orphaned RSVPs + their notifications ───────────────────────
DELETE FROM participations p
WHERE p.activity_type = 'training' AND p.activity_id ~ '^[0-9]+$'
  AND NOT EXISTS (SELECT 1 FROM trainings t WHERE t.id = p.activity_id::int);
DELETE FROM participations p
WHERE p.activity_type = 'game' AND p.activity_id ~ '^[0-9]+$'
  AND NOT EXISTS (SELECT 1 FROM games g WHERE g.id = p.activity_id::int);
DELETE FROM participations p
WHERE p.activity_type = 'event' AND p.activity_id ~ '^[0-9]+$'
  AND NOT EXISTS (SELECT 1 FROM events e WHERE e.id = p.activity_id::int);

-- Deletion notices (title *_deleted) legitimately reference a now-gone
-- activity — their body is self-contained by design. Keep them.
DELETE FROM notifications n
WHERE n.activity_type = 'training' AND n.activity_id ~ '^[0-9]+$'
  AND n.title NOT IN ('training_deleted', 'game_deleted', 'event_deleted')
  AND NOT EXISTS (SELECT 1 FROM trainings t WHERE t.id = n.activity_id::int);
DELETE FROM notifications n
WHERE n.activity_type = 'game' AND n.activity_id ~ '^[0-9]+$'
  AND n.title NOT IN ('training_deleted', 'game_deleted', 'event_deleted')
  AND NOT EXISTS (SELECT 1 FROM games g WHERE g.id = n.activity_id::int);
DELETE FROM notifications n
WHERE n.activity_type = 'event' AND n.activity_id ~ '^[0-9]+$'
  AND n.title NOT IN ('training_deleted', 'game_deleted', 'event_deleted')
  AND NOT EXISTS (SELECT 1 FROM events e WHERE e.id = n.activity_id::int);

-- ── (2) Generalized dedupe — newest intent wins (062 semantics) ──────────
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY activity_type, activity_id, member, COALESCE(session_id, '')
           ORDER BY id DESC
         ) AS rn
  FROM participations
)
DELETE FROM participations p
USING ranked r
WHERE p.id = r.id AND r.rn > 1;

-- ── (2b) Legacy per-day phantoms ─────────────────────────────────────────
-- Machine-written WHOLE-EVENT declines on per_day/per_session events (the
-- absence hooks now write per-session rows only; these NULL-session rows
-- are invisible to the per-session UI yet inflate every RSVP tally).
-- Scoped to auto-declines (auto_declined_by set) — a member's own RSVP is
-- never touched.
DELETE FROM participations p
USING events e
WHERE p.activity_type = 'event' AND p.activity_id ~ '^[0-9]+$'
  AND e.id = p.activity_id::int
  AND e.participation_mode IN ('per_day', 'per_session')
  AND p.session_id IS NULL
  AND p.status = 'declined'
  AND p.auto_declined_by IS NOT NULL;

-- ── (3) RSVP identity: partial unique = dedupe backstop + activity index ──
-- Names are referenced by ON CONFLICT targets in kscw-hooks and
-- game-auto-confirm-sweep — do not rename.
CREATE UNIQUE INDEX IF NOT EXISTS participations_activity_member_uq
  ON participations (activity_type, activity_id, member)
  WHERE session_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS participations_activity_member_session_uq
  ON participations (activity_type, activity_id, member, session_id)
  WHERE session_id IS NOT NULL;

-- ── (4) Enum discipline ──────────────────────────────────────────────────
-- Live values 2026-07-27: activity_type training|game|event; status
-- confirmed|declined|tentative (+ 'waitlisted' written by the event-waitlist
-- paths and reverted by the absence hooks — in the TS union and hook SQL).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'participations_activity_type_chk' AND conrelid = 'participations'::regclass
  ) THEN
    ALTER TABLE participations
      ADD CONSTRAINT participations_activity_type_chk
      CHECK (activity_type IN ('training', 'game', 'event'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'participations_status_chk' AND conrelid = 'participations'::regclass
  ) THEN
    ALTER TABLE participations
      ADD CONSTRAINT participations_status_chk
      CHECK (status IN ('confirmed', 'declined', 'tentative', 'waitlisted'));
  END IF;
END $$;

-- ── (5) Never again: purge polymorphic rows when the activity dies ───────
-- One function, parameterized by activity_type (TG_ARGV), mirroring the
-- fn_activity_chat_event_delete pattern from 017. Fires on the hard deletes
-- the app really performs (slot-cascade regeneration, admin deletes).
-- Deletion notices are excluded from the notification purge (their body is
-- self-contained by design), and the trigger NAMES are load-bearing:
-- Postgres fires same-event triggers in alphabetical order, and these must
-- run BEFORE trg_{games,trainings,events}_notify ('0' < 'n') — purge the
-- stale rows first, then the notify trigger writes the deletion notice,
-- which survives.
CREATE OR REPLACE FUNCTION trg_activity_purge_polymorphic()
RETURNS trigger AS $$
BEGIN
  DELETE FROM participations WHERE activity_type = TG_ARGV[0] AND activity_id = OLD.id::text;
  DELETE FROM notifications
   WHERE activity_type = TG_ARGV[0] AND activity_id = OLD.id::text
     AND title NOT IN ('training_deleted', 'game_deleted', 'event_deleted');
  RETURN OLD;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS trg_trainings_0_purge_polymorphic ON trainings;
CREATE TRIGGER trg_trainings_0_purge_polymorphic
  AFTER DELETE ON trainings
  FOR EACH ROW EXECUTE FUNCTION trg_activity_purge_polymorphic('training');

DROP TRIGGER IF EXISTS trg_games_0_purge_polymorphic ON games;
CREATE TRIGGER trg_games_0_purge_polymorphic
  AFTER DELETE ON games
  FOR EACH ROW EXECUTE FUNCTION trg_activity_purge_polymorphic('game');

DROP TRIGGER IF EXISTS trg_events_0_purge_polymorphic ON events;
CREATE TRIGGER trg_events_0_purge_polymorphic
  AFTER DELETE ON events
  FOR EACH ROW EXECUTE FUNCTION trg_activity_purge_polymorphic('event');

COMMIT;
