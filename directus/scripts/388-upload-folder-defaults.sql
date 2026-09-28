-- Migration 388: every upload is private until it is referenced as a public image.
--
-- 2026-09-28 deep audit F01 / F25, second half of migration 387. The allow-list
-- only holds if nothing can land in the Public images folder by choosing it:
-- before this, any member (and any anonymous caller) could POST /files into the
-- public root and have a file served from directus.kscw.ch for good — phishing
-- and malware hosting under the club's domain, and every new private upload path
-- was public until someone remembered to give it a folder.
--
-- Two triggers, one rule — a file becomes public by being USED as a public image,
-- never by being uploaded as one:
--
--   trg_directus_files_folder_guard   BEFORE INSERT OR UPDATE OF folder
--     • folder NULL                 → Upload quarantine (…-0004). Covers every
--       upload that names no folder, whatever the client, incl. an explicit
--       `folder=null` (which bypasses directus_settings.storage_default_folder).
--     • folder = Public images, when the row was not already there → kept out:
--       quarantine on INSERT, the previous folder on UPDATE. Silent, like the
--       385 guard, so a Directus-UI save of an unrelated field never fails.
--       Directus re-sends the client's `folder` in the post-upload metadata write
--       (FilesService.uploadOne), which is why UPDATE is guarded too.
--     • Passes only inside kscw_publish_referenced_file() below, which sets the
--       transaction-local GUC `kscw.publish_file = 'on'` around its own UPDATE.
--
--   trg_<table>_publish_<column>      AFTER INSERT OR UPDATE OF <column> on
--     members.photo · teams.team_picture · sponsors.logo · news.image ·
--     announcements.image — moves the referenced file into Public images, but
--     only when ALL of these hold (a reference is client-written, so each one
--     closes a way to publish a file that is not yours to publish):
--       • it is in the QUARANTINE — never the root (387 already moved every
--         referenced root image; what is left there is private, and until this
--         deploy every root id was anonymously listable, so those ids must be
--         treated as known), never a private folder (a `photo` naming a
--         registration scan must not publish it);
--       • it has an uploader (uploaded_by NOT NULL) — anonymous uploads are
--         feedback screenshots and public-form answers, whose ids the Public
--         read-back window lets any anonymous caller list;
--       • it was uploaded in the last 24 h — every UI flow saves the reference
--         right after the upload, so an older quarantined file is someone's
--         leftover, not a photo being set;
--       • it is a RASTER image (jpeg/png/webp/gif/avif/heic/heif) — no SVG and
--         no other client-declared image/* type (the multipart type is chosen by
--         the client, and an SVG is a document);
--       • it is not an expense receipt (finance_expenses.file) — receipts are
--         images too and, while the upload page names no folder, sit in the
--         quarantine.
--     It does NOT know who is saving the reference (a trigger has no actor):
--     "only your own fresh upload" is the kscw-hooks filter on these columns.
--     Fires for items-API writes and for raw knex writes alike (wadmin news).
--
-- What this means for each writer (verified against the upload call sites):
--   profile photo / team photo / sponsor logo / news + announcement image
--     → upload lands in quarantine (the uploader reads it back — Member policy
--       "own uploads" branch), the save publishes it.
--   registration docs, identity docs, scorer sheets, finance PDFs → name their
--     private folder; untouched.
--   feedback screenshots, signed-in form answers → land in quarantine; the
--     kscw-hooks create hooks move them to their private folder.
--   expense receipts (ExpenseUploadPage names no folder, /kscw/expenses writes
--     raw knex) and anonymous public-form answers (public-forms.js, no
--     accountability) → STAY in quarantine: private, but mis-filed until the
--     upload names its folder. Excluded from publishing above either way.
--   an upload that is never attached → stays private in quarantine.
--   an SVG / older-than-24h / anonymous upload named as a public image → stays
--     private; the image does not show. Re-upload it (or, superadmin, psql).
--   a superadmin who wants a free-standing public file → there is no UI path
--     any more; in psql: SET LOCAL kscw.publish_file = 'on'; UPDATE ….
-- directus_settings.project_logo / public_favicon etc. are Directus
-- `systemPublicKeys` and are served regardless of folder.
--
-- Schema only + idempotent (CREATE OR REPLACE FUNCTION, DROP TRIGGER IF EXISTS
-- then CREATE). Self-wrapped in a transaction. Applies after 387, which creates
-- the folders and moves the existing public images.

BEGIN;

CREATE OR REPLACE FUNCTION public.kscw_directus_files_folder_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  public_folder     constant uuid := '0e1a0387-0000-4000-8000-000000000003';
  quarantine_folder constant uuid := '0e1a0387-0000-4000-8000-000000000004';
BEGIN
  IF NEW.folder IS NULL THEN
    NEW.folder := quarantine_folder;
    RETURN NEW;
  END IF;
  IF NEW.folder = public_folder
     AND (TG_OP = 'INSERT' OR OLD.folder IS DISTINCT FROM public_folder)
     AND coalesce(current_setting('kscw.publish_file', true), '') <> 'on' THEN
    IF TG_OP = 'INSERT' THEN
      NEW.folder := quarantine_folder;
    ELSE
      NEW.folder := coalesce(OLD.folder, quarantine_folder);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_directus_files_folder_guard ON directus_files;
CREATE TRIGGER trg_directus_files_folder_guard
  BEFORE INSERT OR UPDATE OF folder ON directus_files
  FOR EACH ROW EXECUTE FUNCTION public.kscw_directus_files_folder_guard();

-- TG_ARGV[0] = the uuid column on the firing table that names a public image.
CREATE OR REPLACE FUNCTION public.kscw_publish_referenced_file()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  public_folder     constant uuid := '0e1a0387-0000-4000-8000-000000000003';
  quarantine_folder constant uuid := '0e1a0387-0000-4000-8000-000000000004';
  file_id uuid;
BEGIN
  EXECUTE format('SELECT ($1).%I::uuid', TG_ARGV[0]) USING NEW INTO file_id;
  IF file_id IS NULL THEN
    RETURN NULL;
  END IF;
  PERFORM set_config('kscw.publish_file', 'on', true);
  UPDATE directus_files
     SET folder = public_folder
   WHERE id = file_id
     AND folder = quarantine_folder
     AND uploaded_by IS NOT NULL
     AND uploaded_on >= now() - interval '24 hours'
     AND lower(type) IN ('image/jpeg', 'image/png', 'image/webp', 'image/gif',
                         'image/avif', 'image/heic', 'image/heif')
     AND NOT EXISTS (SELECT 1 FROM finance_expenses e WHERE e.file = file_id);
  PERFORM set_config('kscw.publish_file', 'off', true);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_members_publish_photo ON members;
CREATE TRIGGER trg_members_publish_photo
  AFTER INSERT OR UPDATE OF photo ON members
  FOR EACH ROW EXECUTE FUNCTION public.kscw_publish_referenced_file('photo');

DROP TRIGGER IF EXISTS trg_teams_publish_team_picture ON teams;
CREATE TRIGGER trg_teams_publish_team_picture
  AFTER INSERT OR UPDATE OF team_picture ON teams
  FOR EACH ROW EXECUTE FUNCTION public.kscw_publish_referenced_file('team_picture');

DROP TRIGGER IF EXISTS trg_sponsors_publish_logo ON sponsors;
CREATE TRIGGER trg_sponsors_publish_logo
  AFTER INSERT OR UPDATE OF logo ON sponsors
  FOR EACH ROW EXECUTE FUNCTION public.kscw_publish_referenced_file('logo');

DROP TRIGGER IF EXISTS trg_news_publish_image ON news;
CREATE TRIGGER trg_news_publish_image
  AFTER INSERT OR UPDATE OF image ON news
  FOR EACH ROW EXECUTE FUNCTION public.kscw_publish_referenced_file('image');

DROP TRIGGER IF EXISTS trg_announcements_publish_image ON announcements;
CREATE TRIGGER trg_announcements_publish_image
  AFTER INSERT OR UPDATE OF image ON announcements
  FOR EACH ROW EXECUTE FUNCTION public.kscw_publish_referenced_file('image');

COMMIT;
