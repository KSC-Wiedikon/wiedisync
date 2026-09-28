-- Migration 387: upload folders for the directus_files ALLOW-list + backfill.
--
-- 2026-09-28 deep audit F01 (Critical), F25, F45. Every folder-less file was
-- Public-readable (`folder IS NULL` was the Public read rule), and nothing that
-- uploads a PRIVATE file was forced to name a folder: all 8 expense receipts on
-- prod sat at the root and downloaded anonymously via /assets, together with
-- every form file answer. The read rule was a deny-list in disguise — "root is
-- public" — so each new upload path was public until somebody remembered it.
--
-- From this migration on the rule is an ALLOW-list (setup-permissions.mjs):
-- Public and Member read the PUBLIC IMAGES folder and nothing else by default.
-- The four folders, with fixed UUIDs so every environment and the app agree
-- (src/lib/privateFolders.ts, kscw-hooks, setup-permissions.mjs):
--
--   0e1a0387-…-0001  Expense receipts   private; read back only through the
--                                       owner/finance-checked receipt endpoint
--   0e1a0387-…-0002  Form uploads       private; form managers + the uploader
--   0e1a0387-…-0003  Public images      the ONLY Public-readable folder: team
--                                       photos, profile photos, sponsor logos,
--                                       news + announcement images
--   0e1a0387-…-0004  Upload quarantine  private; where every upload that names
--                                       no folder lands (migration 388), until
--                                       it is referenced as a public image
--
-- Backfill, in this order, and only for files still at the root:
--   1. files referenced by a public image column → Public images. FIRST, so a
--      form answer or receipt that names a team photo cannot pull it off the
--      website (the answer JSON is client-written).
--   2. expense receipts → Expense receipts.
--   3. file answers of `file`-type form fields → Form uploads.
-- Every other root file stays at the root and is no longer readable by Public or
-- by other members (on dev: 26 unreferenced files, incl. licence-application
-- PDFs). Nothing is deleted.
--
-- F45: the empty hand-made "registrations" folder (100012c8-…) was readable by
-- every member under the old deny-list. It is removed if it is still empty and
-- has no subfolders; the allow-list makes any such folder private anyway.
--
-- ⚠ Deploy with `db:deploy:*` (migrate → setup-perms in one chain). Step 1 moves
-- the public images out of the root, and the OLD Public rule reads the root only:
-- between this migration and `db:setup-perms` the website's images 403. If the
-- perms step fails, re-run it before anything else.
--
-- Schema/data only + idempotent (ON CONFLICT on the folder rows; every move is
-- guarded by `folder IS NULL`). Self-wrapped in a transaction.

BEGIN;

INSERT INTO directus_folders (id, name, parent) VALUES
  ('0e1a0387-0000-4000-8000-000000000001', 'Expense receipts (private)', NULL),
  ('0e1a0387-0000-4000-8000-000000000002', 'Form uploads (private)', NULL),
  ('0e1a0387-0000-4000-8000-000000000003', 'Public images (website)', NULL),
  ('0e1a0387-0000-4000-8000-000000000004', 'Upload quarantine (private)', NULL)
ON CONFLICT (id) DO NOTHING;

-- 1. Public image columns → Public images.
UPDATE directus_files f
   SET folder = '0e1a0387-0000-4000-8000-000000000003'
 WHERE f.folder IS NULL
   AND f.id IN (
         SELECT photo        FROM members       WHERE photo        IS NOT NULL
   UNION SELECT team_picture FROM teams         WHERE team_picture IS NOT NULL
   UNION SELECT logo         FROM sponsors      WHERE logo         IS NOT NULL
   UNION SELECT image        FROM news          WHERE image        IS NOT NULL
   UNION SELECT image        FROM announcements WHERE image        IS NOT NULL
   );

-- 2. Expense receipts → Expense receipts.
UPDATE directus_files f
   SET folder = '0e1a0387-0000-4000-8000-000000000001'
  FROM finance_expenses e
 WHERE e.file = f.id
   AND f.folder IS NULL;

-- 3. File answers → Form uploads. Only answers to fields the form defines as
-- `type: 'file'`; an answer is `{ id, name }` or a bare id string, one value or
-- an array of them (FormFieldRenderer / kscw-hooks formAnswerFileIds).
WITH file_fields AS (
  SELECT s.answers, fld->>'id' AS field_id
    FROM form_submissions s
    JOIN forms fo ON fo.id = s.form
   CROSS JOIN LATERAL jsonb_array_elements(
           CASE WHEN jsonb_typeof(fo.fields) = 'array' THEN fo.fields ELSE '[]'::jsonb END) fld
   WHERE fld->>'type' = 'file'
     AND jsonb_typeof(s.answers) = 'object'
), answer_values AS (
  SELECT v.value
    FROM file_fields ff
   CROSS JOIN LATERAL jsonb_array_elements(
           CASE jsonb_typeof(ff.answers -> ff.field_id)
             WHEN 'array' THEN ff.answers -> ff.field_id
             WHEN 'object' THEN jsonb_build_array(ff.answers -> ff.field_id)
             WHEN 'string' THEN jsonb_build_array(ff.answers -> ff.field_id)
             ELSE '[]'::jsonb
           END) v
), answer_ids AS (
  SELECT CASE jsonb_typeof(value)
           WHEN 'object' THEN value->>'id'
           WHEN 'string' THEN value #>> '{}'
         END AS id
    FROM answer_values
)
UPDATE directus_files f
   SET folder = '0e1a0387-0000-4000-8000-000000000002'
  FROM answer_ids a
 WHERE a.id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   AND f.id = a.id::uuid
   AND f.folder IS NULL;

-- F45: the stray empty "registrations" folder.
DELETE FROM directus_folders d
 WHERE d.id = '100012c8-dab9-4389-ac40-45a54a1c8cf7'
   AND NOT EXISTS (SELECT 1 FROM directus_files f WHERE f.folder = d.id)
   AND NOT EXISTS (SELECT 1 FROM directus_folders c WHERE c.parent = d.id);

COMMIT;
