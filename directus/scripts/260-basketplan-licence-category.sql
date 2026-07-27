-- Migration 260: basketplan_people.licence_category
--
-- The Basketplan licence list (showPrintLicences.do) carries a per-licence
-- CATEGORY (Senior / U 6..U 20 / Offizielle/r) that the person page
-- (findPersonById.do) does not — migration 208 imported it once as inline
-- data, but the staging table (migration 230) never had a column for it, so
-- every later scrape dropped it. Staged here so the fill pass in
-- basketplan-scrape-people.mjs --apply can maintain members.licence_category
-- for basketball the same way it maintains nationality and officials flags.
--
-- Schema-only + idempotent.

BEGIN;

ALTER TABLE basketplan_people ADD COLUMN IF NOT EXISTS licence_category text;

COMMENT ON COLUMN basketplan_people.licence_category IS
  'Licence category from the club licence list (Senior / U 6..U 20 / Offizielle/r). Harvested from showPrintLicences.do — the person page does not carry it. Applied to members.licence_category fill-or-BB-refresh only; Volleymanager codes (RLL/JLL/…) are never overwritten.';

COMMIT;
