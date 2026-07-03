-- Migration 170: one ClubDesk contact per member (reverse-uniqueness backstop).
-- (Renumbered from 168 to leave 167/168 for a parallel signup-tokens WIP.)
--
-- Deep audit 2026-07-03 (finding #19). Migration 158's clubdesk_id backfill only
-- guarded one-member→one-contact (HAVING count(DISTINCT cd.clubdesk_id)=1); the
-- ongoing linker later added the reverse guard (one-contact→one-member) but no DB
-- constraint enforces it, so a future linker/backfill bug could assign one
-- clubdesk_id to two members — corrupting departed-detection + sync-up.
--
-- Verified on prod + dev before this migration: 0 duplicate clubdesk_id, so the
-- partial UNIQUE index builds cleanly. If a duplicate is ever present the index
-- creation fails loudly (the correct signal to de-dup first). Idempotent.

BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS members_clubdesk_id_uq
  ON members (clubdesk_id)
  WHERE clubdesk_id IS NOT NULL;

COMMIT;
