-- 176-registrations-sektion-choice.sql
-- Sektion (Volleyball/Basketball/KSCW) chosen by the registration approver for
-- PASSIVE members (active members' Sektion is derived from their sport). Feeds
-- the ClubDesk create-push Sektion column (deriveSektion in clubdesk-update.js).
-- Schema-only + directus_fields registration so the AnmeldungenPage approval
-- screen can read/write it. Idempotent.

ALTER TABLE registrations ADD COLUMN IF NOT EXISTS sektion_choice VARCHAR(32);

-- Register the field so the items API + admin UI expose it. directus_fields has
-- no unique (collection, field) constraint, so guard re-runs with NOT EXISTS.
INSERT INTO directus_fields (collection, field, special, interface, options, display, readonly, hidden, sort, width, note)
SELECT
  'registrations', 'sektion_choice', NULL, 'select-dropdown',
  '{"choices":[{"text":"Volleyball","value":"Volleyball"},{"text":"Basketball","value":"Basketball"},{"text":"KSCW","value":"KSCW"}]}',
  NULL, false, false, 40, 'half',
  'Sektion for passive members (active members inherit their sport). Pushed to ClubDesk on create.'
WHERE NOT EXISTS (
  SELECT 1 FROM directus_fields WHERE collection = 'registrations' AND field = 'sektion_choice'
);
