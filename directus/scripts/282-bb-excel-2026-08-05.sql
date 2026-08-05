-- Migration 282: mirror the 2026-08-05 ClubDesk basketball export into members.
--
-- A four-register reconciliation (ClubDesk export of 05.08.2026 11:07, the
-- clubdesk_export mirror from 04.08 14:36, `members`, and basketplan_people
-- scraped 27.07) over all 240 basketball contacts found 186 in exact agreement
-- and a short, specific delta. This migration applies the part of that delta the
-- weekly ClubDesk sync cannot reach on its own; everything the sync CAN reach is
-- left for it, so re-running the sync afterwards is a no-op rather than a fight.
--
-- ── Why the standard importer was NOT used ──────────────────────────────────
-- `import-clubdesk-csv.mjs` opens with `TRUNCATE clubdesk_export RESTART
-- IDENTITY`. The export in hand is basketball-only (240 of 1152 contacts) and
-- omits `[Gruppen]` entirely, so feeding it through the importer would drop the
-- 912 volleyball rows from the mirror AND blank the group column that
-- referee_vb, deriveGruppen and the sync-up drift computation all read. The
-- mirror is left untouched; Saturday's full-club scrape refreshes it normally.
--
-- ── 1. Officials licences (otr*/otn*) — 3 members ───────────────────────────
-- Three basketball players hold a referee licence that never reached wiedisync.
-- Root cause is the same for all three and is NOT a sync bug: they have no
-- `license_nr`, and their name is spelled differently in Basketplan, so the
-- basketplan apply — which joins on licence number OR exact first+last+birthdate
-- — misses on both arms. Birthdates match exactly where both registers hold one,
-- so these are confirmed identifications, not guesses:
--
--   members (cd id)              Basketplan                      licence  birthdate
--   David Hermann      1001050   David Herrmann     (two r's)     837578   1997-10-29
--   Hippolyte Morderet 1001009   Hippolyte Y.C. Mordret (no 'e')  836991   —
--   Shanthosh Vijayakumara 1000950  Shan Thosh Vijayakumaran      834092   2008-02-11
--
-- Levels come from Basketplan (otr1_since / otr2_since), the federation register
-- — deliberately NOT from ClubDesk's "Offiziellen Lizenz", which is a
-- single-value picklist and can only ever show the higher rung. That same
-- single-value limit is why 50 other members legitimately hold otr1_bb AND
-- otr2_bb while ClubDesk shows only OTR2: those are correct and are left alone.
--
-- Set-true only, matching every other writer of these columns (migration 207's
-- rule): absence from a register is absence of evidence, never evidence a
-- licence was revoked.
--
-- ── 2. license_nr — 3 members ───────────────────────────────────────────────
-- Filling it is what stops this recurring: once set, the basketplan apply reaches
-- them by licence number and the name drift stops mattering.
-- ⚠ license_nr is an EXACT JOIN KEY (VM Einsatzliste, sv-licence, ClubDesk
-- diff) — one member, one licence, never a merged list. Morderet's number is
-- absent from ClubDesk too, so only Basketplan can supply it.
-- ⚠ Leading zeros are significant. These three have none (verified against the
-- Basketplan licence list); do NOT source licence numbers from the .xlsx
-- generally — Excel stores them as numbers and eats any leading zero, which is
-- why the same file shows 55803/38514 for members correctly holding 055803/038514.
--
-- ── 3. IBAN — 2 members ─────────────────────────────────────────────────────
-- Fill-only, exactly as the weekly sync would do it. Both pass the ISO 13616
-- mod-97 check and both land in a wiedisync row that is currently empty.
--
-- ⚠ NOT applied, though the export offers them — verified junk, not data:
--   • 3 AHV numbers. Giulio Cataldi (1000883) reads '7570000000000', which is not
--     a Swiss AHV at all (they all begin 756). Ella (1000942) and Juli Sidi
--     Friede (1000941) BOTH read '7560000000000' — a failed check digit, and the
--     same number for two different people, which an AHV can never be. These are
--     placeholders someone typed to get past a required field; writing them would
--     put three unusable numbers into a column the club bills from.
--   • 1 phone. Felix Stauch (1001100) reads '79598279' — eight digits, one short
--     of a Swiss mobile even after restoring the leading 0. Truncated, not a
--     number, and wiedisync's field is empty rather than wrong today.
-- Both are ClubDesk-side data-quality items for the club to fix at source; the
-- weekly sync will pick them up once they are real.
--
-- The 27 fields where BOTH registers hold a value and they DIFFER are untouched
-- (fill-only) — that includes 5 birthdate mismatches and 18 phone numbers, a
-- data-quality question for the club rather than a sync action.
--
-- ── 4. trainer_licences — 3 coaches ─────────────────────────────────────────
-- Needs migration 281 (the basketball rungs) to exist first, hence the ordering.
-- ClubDesk's free-text cell reads "Trainer 1" ×2 and "Trainer 2+" ×1; the '+' is
-- shorthand, not a fourth rung, so it stores as T2 (user 2026-08-05).
-- Fill-only: the member owns this field from their first answer onward.
--
-- Data-only + idempotent (every statement is a guarded fill or a set-true).
-- No schema change, no permission change, no SCHEMA.sql rebaseline.

BEGIN;

-- ── 1. Officials licences, per Basketplan ───────────────────────────────────
UPDATE members SET otr1_bb = true
 WHERE clubdesk_id IN ('1001050', '1001009', '1000950')   -- Hermann, Morderet, Vijayakumara
   AND otr1_bb IS DISTINCT FROM true;

UPDATE members SET otr2_bb = true
 WHERE clubdesk_id IN ('1001050', '1001009')              -- Hermann, Morderet (Vijayakumara is OTR1 only)
   AND otr2_bb IS DISTINCT FROM true;

-- ── 2. Licence numbers, per Basketplan ──────────────────────────────────────
UPDATE members SET license_nr = v.nr
  FROM (VALUES ('1001050', '837578'),   -- Hermann, David
               ('1001009', '836991'),   -- Morderet, Hippolyte
               ('1000950', '834092')    -- Vijayakumara, Shanthosh
       ) AS v(cdid, nr)
 WHERE members.clubdesk_id = v.cdid
   AND NULLIF(btrim(COALESCE(members.license_nr, '')), '') IS NULL;

-- ── 3. IBAN, from the export ────────────────────────────────────────────────
UPDATE members SET iban = v.val
  FROM (VALUES ('1001159', 'CH0609000000313341757'),  -- Papaevangelou, Apostolia
               ('1000431', 'CH9300230230226163M1A')   -- Urech, Philip
       ) AS v(cdid, val)
 WHERE members.clubdesk_id = v.cdid
   AND NULLIF(btrim(COALESCE(members.iban, '')), '') IS NULL;

-- ── 4. Coaching qualification (needs migration 281's widened CHECK) ─────────
UPDATE members SET trainer_licences = v.val
  FROM (VALUES ('1000427', 'T2'),    -- Biland, Fabiano   — ClubDesk "Trainer 2+"
               ('1000803', 'T1'),    -- Chonia, Joseph    — ClubDesk "Trainer 1"
               ('1000107', 'T1')     -- Grimshaw, Anne    — ClubDesk "Trainer 1"
       ) AS v(cdid, val)
 WHERE members.clubdesk_id = v.cdid
   AND members.trainer_licences IS NULL;

COMMIT;

-- Verify:
--   SELECT id, last_name, license_nr, otr1_bb, otr2_bb
--     FROM members WHERE clubdesk_id IN ('1001050','1001009','1000950');
--   SELECT id, last_name, trainer_licences FROM members WHERE trainer_licences IS NOT NULL;
--   SELECT id, last_name, iban FROM members WHERE clubdesk_id IN ('1001159','1000431');
