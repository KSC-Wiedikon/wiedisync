-- Migration 228: split the basketball OTN table-official licence into levels 1 and 2.
--
-- Migration 067 modelled basketball officials as otr1_bb / otr2_bb / otn_bb /
-- referee_bb, sourced from ClubDesk's "Offizielle Lizenz" string — which only ever
-- emits the four values VB SC / OTR1 / OTR2 / OTN. So OTR got two levels and OTN
-- got one, purely because ClubDesk does not distinguish them.
--
-- Basketplan — the ISSUING authority — does. An authenticated read of
-- findPersonById.do (2026-07-25) shows `OTN 1 seit dem` (nationalTableReferee1)
-- and `OTN 2 seit dem` (nationalTableReferee2) as separate dated fields, exactly
-- as it holds `OTR 1 seit` / `OTR 2 seit`.
--
-- ⚠ WHY THIS IS NOT A RENAME. The obvious move — rename otn_bb → otn1_bb and add
-- otn2_bb — would silently mislabel real people. In an 86-person Basketplan sample
-- NOBODY held OTN 1 and two people held OTN 2: Moser Rachel and Pfammatter Eleni —
-- both of whom are among our six otn_bb=true members. So today's otn_bb almost
-- certainly means "OTN 2", and renaming it to otn1_bb would assert the opposite.
-- Both levels are therefore added as NEW columns and left false until the
-- Basketplan import fills them from the issuing register. Nothing is guessed.
--
-- otn_bb is KEPT and left in place, still driving every existing consumer
-- (scorer eligibility, the ClubDesk push's deriveOffiziellenLizenz, the migration
-- 066 view, the announcement qualification tokens). It becomes the coarse
-- "holds some OTN" flag. The ~35 code sites that read it are deliberately NOT
-- rewired here: with both new columns false, switching eligibility checks over
-- would instantly drop those six people out of basketball scorer assignment. The
-- rewire belongs in the same change that populates them.
--
-- ⚠ ClubDesk cannot represent the split. Its Offizielle Lizenz picklist holds
-- exactly VB SC / OTR1 / OTR2 / OTN (verified on prod: 156/92/64/7). So the push
-- must map BOTH levels to 'OTN', and the down-sync — which can only ever say
-- "some OTN" — must never clear either column. Same set-true-only discipline the
-- scorer_vb/referee_vb collision forced in 2026-07-17.
--
-- Schema-only + idempotent.

BEGIN;

ALTER TABLE members
  ADD COLUMN IF NOT EXISTS otn1_bb boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS otn2_bb boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN members.otn1_bb IS
  'Basketball OTN 1 (national table official, level 1). Authoritative source is Basketplan (nationalTableReferee1). ClubDesk cannot distinguish OTN levels, so its down-sync must never clear this.';
COMMENT ON COLUMN members.otn2_bb IS
  'Basketball OTN 2 (national table official, level 2). Authoritative source is Basketplan (nationalTableReferee2). ClubDesk cannot distinguish OTN levels, so its down-sync must never clear this.';
COMMENT ON COLUMN members.otn_bb IS
  'Basketball OTN, COARSE (holds some OTN level) — this is all ClubDesk''s Offizielle Lizenz string can express. Prefer otn1_bb / otn2_bb, which Basketplan fills precisely. Kept because scorer eligibility, deriveOffiziellenLizenz and the migration 066 view still read it.';

INSERT INTO directus_fields (collection, field, interface, special, readonly, hidden, sort, width, note)
SELECT 'members', 'otn1_bb', 'boolean', 'cast-boolean', false, false, 40, 'half',
  'Basketball OTN 1 (national table official, level 1) — from Basketplan.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'members' AND field = 'otn1_bb');

INSERT INTO directus_fields (collection, field, interface, special, readonly, hidden, sort, width, note)
SELECT 'members', 'otn2_bb', 'boolean', 'cast-boolean', false, false, 41, 'half',
  'Basketball OTN 2 (national table official, level 2) — from Basketplan.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'members' AND field = 'otn2_bb');

UPDATE directus_fields
   SET note = 'Basketball OTN, coarse (some level) — ClubDesk-sourced. Prefer otn1_bb / otn2_bb.'
 WHERE collection = 'members' AND field = 'otn_bb';

COMMIT;

-- After applying: run `npm run db:setup-perms:dev|prod` (both columns join the
-- member/leader field lists) and regenerate SCHEMA.sql via `npm run db:baseline:prod`.
