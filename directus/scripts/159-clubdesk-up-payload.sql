-- Migration 159: carry the sync-up push payload + result on the singleton
-- clubdesk_member_sync row.
--
-- The superadmin modal builds the approved push set (changed members + the
-- unlinked ones the superadmin chose to create), and the commit endpoint stashes
-- the generated CSV + the member-id set here. The host up-dispatcher reads up_csv,
-- runs the import scraper, then clears clubdesk_push_pending for up_member_ids and
-- writes the ClubDesk result (neu/veraendert/committed) back into up_result for the
-- modal to display. Schema-only + idempotent.

BEGIN;

ALTER TABLE clubdesk_member_sync
  ADD COLUMN IF NOT EXISTS up_csv        text,
  ADD COLUMN IF NOT EXISTS up_member_ids jsonb,
  ADD COLUMN IF NOT EXISTS up_result     jsonb;

COMMIT;
