-- Migration 366: backfill Anrede (from Geschlecht) and the register triple
-- (from the originating registration), for members who never got either
--
-- Reported 2026-09-21 (Lisa Prader): a member accepted and pushed the same
-- day showed up on the NEXT sync-down as three "Ours is empty" fills
-- (Status/Sektion/Eintritt) — createMemberFromRegistration never wrote
-- register_status/sektion/eintritt onto the shell row; clubdesk-update.js
-- only ever derived them transiently to build the outgoing CREATE-push CSV
-- cell, then discarded the values. The hooks extension now seeds all three
-- at approval time (see kscw-hooks/src/index.js). This migration is the
-- data-only half: everybody who already went through that gap before the
-- code fix landed.
--
-- Same investigation surfaced a second, wider gap while auditing every field
-- ClubDesk's contact form carries against what wiedisync actually asks or can
-- derive (user request, same day, looking at David Adjiashvili's ClubDesk
-- card): Anrede has NEVER been asked on the public signup form — there is no
-- such field in kscw-website's Anmeldung flow — so `registrations.anrede` is
-- realistically always empty and `members.anrede` stayed NULL for every
-- registration-created member, member imported straight into ClubDesk, and
-- everybody else. Geschlecht IS asked/known for most members and a
-- salutation follows from it deterministically (no legitimate case where a
-- member's title should contradict their recorded sex), so this backfills
-- Anrede from sex for EVERY member with a known sex and no salutation yet —
-- not scoped to registration-linked members, unlike the triple below.
--
-- ── Why the register triple is scoped narrower (clubdesk_id IS NULL) ────────
-- A member who already has a clubdesk_id has an ESTABLISHED ClubDesk-side
-- answer for Status/Sektion — possibly hand-set to something a stale
-- registration can't reproduce (Ehrenmitglied, Verstorben, a sektion change
-- after a sport switch). For those members the reviewed sync-down `fill`
-- proposal (migration 356) is the correct path — a human sees the value
-- before it lands. Only members with NO clubdesk_id yet are touched here:
-- for them there is no existing authoritative value to conflict with, and
-- the value this writes is exactly what the next CREATE push would derive
-- from the same registration anyway (deriveStatus/deriveSektion in
-- clubdesk-update.js) — writing it now just means the round trip agrees on
-- day one instead of needing three clicks in the Decide step.
--
-- Anrede carries no such risk (see above) and is backfilled for everyone,
-- linked or not.
--
-- registrations.member (migration 194) is the authoritative, already-
-- backfilled link — no need to re-run the email/name heuristic here.
-- DISTINCT ON (member) ORDER BY id DESC picks the newest registration when a
-- member has more than one (re-application, or one per sport), same pattern
-- as migration 315's kantonsschule backfill.
--
-- Every UPDATE is guarded by `IS NULL` on the column it fills — idempotent,
-- and safe to hand-run again without undoing a later edit.

BEGIN;

-- ── 1. Anrede from Geschlecht — every member, not registration-scoped ───────
UPDATE members
   SET anrede = CASE sex WHEN 'm' THEN 'Herr' WHEN 'f' THEN 'Frau' END
 WHERE anrede IS NULL
   AND sex IN ('m', 'f');

-- ── 2. The register triple — only members not yet linked to a ClubDesk contact ──
WITH newest_reg AS (
  SELECT DISTINCT ON (member) member, membership_type, sektion_choice, submitted_at
    FROM registrations
   WHERE member IS NOT NULL AND status = 'approved'
   ORDER BY member, id DESC
)
UPDATE members m
   SET register_status = CASE WHEN lower(btrim(r.membership_type)) = 'passive'
                               THEN 'Passivmitglied' ELSE 'Aktivmitglied' END
  FROM newest_reg r
 WHERE m.id = r.member
   AND m.register_status IS NULL
   AND m.clubdesk_id IS NULL;

WITH newest_reg AS (
  SELECT DISTINCT ON (member) member, membership_type, sektion_choice, submitted_at
    FROM registrations
   WHERE member IS NOT NULL AND status = 'approved'
   ORDER BY member, id DESC
)
UPDATE members m
   SET sektion = CASE lower(btrim(r.membership_type))
                   WHEN 'volleyball' THEN 'Volleyball'
                   WHEN 'basketball' THEN 'Basketball'
                   ELSE COALESCE(NULLIF(btrim(r.sektion_choice), ''), 'KSCW')
                 END
  FROM newest_reg r
 WHERE m.id = r.member
   AND m.sektion IS NULL
   AND m.clubdesk_id IS NULL;

WITH newest_reg AS (
  SELECT DISTINCT ON (member) member, membership_type, sektion_choice, submitted_at
    FROM registrations
   WHERE member IS NOT NULL AND status = 'approved'
   ORDER BY member, id DESC
)
UPDATE members m
   SET eintritt = r.submitted_at::date
  FROM newest_reg r
 WHERE m.id = r.member
   AND m.eintritt IS NULL
   AND m.clubdesk_id IS NULL;

COMMIT;

-- Verification (dev/prod):
--   SELECT coalesce(anrede,'(none)') AS anrede, count(*) FROM members GROUP BY 1 ORDER BY 2 DESC;
--
--   -- Everybody left without Anrede has no known sex either (the honest gap):
--   SELECT count(*) FROM members WHERE anrede IS NULL AND sex IS NOT NULL;  -- expect 0
--
--   -- Register triple only touched unlinked members:
--   SELECT count(*) FROM members WHERE clubdesk_id IS NOT NULL
--     AND (register_status IS NOT NULL OR sektion IS NOT NULL OR eintritt IS NOT NULL)
--     AND date_updated::date = current_date;  -- sanity spot-check right after running
