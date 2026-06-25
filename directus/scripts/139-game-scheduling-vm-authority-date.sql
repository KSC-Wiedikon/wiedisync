-- Migration 139: per-season "SV feed takeover date" (vm_authority_date).
--
-- Adds `game_scheduling_seasons.vm_authority_date date`.
--
-- Background: a game scheduled through the Terminplanung tool (a confirmed
-- booking, mirrored into `games`) carries its AGREED date/time/venue, and the
-- SV sync (sv-sync.js) PROTECTS that date against the national feed's
-- placeholder — which lingers until the opponent enters our AWAY games in VM.
-- That protection used to hold until the game was actually played (completed).
--
-- This column adds a per-season cutoff: once the calendar passes
-- vm_authority_date, every opponent has had time to enter their away games, so
-- the national feed becomes authoritative for date/time/venue too and the sync
-- stops shielding the agreed values. NULL → protect indefinitely (until
-- completed), i.e. the pre-139 behaviour — so existing seasons are unaffected
-- until a date is set.
--
-- Idempotent. Schema-only (the column sits under the existing
-- game_scheduling_seasons update permission — no setup-permissions change).

BEGIN;

ALTER TABLE game_scheduling_seasons
  ADD COLUMN IF NOT EXISTS vm_authority_date date;

COMMENT ON COLUMN game_scheduling_seasons.vm_authority_date IS
  'Date the Swiss Volley feed becomes authoritative for tool-scheduled games'' date/time/venue. Before it, the sync protects the agreed values against the feed placeholder; on/after it, the feed wins. NULL → protect indefinitely (until the game is completed).';

-- Directus field metadata so the column is editable in the admin + exposed via
-- the items API (same pattern as migration 108's season window dates).
INSERT INTO directus_fields (collection, field, special, interface, options, display, sort, hidden, note)
SELECT 'game_scheduling_seasons', 'vm_authority_date', NULL, 'datetime',
  '{"includeSeconds":false}'::json, 'datetime', 53, false,
  'Date the SV feed takes over date/time/venue for tool-scheduled games (NULL → protect until the game is completed).'
WHERE NOT EXISTS (
  SELECT 1 FROM directus_fields WHERE collection = 'game_scheduling_seasons' AND field = 'vm_authority_date'
);

COMMIT;
