-- Migration 078: game_scheduling_opponents.language (opponent's chosen UI language)
--
-- Remembers the language the opponent picked on the public Terminplanung page so
-- transactional emails (access link, home slot booked, away proposals received,
-- game confirmed) go out in that language. Set when the opponent acts
-- (book/propose) and updated live when they flip the language switcher.
-- Nullable: null = not chosen yet -> emails fall back to German.
--
-- Schema-only + idempotent. No permission row needed: the public scheduling
-- endpoints read/write this column via raw knex (service connection), bypassing
-- collection policies; admins bypass policy filters anyway.

BEGIN;

ALTER TABLE game_scheduling_opponents ADD COLUMN IF NOT EXISTS language varchar(5);

COMMENT ON COLUMN game_scheduling_opponents.language IS
  'Opponent UI language chosen on the public Terminplanung page (de/gsw/en/fr/it). Used for transactional emails. Null = not yet chosen (falls back to de).';

-- Directus field metadata so the column is recognized by the schema and visible
-- (read-only-ish) in the admin UI. Mirrors the pattern in migration 076.
INSERT INTO directus_fields (collection, field, special, interface, options, sort, hidden, note)
SELECT 'game_scheduling_opponents', 'language', NULL, 'select-dropdown',
  '{"choices":[{"text":"Deutsch","value":"de"},{"text":"Schweizerdeutsch","value":"gsw"},{"text":"English","value":"en"},{"text":"Francais","value":"fr"},{"text":"Italiano","value":"it"}]}'::json,
  55, false,
  'Opponent UI language for emails (de/gsw/en/fr/it). Set automatically from the public scheduling page.'
WHERE NOT EXISTS (
  SELECT 1 FROM directus_fields WHERE collection = 'game_scheduling_opponents' AND field = 'language'
);

COMMIT;
