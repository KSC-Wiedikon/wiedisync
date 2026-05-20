-- Migration 065: add bracketed-variant columns to clubdesk_export
--
-- The full-club ClubDesk export ("clubdesk_export_YYYYMMDD.csv") has
-- two additional columns NOT present in the section-filtered export:
--
--   • [Gruppen] — system "deep" groups list (similar to but distinct
--     from plain `Gruppen`)
--   • [Rolle]   — system user-role label (e.g. "Standard Benutzer")
--
-- Storing both variants verbatim so queries can pick the right one
-- per export type. Migration 064's positional column list still works;
-- this is purely additive.

BEGIN;

ALTER TABLE clubdesk_export
  ADD COLUMN IF NOT EXISTS gruppen_bracketed TEXT,
  ADD COLUMN IF NOT EXISTS rolle_bracketed   TEXT;

COMMIT;
