-- Migration 155: on-demand "Sync now" trigger for the ClubDesk finance import.
-- The Directus container can't launch the headless-browser scrape (it lives in a
-- Docker container on the host), so the button just sets a request flag here; a
-- host dispatcher (cron, every minute) claims it, runs clubdesk-finance-sync.sh, and
-- writes back the state. The button polls sync_state.
--
-- Schema-only + idempotent.

BEGIN;

ALTER TABLE finance_ledger_settings
  ADD COLUMN IF NOT EXISTS sync_requested_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS sync_state        varchar(16) NOT NULL DEFAULT 'idle',
  ADD COLUMN IF NOT EXISTS sync_message      text,
  ADD COLUMN IF NOT EXISTS sync_finished_at  timestamp with time zone;

COMMIT;
