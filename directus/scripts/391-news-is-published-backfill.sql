-- Migration 391: NULL news.is_published → true, before the Public news filter
-- starts requiring it.
--
-- Website audit 2026-09-28, F-07. "Archive" in /admin PATCHes
-- `is_published:false` and leaves `published_at` in the past, and a draft saved
-- with the toggle off gets `published_at = today` — both stayed public on the
-- website (homepage, /news, the ?news= modal, /feed.xml) because the Public news
-- read filtered on `published_at` only. setup-permissions.mjs now adds
-- `is_published _eq true` to that filter (and makes the column readable, since
-- the website sends the same filter as a second line of defence).
--
-- "Archive" and the /admin form always write an explicit boolean, so a NULL can
-- only be a row that predates the column's use and is public today; making it
-- `true` keeps it exactly as visible as it is now. Rows that are explicitly
-- `false` are drafts or archived — hiding those is the fix.
--
-- (This was the news half of the pre-rebase 381-private-upload-folders.sql. Its
-- folder half was dropped: migrations 387/388 — deep audit 2026-09-28 — already
-- create the private folders, file the existing uploads and make every other
-- root file private under the allow-list.)
--
-- Data-only + idempotent (matches NULL rows only). Self-wrapped in a transaction.

BEGIN;

UPDATE news SET is_published = true
 WHERE is_published IS NULL
   AND published_at IS NOT NULL;

COMMIT;

-- =============================================================================
-- ⚠ BEFORE running setup-permissions on prod, list the articles the new news
-- filter will take off the site — each must be a deliberate draft/archive:
--   SELECT id, title, published_at, is_published FROM news
--    WHERE published_at <= now() AND is_published IS NOT TRUE
--    ORDER BY published_at DESC;
-- A row there that should be live: UPDATE news SET is_published = true WHERE id = …
-- =============================================================================
