-- Migration 126: reconcile members.website_name_private column DEFAULT to true.
--
-- Migration 116 created the column with `DEFAULT false`, but the privacy-first
-- intent (and the live prod baseline in SCHEMA.sql) is `DEFAULT true`: a new
-- member starts private, so their public-website roster entry shows the surname
-- as an initial only ("Anna M.") and hides the year of birth until they opt in.
-- Prod was changed to `DEFAULT true` out-of-band and SCHEMA.sql regenerated, so
-- the live schema and the migration journal drifted apart. This is the
-- fix-forward that makes the journal match prod (per the "don't edit applied
-- migrations — fix forward with a new number" rule).
--
-- DEFAULT-ONLY by design. We do NOT backfill values: every existing row is
-- already true, and a blanket `false -> true` UPDATE would re-privatise any
-- member who deliberately turns OFF "Show only first name on the website" to
-- show their full surname between now and when this runs. SET DEFAULT only
-- affects future INSERTs.
--
-- Schema-only + idempotent: re-applying SET DEFAULT true is a no-op, and on
-- dev/prod (already true) this changes nothing — it exists to correct the
-- audit trail so a fresh install-from-journal produces the right default.

BEGIN;

ALTER TABLE members ALTER COLUMN website_name_private SET DEFAULT true;

COMMIT;
