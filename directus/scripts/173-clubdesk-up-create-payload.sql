-- Migration 173: split the sync-up push payload into UPDATE and CREATE sets.
--
-- New ClubDesk contacts (create pushes) additionally carry Beitragskategorie
-- (from the signup form via members.beitragskategorie) and Eintritt — an
-- existing contact must never receive those columns, because ClubDesk stays
-- authoritative for category on existing members and its empty-cell import
-- behavior is unvalidated (a blank cell could wipe the category in the legal
-- register). So the commit endpoint stashes two CSVs: up_csv (update set,
-- contact fields only — unchanged) and up_csv_create (create set, contact
-- fields + Beitragskategorie + Eintritt). up_member_ids_create mirrors the
-- create subset of up_member_ids so the host dispatcher can stamp
-- clubdesk_pushed_at on the creates immediately after the create-set commit
-- (duplicate protection) even if the update-set commit then fails.
-- Schema-only + idempotent.

BEGIN;

ALTER TABLE clubdesk_member_sync
  ADD COLUMN IF NOT EXISTS up_csv_create        text,
  ADD COLUMN IF NOT EXISTS up_member_ids_create jsonb;

COMMIT;
