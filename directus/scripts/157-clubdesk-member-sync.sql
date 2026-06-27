-- Migration 157: on-demand "Sync down / Sync up" trigger for the ClubDesk MEMBER sync.
-- Mirror of 155 (the finance sync). The Directus container can't launch the
-- headless-browser scrape (it runs in a Docker container on the host), so the
-- superadmin button just sets a request flag here; a host dispatcher (cron, every
-- minute) claims it, runs clubdesk-sync.sh (down) — and later the import push (up) —
-- then writes back the state. The button polls *_state.
--
-- Singleton table (id = 1). Both directions live on one row so the future sync-up
-- build reuses it without another migration. Read/written by raw knex in the
-- clubdesk-update endpoint, so no directus_fields registration is needed.
--
-- Schema-only + idempotent.

BEGIN;

CREATE TABLE IF NOT EXISTS clubdesk_member_sync (
  id                smallint PRIMARY KEY DEFAULT 1,
  -- ⬇ ClubDesk → Wiedisync (member export scrape + import)
  down_requested_at timestamp with time zone,
  down_state        varchar(16) NOT NULL DEFAULT 'idle',
  down_message      text,
  down_finished_at  timestamp with time zone,
  -- ⬆ Wiedisync → ClubDesk (contact import push) — wired in the sync-up phase
  up_requested_at   timestamp with time zone,
  up_state          varchar(16) NOT NULL DEFAULT 'idle',
  up_message        text,
  up_finished_at    timestamp with time zone,
  CONSTRAINT clubdesk_member_sync_singleton CHECK (id = 1)
);

INSERT INTO clubdesk_member_sync (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

COMMIT;
