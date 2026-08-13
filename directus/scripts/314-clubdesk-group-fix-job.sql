-- Migration 314: on-demand "Fix groups" job columns on clubdesk_member_sync.
--
-- ClubDesk group membership is MANUAL-ONLY — the CSV import treats `Gruppen` as a
-- no-op — so the only way to write an allocation is to drive the real UI. Two
-- proven Playwright tools already do exactly that:
--
--   clubdesk-scrape-groups.mjs  — ADD    ("Kontakt zu Gruppe hinzufügen")
--   clubdesk-remove-group.mjs   — REMOVE (detail-view chip ×, verify-before-save)
--
-- Until now neither was reachable from the app: Directus runs in a container and
-- cannot launch a browser scrape, and the remove half only ran unattended via the
-- Sunday clubdesk-group-cleanup.sh cron. These columns add the SAME request-flag +
-- host-dispatcher handshake the sync-down/sync-up buttons already use
-- (clubdesk-member-dispatch.sh / clubdesk-member-up-dispatch.sh), so a superadmin
-- can queue a run from /admin/data-health and watch it settle.
--
-- WHY THE WORKLIST IS A COLUMN AND NOT A REQUEST BODY. The worklist is built
-- SERVER-SIDE from the very SQL that produced the on-screen findings, then stashed
-- here for the dispatcher to pick up. It is never accepted from the client. A
-- client-supplied worklist would turn "superadmin's browser" into an arbitrary
-- write channel into the club's LEGAL member register — the operator gets to choose
-- which findings to act on, never what a row means.
--
-- WHY preview AND commit ARE TWO SEPARATE JOBS. `grp_mode` is stamped per run.
-- Preview drives every UI step up to the dialog and then cancels (no write);
-- commit clicks OK / Speichern. The UI requires a successful preview before it
-- will offer commit, and `grp_result` carries the per-row outcome that the
-- operator approves. This mirrors the sync-up's dry-run-then-commit gate, and it
-- is the guard the 2026-07-16 incident earned: a departure test keyed on the wrong
-- column stripped 29 DU20 girls out of ClubDesk, and the 06.07 clubdesk_export
-- backup was the only surviving copy.
--
-- ⚠ There is NO dev ClubDesk instance (one shared account), so the dispatcher
--   forces preview on any env that is not prod — dev can exercise the whole
--   handshake but can never write.
--
-- Schema-only + idempotent.

BEGIN;

ALTER TABLE clubdesk_member_sync
  ADD COLUMN IF NOT EXISTS grp_requested_at   timestamptz,
  ADD COLUMN IF NOT EXISTS grp_state          varchar(16) DEFAULT 'idle',
  ADD COLUMN IF NOT EXISTS grp_message        text,
  ADD COLUMN IF NOT EXISTS grp_finished_at    timestamptz,
  ADD COLUMN IF NOT EXISTS grp_mode           varchar(8),
  -- jsonb, like up_result / up_member_ids on this same row — knex writes them all
  -- as JSON.stringify(...) and the dispatcher reads them with the jsonb operators.
  ADD COLUMN IF NOT EXISTS grp_worklist       jsonb,
  ADD COLUMN IF NOT EXISTS grp_result         jsonb,
  ADD COLUMN IF NOT EXISTS grp_requested_by_name  varchar(255),
  ADD COLUMN IF NOT EXISTS grp_requested_by_email varchar(255);

-- The state machine the dispatcher claims on. Same vocabulary as down_state /
-- up_state so the three jobs can be reasoned about (and blocked against) as one.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'clubdesk_member_sync_grp_state_check'
  ) THEN
    ALTER TABLE clubdesk_member_sync
      ADD CONSTRAINT clubdesk_member_sync_grp_state_check
      CHECK (grp_state IN ('idle', 'queued', 'running', 'done', 'failed'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'clubdesk_member_sync_grp_mode_check'
  ) THEN
    ALTER TABLE clubdesk_member_sync
      ADD CONSTRAINT clubdesk_member_sync_grp_mode_check
      CHECK (grp_mode IS NULL OR grp_mode IN ('preview', 'commit'));
  END IF;
END $$;

UPDATE clubdesk_member_sync SET grp_state = 'idle' WHERE id = 1 AND grp_state IS NULL;

COMMENT ON COLUMN clubdesk_member_sync.grp_state IS
  'Group-fix job state (idle/queued/running/done/failed). Claimed by clubdesk-group-fix-dispatch.sh, polled by /admin/data-health.';
COMMENT ON COLUMN clubdesk_member_sync.grp_mode IS
  'preview = drive every UI step then cancel (no write); commit = write the allocation to the legal register. The UI only offers commit after a successful preview.';
COMMENT ON COLUMN clubdesk_member_sync.grp_worklist IS
  'SERVER-BUILT worklist {add:[{name,uuid,group,funktion,clubdesk_id}],remove:[{name,uuid,group_label}]}. Never accepted from the client — it would be an arbitrary write channel into the legal member register.';
COMMENT ON COLUMN clubdesk_member_sync.grp_result IS
  'Per-row outcome from the scrapers ({add:{tally,results},remove:{…}}). This is what the operator approves before a commit.';
COMMENT ON COLUMN clubdesk_member_sync.grp_requested_by_name IS
  'Actor who queued the run — raw-knex writes bypass the Directus revision trail, so the actor is captured explicitly (see CLAUDE.md → Audit logging).';

COMMIT;
