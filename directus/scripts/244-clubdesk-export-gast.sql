-- Migration 244: stage ClubDesk's new "Gast" Ja/Nein column.
--
-- ClubDesk gained a custom "Gast" checkbox on 2026-07-27 and wiedisync filled it
-- for all 707 linked contacts (27 Ja / 680 Nein — see docs/DEVLOG.md). That was a
-- one-off CSV import, i.e. a snapshot: guest status is per-season, so without a
-- way to READ the register's copy back there is nothing to compare the live
-- roster against and the column silently rots at the next roster turnover.
--
-- This adds the staging column the down-sync writes (import-clubdesk-csv.mjs
-- HEADER_TO_COL + TARGET_COLS) so computeClubdeskDrift can diff ClubDesk's cell
-- against `member_teams` and re-flag members whose guest status changed. The
-- 064 CREATE TABLE IF NOT EXISTS is a no-op on existing DBs, so a new staging
-- column needs its own ALTER — same gap js_id (195) and wiedisync_id hit.
--
-- ⚠ Direction is ONE-WAY: wiedisync owns guest status outright (it is derived
-- from member_teams.guest_level, a column ClubDesk has no source for), so there
-- is deliberately NO write-back pass into `members`. This staging column exists
-- only to answer "what does the register currently say", never to overwrite the
-- roster with it.
--
-- Schema-only + idempotent (repo policy #2). No permission rows — clubdesk_export
-- is a raw staging table, not a Directus collection (no directus_fields entry, no
-- items-API exposure), so setup-permissions.mjs is untouched.

BEGIN;

ALTER TABLE clubdesk_export ADD COLUMN IF NOT EXISTS gast text;

COMMENT ON COLUMN clubdesk_export.gast IS
  'ClubDesk "Gast" checkbox (Ja/Nein) as exported. Written ONLY by wiedisync''s sync-up push; staged here so computeClubdeskDrift can compare it against the current-season roster. Never flows back into members — member_teams.guest_level is the source of truth.';

-- Verification (prints after apply): how much of the register the last sync-down
-- has staged. Expect all-NULL until the next "Sync down" runs with the mapping.
SELECT 'clubdesk_export_gast_ja'   AS metric, count(*)::text AS value FROM clubdesk_export WHERE btrim(gast) = 'Ja'
UNION ALL
SELECT 'clubdesk_export_gast_nein', count(*)::text FROM clubdesk_export WHERE btrim(gast) = 'Nein'
UNION ALL
SELECT 'clubdesk_export_gast_empty', count(*)::text FROM clubdesk_export WHERE NULLIF(btrim(gast), '') IS NULL;

COMMIT;
