-- Migration 339: remember when value conflicts were last staged.
--
-- Migration 338 moved value disagreements into clubdesk_sync_proposals as
-- `conflict` rows, staged by kscw-endpoints off computeClubdeskDrift() because
-- that JS comparison is the only correct one. The UI calls the staging route
-- after every sync-down it triggers — but the WEEKLY cron (Sat 22:00 UTC) has no
-- browser, so its conflicts sat undetected until a human happened to run a sync
-- down through the page. Silent, and in the worse direction: an empty decision
-- queue reads as "nothing to decide".
--
-- This column is the watermark that lets a scheduled hook notice. The hook
-- compares it against `down_last_success_at` (migration 336) and stages only
-- when a sync-down has SUCCEEDED since the last staging — so it covers the
-- weekly cron, a hand-run host sync, and a dispatcher retry alike, without
-- assuming anything about when any of them happen.
--
-- ⚠ Stamped on every staging run, including one that stages ZERO rows. It
-- records "drift has been examined for this sync", not "rows were written" —
-- a run that legitimately finds nothing must still close the window, or the
-- hook re-examines the same sync every tick forever.
--
-- ⚠ Deliberately no directus_fields registration, for the same reason
-- clubdesk_sync_proposals has none: this table is read and written only by
-- kscw-endpoints and kscw-hooks over raw knex, never through the items API.
--
-- Schema-only + idempotent (CLAUDE.md rule 2).

ALTER TABLE clubdesk_member_sync
  ADD COLUMN IF NOT EXISTS conflicts_staged_at timestamptz;
