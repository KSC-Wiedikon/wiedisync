-- Migration 368: queue for the ClubDesk auto-sync-on-confirmation feature
--
-- Confirming a registration now fires autoSyncRegistrationToClubdesk()
-- (kscw-hooks, on the registrations approval action) automatically — a
-- single-member push (up) → link-back, so a new member doesn't wait for the
-- next manual "Sync now". But the three ClubDesk jobs (down/up/group) share
-- ONE global lock (clubdesk_member_sync is a singleton row, id=1): if another
-- job is running when a registration is confirmed, the push cannot fire
-- immediately. The user's own instruction here was explicit: "queue, don't
-- drop" — so a busy 409 from enqueueClubdeskUp() lands a row here instead of
-- being lost, and a short cron (drainClubdeskAutoSyncQueue, kscw-hooks)
-- retries once the lock frees.
--
-- One row per queued member; the partial unique index makes re-enqueueing the
-- SAME member idempotent (a registration approved twice, or the drainer
-- racing the trigger, can never double-queue).
--
-- Deliberately NOT a general job queue — it only ever holds "push this member
-- up", which is why there is no `kind` column. If a second kind of auto-sync
-- job is ever needed, that is a new table, not a wider one: reusing this one
-- would make every future reader guess what `member_id` means for a row that
-- was never about a member.
--
-- Schema-only + idempotent.

BEGIN;

CREATE TABLE IF NOT EXISTS clubdesk_auto_sync_queue (
  id             serial PRIMARY KEY,
  member_id      integer NOT NULL REFERENCES members(id),
  registration_id integer REFERENCES registrations(id),
  status         varchar(16) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'dispatched', 'done', 'failed')),
  requested_at   timestamptz NOT NULL DEFAULT now(),
  dispatched_at  timestamptz,
  finished_at    timestamptz,
  last_error     text,
  attempts       smallint NOT NULL DEFAULT 0
);

-- Idempotent re-enqueue: at most one PENDING row per member. A member can
-- accumulate history across dispatched/failed rows (informational), but never
-- two jobs racing to push the same member.
CREATE UNIQUE INDEX IF NOT EXISTS clubdesk_auto_sync_queue_member_pending
  ON clubdesk_auto_sync_queue (member_id) WHERE status = 'pending';

COMMENT ON TABLE clubdesk_auto_sync_queue IS
  'Queued single-member ClubDesk up-pushes from registration auto-sync, deferred because the global clubdesk_member_sync lock was busy. Drained by drainClubdeskAutoSyncQueue on a short cron. See kscw-endpoints/src/clubdesk-update.js.';
COMMENT ON COLUMN clubdesk_auto_sync_queue.status IS
  'pending = waiting for the lock; dispatched = handed to enqueueClubdeskUp, the real push now lives in clubdesk_member_sync; failed = a terminal (non-busy) refusal or the lock stayed held past the attempt cap.';

COMMIT;

-- Verification (dev/prod):
--   \d clubdesk_auto_sync_queue
--   INSERT INTO clubdesk_auto_sync_queue (member_id, status) VALUES (<test>, 'pending');
--   INSERT INTO clubdesk_auto_sync_queue (member_id, status) VALUES (<test>, 'pending'); -- ON CONFLICT DO NOTHING path, still 1 row
--   SELECT count(*) FROM clubdesk_auto_sync_queue WHERE member_id = <test> AND status = 'pending'; -- 1
