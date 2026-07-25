-- Migration 225: fill members.nationalitaet_codes from the Volleymanager mirror.
--
-- Migrations 223/224 left 327 of 709 members with no nationality at all, because
-- the only source they could draw on was ClubDesk (`clubdesk_export.nationalitaet`,
-- 507 rows) and 223's backfill already consumed it. `sv_vm_check` — the weekly
-- Volleymanager licence mirror — carries a second, independent citizenship field
-- (`nationality`, a German country name, 256/256 populated) that nothing has ever
-- read into `members`.
--
-- Yield is honest and small: it closes 15 of those 327 gaps. The other 312 members
-- hold no licence in any register we mirror, so they can only be asked.
--
-- ⚠ Uses `sv_vm_check.nationality` (person.nationality.countryName = CITIZENSHIP).
-- It must NOT use `sv_vm_check.nationality_code`, which is the IOC alpha-3 of the
-- licence's *playing* nationality (Swiss-equivalent status for game eligibility) —
-- on prod it reads SUI for members whose `nationality` is Deutschland/Italien/
-- Polen/Kolumbien, so feeding it in would relabel foreign citizens as Swiss.
--
-- FILL-ONLY: `WHERE nationalitaet_codes IS NULL`. Members who already have a
-- nationality are left alone even where VM disagrees — 19 such rows exist and are
-- nearly all dual nationals (ClubDesk holds the non-Swiss passport, VM says
-- Schweiz). Merging those is an append, not an overwrite, and is a deliberate
-- decision rather than a side effect of a backfill.
--
-- The German name is resolved through country_name_aliases (migration 224); all
-- 13 distinct VM values resolve, so there is no silent-skip class here. Anything
-- that failed to resolve would simply not be written.
--
-- members.nationalitaet (the ClubDesk-facing German string) is NOT set here —
-- migration 223's trigger derives it from the first code.
--
-- Schema-only in the repo's sense (bounded data backfill) + idempotent.

BEGIN;

-- The 5-step VM↔members match cascade, mirroring scorer-vm-check.js:46-77 and
-- vm-sync-check.mjs:636-655: licence nr → email → vm_email → name+birthdate →
-- name-only. Earlier steps win (row_number over step); name-only keys that
-- collide across two VM people are dropped rather than guessed at.
WITH vm AS (
  SELECT association_id, first_name, last_name, birthday, nationality,
         lower(btrim(coalesce(email,''))) AS email
    FROM sv_vm_check
), name_counts AS (
  SELECT lower(btrim(first_name))||'|'||lower(btrim(last_name)) AS k, count(*) AS n
    FROM vm GROUP BY 1
), candidates AS (
  SELECT 1 AS step, m.id AS mid, v.nationality FROM members m JOIN vm v
      ON nullif(btrim(m.license_nr::text),'') = nullif(btrim(v.association_id::text),'')
  UNION ALL
  SELECT 2, m.id, v.nationality FROM members m JOIN vm v
      ON lower(btrim(m.email)) = v.email AND v.email <> ''
  UNION ALL
  SELECT 3, m.id, v.nationality FROM members m JOIN vm v
      ON lower(btrim(m.vm_email)) = v.email AND v.email <> ''
  UNION ALL
  SELECT 4, m.id, v.nationality FROM members m JOIN vm v
      ON lower(btrim(m.first_name)) = lower(btrim(v.first_name))
     AND lower(btrim(m.last_name))  = lower(btrim(v.last_name))
     AND m.birthdate = v.birthday
  UNION ALL
  SELECT 5, m.id, v.nationality FROM members m JOIN vm v
      ON lower(btrim(m.first_name)) = lower(btrim(v.first_name))
     AND lower(btrim(m.last_name))  = lower(btrim(v.last_name))
    JOIN name_counts nc ON nc.k = lower(btrim(v.first_name))||'|'||lower(btrim(v.last_name))
   WHERE nc.n = 1
), best AS (
  SELECT mid, nationality,
         row_number() OVER (PARTITION BY mid ORDER BY step) AS rn
    FROM candidates
)
UPDATE members m
   SET nationalitaet_codes = a.code
  FROM best b
  JOIN country_name_aliases a ON a.alias = lower(btrim(b.nationality))
 WHERE b.rn = 1
   AND b.mid = m.id
   AND m.nationalitaet_codes IS NULL;

COMMIT;

-- Reporting only — the number is expected to move as VM syncs and members answer.
SELECT 'members_with_nationality_codes' AS metric, count(*) AS value
  FROM members WHERE nationalitaet_codes IS NOT NULL;
