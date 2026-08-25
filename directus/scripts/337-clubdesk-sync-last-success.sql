-- Migration 336: remember when the ClubDesk sync last SUCCEEDED, separately from
-- when it last finished.
--
-- `clubdesk_member_sync.down_finished_at` is stamped by the dispatcher on BOTH
-- outcomes — the success branch and the failure branch write `now()`. Two
-- surfaces then read it as if it meant "last successful sync":
--
--   ClubdeskMemberSyncButton  → "Last sync down: 25.08.2026 12:24"
--   /clubdesk-needs-sync      → the same string on the "Needs syncing" panel
--
-- So a FAILED run repaints a fresh timestamp under the button, which is
-- indistinguishable from success. ⚠⚠ This is not theoretical: on 2026-08-25
-- ClubDesk's app host went dark, three prod sync-downs failed in a row, and the
-- outcome was reported as "i tried and it worked, slow but did" — while the
-- snapshot was still five days stale and 0 proposals had been detected. A stale
-- register that believes it is fresh is the worst state this table can be in:
-- every downstream check (broken links, drift, group allocation) silently
-- reasons about old data.
--
-- Nulling `last_down` on failure was the cheap fix and is wrong in the other
-- direction: it would render "—" ("never synced") for a club that has synced
-- weekly for two years. The truthful value has to be STORED, because the failure
-- overwrites the only field that held it.
--
-- ⚠ Backfilled from the current `down_finished_at` ONLY when the last run
-- actually succeeded. If the most recent run failed — which is the state prod is
-- in right now — the column stays NULL rather than inheriting a failure's clock,
-- and the first successful sync fills it. A guessed success time is worse than
-- an empty one here, because the whole defect being fixed is a timestamp that
-- lies about what it means.
--
-- The dispatcher writes it in its success branch only (clubdesk-member-dispatch.sh,
-- deployed via `npm run clubdesk:deploy` — ⚠ NOT `scripts:deploy`, which does not
-- reach /opt/clubdesk-sync/).
--
-- Schema-only + idempotent. No permission rows: the singleton is read and written
-- exclusively by kscw-endpoints over raw knex and the host dispatcher, and is not
-- registered in directus_fields (so no schema-cache restart is required either).

BEGIN;

ALTER TABLE clubdesk_member_sync
  ADD COLUMN IF NOT EXISTS down_last_success_at timestamptz;

COMMENT ON COLUMN clubdesk_member_sync.down_last_success_at IS
  'When the sync-down last COMPLETED SUCCESSFULLY. down_finished_at is stamped on failure too and must never be shown as "last sync".';

UPDATE clubdesk_member_sync
   SET down_last_success_at = down_finished_at
 WHERE id = 1
   AND down_last_success_at IS NULL
   AND down_state = 'done'
   AND down_finished_at IS NOT NULL;

COMMIT;

-- Verification (dev/prod):
--   SELECT down_state, down_finished_at, down_last_success_at FROM clubdesk_member_sync WHERE id=1;
--     -- prod expects: state 'failed', finished_at 25.08 (the failure), last_success NULL
--     -- after the next good run: last_success == finished_at
