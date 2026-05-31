-- Migration 074: private folder for feedback screenshots.
--
-- Security audit 2026-05-31 (Low): anon could fetch ANY uploaded file via
-- GET /assets/:id — including feedback screenshots, which can contain a member's
-- authenticated screen / PII (verified: anon /assets/<feedback file> returned
-- 200 on prod). The public `directus_files` read is now scoped to FOLDER-LESS
-- files (setup-permissions.mjs); the public site's team/member/sponsor/news
-- images live at the root, so they keep serving, while a folder assignment ===
-- private. This migration creates a fixed-id private folder and relocates any
-- EXISTING feedback screenshots into it; the kscw-hooks feedback hook keeps
-- FUTURE uploads in this folder.
--
-- The fixed UUID matches FEEDBACK_FILES_FOLDER in kscw-hooks so relocation is
-- consistent on every environment (dev + prod + fresh installs).
--
-- Schema/data-only + idempotent. Safe to re-run (ON CONFLICT + the UPDATE only
-- matches still-folder-less screenshots).

BEGIN;

INSERT INTO directus_folders (id, name)
VALUES ('feedbac0-0000-4000-8000-000000000001', 'Feedback screenshots (private)')
ON CONFLICT (id) DO NOTHING;

UPDATE directus_files
   SET folder = 'feedbac0-0000-4000-8000-000000000001'
 WHERE folder IS NULL
   AND id IN (SELECT screenshot FROM feedback WHERE screenshot IS NOT NULL);

COMMIT;

-- =============================================================================
-- Verification (read-only):
-- =============================================================================
-- SELECT count(*) FROM directus_files WHERE folder = 'feedbac0-0000-4000-8000-000000000001';
-- (expect = number of feedback rows with a screenshot)
-- Then: anon GET /assets/<that file id> should return 403; anon GET
-- /assets/<a folder-less team_picture> should still return 200.
