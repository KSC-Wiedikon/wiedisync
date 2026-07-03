-- Migration 166: feedback — support multiple screenshots.
--
-- The feedback form lets a user attach up to 5 screenshots, but `feedback` only
-- had a single `screenshot uuid` (M2O to directus_files), so the frontend saved
-- only the first — silent loss of user-submitted screenshots (2026-07-02 review,
-- FeedbackPage HIGH; deferred then as needing schema).
--
-- Add a `screenshots jsonb` array of file UUIDs (the full set, first included).
-- `screenshot` is KEPT as the primary/first file so the existing quarantine hook,
-- the /assets M2O and any old reader keep working — the frontend writes both
-- (screenshots = all, screenshot = screenshots[0]). Backfill existing rows.
--
-- Registered in directus_fields (cast-json) so the items API returns/accepts the
-- array and the admin data model shows it. Additive + idempotent.

BEGIN;

ALTER TABLE feedback ADD COLUMN IF NOT EXISTS screenshots jsonb;

-- Backfill: fold the existing single screenshot into the new array.
UPDATE feedback
   SET screenshots = jsonb_build_array(screenshot)
 WHERE screenshot IS NOT NULL AND screenshots IS NULL;

-- Register the field so Directus (items API + admin) treats it as JSON.
INSERT INTO directus_fields (collection, field, special, interface, display, note, sort, width)
SELECT 'feedback', 'screenshots', 'cast-json', 'input-code', 'raw',
       'All screenshot file UUIDs (multi-file feedback). `screenshot` mirrors the first for back-compat.', 99, 'full'
WHERE NOT EXISTS (
  SELECT 1 FROM directus_fields WHERE collection = 'feedback' AND field = 'screenshots'
);

COMMIT;
