-- Migration 253 — drop the ad-hoc members_sektion_backup_20260715 snapshot
--
-- Context (DB review 2026-07-27, findings NAME-02 / deadweight-02). A one-off
-- 707-row revert snapshot of (member id, sektion) taken by hand around
-- 2026-07-15 during the sektion re-derivation work (no numbered migration
-- created it — it exists only on the live DBs and, via db:baseline, leaked
-- into the SCHEMA.sql fresh-install baseline). Twelve days on, the sektion
-- values have long been re-verified against ClubDesk; nothing reads the
-- table (zero code references), it was never registered in Directus, and a
-- dated snapshot inside the operational schema is what pre-deploy DB
-- snapshots (db:snapshot) are for.
--
-- SCHEMA.sql is regenerated from prod at the next `npm run db:baseline:prod`,
-- which removes the table from the baseline too.
--
-- Idempotent.

BEGIN;

DROP TABLE IF EXISTS members_sektion_backup_20260715;

-- Never registered in Directus — guarded metadata cleanup for safety only.
DELETE FROM directus_fields      WHERE collection = 'members_sektion_backup_20260715';
DELETE FROM directus_collections WHERE collection = 'members_sektion_backup_20260715';

COMMIT;
