-- Migration 093: Widen game_scheduling_opponents.contact_email + contact_name to TEXT.
--
-- A scheduling opponent (a club) often lists several Spielplanverantwortliche,
-- and an invite is a SINGLE tokenized link sent to ALL of them — so the SVRZ
-- import joins every contact's address into contact_email (comma-separated) and
-- every name into contact_name. parseRecipients() in game-scheduling.js splits
-- them back out so each address still receives the invite + scheduling mail.
--
-- A club with many contacts (e.g. Wädivolley H2, 6+ Spielplanverantwortliche)
-- exceeded the old varchar(255) limit, so POST /admin/terminplanung/invites 500'd
-- with: value too long for type character varying(255).
--
-- Schema-only + idempotent per the CLAUDE.md migration policy. No permission row
-- is needed: both scheduling read policies grant fields ['*'] on this collection
-- (setup-permissions.mjs), and the insert goes through the token/admin endpoints
-- (knex), not the items API.

BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'game_scheduling_opponents'
      AND column_name = 'contact_email' AND data_type <> 'text'
  ) THEN
    ALTER TABLE game_scheduling_opponents ALTER COLUMN contact_email TYPE text;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'game_scheduling_opponents'
      AND column_name = 'contact_name' AND data_type <> 'text'
  ) THEN
    ALTER TABLE game_scheduling_opponents ALTER COLUMN contact_name TYPE text;
  END IF;
END $$;

COMMIT;
