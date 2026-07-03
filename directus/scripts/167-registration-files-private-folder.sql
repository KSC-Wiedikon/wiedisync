-- Migration 167: private folder for registration ID / licence documents.
--
-- Deep audit 2026-07-03 (finding #3, HIGH privacy). The public registration form
-- uploads government-ID scans + basketball licence/declaration docs
-- (id_upload_front/back, bb_doc_lizenz/selfdecl/natdecl) via the anon POST /files
-- grant, which lands them FOLDER-NULL. The public directus_files read is scoped to
-- folder-null files (setup-permissions.mjs), so /assets/:id serves these ID scans
-- to ANY anonymous caller. Mirror the feedback-screenshot fix (migration 074):
-- a fixed-id private folder + relocate existing files; the kscw-hooks
-- registrations hook keeps FUTURE uploads in it. Foldered files stop matching the
-- folder-null public read, so /assets 403s them for anon.
--
-- Verified on prod before this migration: 12 such files, all folder-null.
-- Additive + idempotent. No permission change needed (folder-null exclusion is
-- already the public read scope).

BEGIN;

INSERT INTO directus_folders (id, name)
VALUES ('a0000167-0000-4000-8000-000000000001', 'Registration documents (private)')
ON CONFLICT (id) DO NOTHING;

UPDATE directus_files
   SET folder = 'a0000167-0000-4000-8000-000000000001'
 WHERE folder IS NULL
   AND id IN (
     SELECT id_upload_front FROM registrations WHERE id_upload_front IS NOT NULL
     UNION SELECT id_upload_back  FROM registrations WHERE id_upload_back  IS NOT NULL
     UNION SELECT bb_doc_lizenz   FROM registrations WHERE bb_doc_lizenz   IS NOT NULL
     UNION SELECT bb_doc_selfdecl FROM registrations WHERE bb_doc_selfdecl IS NOT NULL
     UNION SELECT bb_doc_natdecl  FROM registrations WHERE bb_doc_natdecl  IS NOT NULL
   );

COMMIT;
