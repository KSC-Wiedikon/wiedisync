-- Migration 275: stage ClubDesk's new "Trainer Lizenz" free-text column.
--
-- Companion to migration 274 (members.trainer_licences). ClubDesk gained a
-- custom "Trainer Lizenz" field on 2026-08-03 — created first as an Auswahl
-- picklist (J+S¦A¦B¦C) and switched to **Text** before anything was written to
-- it, precisely so the concatenated multi-value form fits: wiedisync stores a
-- SET ("JS,B") and a single-select cell would have forced a lossy collapse.
--
-- This adds the staging column the down-sync writes (import-clubdesk-csv.mjs
-- HEADER_TO_COL + TARGET_COLS). The 064 CREATE TABLE IF NOT EXISTS is a no-op
-- on existing DBs, so a new staging column needs its own ALTER — same gap
-- js_id (195), wiedisync_id and gast (244) hit.
--
-- ⚠ Direction is TWO-WAY here, unlike `gast` (244):
--   • DOWN — fill-only into members.trainer_licences, parsing ClubDesk's human
--     wording ("J+S, B") back into codes ("JS,B"). Fill-only because the member
--     declares this about themselves in their profile; the register may only
--     answer for someone who never has. Same rule as ahv_nummer / anrede.
--   • UP  — wiedisync's set is rendered back to "J+S, B" by trainerLicenceCell
--     and echo-protected (an unanswered member sends ClubDesk's own cell back,
--     never an empty one), exactly like Federation of Origin.
-- Neither side can blank the other.
--
-- Schema-only + idempotent (repo policy #2). No permission rows — clubdesk_export
-- is a raw staging table, not a Directus collection (no directus_fields entry, no
-- items-API exposure), so setup-permissions.mjs is untouched.

BEGIN;

ALTER TABLE clubdesk_export ADD COLUMN IF NOT EXISTS trainer_lizenz text;

COMMENT ON COLUMN clubdesk_export.trainer_lizenz IS
  'ClubDesk "Trainer Lizenz" free-text cell as exported — the coaching qualification in ClubDesk''s own wording, comma-separated ("J+S, B"). Parsed back into members.trainer_licences codes (JS/C/B/A) fill-only by the down-sync, and re-rendered on the way up by trainerLicenceCell. Free text rather than a picklist on purpose: a member can hold J+S AND a ladder rung.';

-- Verification (prints after apply). Expect all-empty until the next "Sync down"
-- runs with the mapping — the ClubDesk column itself was created empty.
SELECT 'clubdesk_export_trainer_lizenz_set' AS metric, count(*)::text AS value
  FROM clubdesk_export WHERE NULLIF(btrim(trainer_lizenz), '') IS NOT NULL
UNION ALL
SELECT 'clubdesk_export_trainer_lizenz_empty', count(*)::text
  FROM clubdesk_export WHERE NULLIF(btrim(trainer_lizenz), '') IS NULL;

COMMIT;
