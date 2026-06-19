-- Migration 120: default members.birthdate_visibility to 'hidden' (privacy-first).
--
-- The column default was 'full' since it was introduced, even though every
-- member-creation path in the app already sets 'hidden' explicitly (the signup
-- + member-create endpoints in kscw-endpoints, the registration hook in
-- kscw-hooks, and vm-sync-check.mjs), and the profile editor falls back to
-- 'hidden' for any unset value. The latent 'full' default could therefore only
-- ever apply to a member inserted WITHOUT specifying the column (e.g. a manual
-- Directus-admin create), which would expose a birthday against the club's
-- privacy-first intent. Align the column default with that intent.
--
-- Scope: DEFAULT only. Existing rows are intentionally NOT changed — members
-- who deliberately chose 'full' / 'year_only' keep their choice (no backfill).
--
-- Idempotent: SET DEFAULT can be re-run safely.

ALTER TABLE members ALTER COLUMN birthdate_visibility SET DEFAULT 'hidden';
