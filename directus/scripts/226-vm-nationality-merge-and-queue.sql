-- Migration 226: merge Volleymanager's second nationality, and queue the
-- migration-225 fills for the ClubDesk sync-up.
--
-- ── Part 1: the 19 disagreements ─────────────────────────────────────────────
-- Migration 225 was fill-only, so it deliberately skipped 19 members where
-- wiedisync/ClubDesk already held a nationality and Volleymanager asserted a
-- different one. Two independent registers claiming a different citizenship for
-- the same person is most plausibly a DUAL NATIONAL, which is exactly what
-- migration 223's multi-value column exists for — on prod, 17 of the 19 are
-- "ClubDesk holds the non-Swiss passport, VM says Schweiz" (DE vs Schweiz, IT vs
-- Schweiz, …) and 2 are the reverse (CH vs Schweden, CH vs Serbien).
--
-- So VM's code is APPENDED, never substituted, and the existing code stays
-- FIRST. That ordering is the whole safety property: `members.nationalitaet` is
-- derived by trigger from the FIRST code only, so ClubDesk keeps receiving the
-- exact value it receives today and this migration writes NOTHING to the club's
-- legal register. It is additive in both directions — no nationality is removed,
-- and none of the 19 members' ClubDesk-facing value changes.
--
-- Not done automatically by any sync, and deliberately so: `vm-sync-check.mjs`
-- must not silently rewrite citizenship on a weekly cron. This is a one-time,
-- reviewed merge of a known 19-row set.
--
-- ⚠ Uses sv_vm_check.nationality (citizenship), NOT nationality_code — see the
-- header of migration 225 for why the latter would relabel foreigners as Swiss.
--
-- ── Part 2: queue the 15 fills ───────────────────────────────────────────────
-- Migration 225 gave 15 members a nationality that ClubDesk does not have. The
-- push to ClubDesk is a GATED flow (an admin approves it in the sync-up modal),
-- and this migration does not push — it only marks the rows pending so they
-- group correctly in that modal, mirroring exactly what POST
-- /clubdesk-drift/flag writes (clubdesk_push_pending + a clubdesk_push_changes
-- fill entry with old_value null). The human approval step is unchanged.
--
-- ⚠ Raw SQL, so this writes no directus_revisions/user_logs row — the same
-- blind spot noted for migration 207's backfill. kscw_migrations + git are the
-- audit trail for it.
--
-- Bounded data migration + idempotent.

BEGIN;

-- ── Part 1 ───────────────────────────────────────────────────────────────────
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
  SELECT mid, nationality, row_number() OVER (PARTITION BY mid ORDER BY step) AS rn
    FROM candidates
)
UPDATE members m
   -- Existing code first, VM's appended. Never the other way round.
   SET nationalitaet_codes = m.nationalitaet_codes || ',' || a.code
  FROM best b
  JOIN country_name_aliases a ON a.alias = lower(btrim(b.nationality))
 WHERE b.rn = 1
   AND b.mid = m.id
   AND m.nationalitaet_codes IS NOT NULL
   -- Single-valued only: never append to a list that already holds 2+ codes,
   -- and never append a code the member already has (idempotence on re-run).
   AND m.nationalitaet_codes ~ '^[A-Z]{2}$'
   AND m.nationalitaet_codes <> a.code;

-- ── Part 2 ───────────────────────────────────────────────────────────────────
-- Only members whose ClubDesk contact genuinely lacks a nationality, so this can
-- never queue an overwrite of a value ClubDesk owns. Skips anyone excluded from
-- the sync, and preserves an existing pending payload rather than clobbering it.
UPDATE members m
   SET clubdesk_push_pending = true,
       clubdesk_push_changes = coalesce(m.clubdesk_push_changes, '[]'::jsonb)
         || jsonb_build_array(jsonb_build_object(
              'field', 'nationalitaet',
              'old_value', NULL,
              'new_value', m.nationalitaet))
  FROM clubdesk_export cd
 WHERE btrim(cd.clubdesk_id) = btrim(m.clubdesk_id)
   AND nullif(btrim(coalesce(cd.nationalitaet,'')),'') IS NULL
   AND nullif(btrim(coalesce(m.nationalitaet,'')),'') IS NOT NULL
   AND m.clubdesk_sync_exclude IS NOT TRUE
   -- Idempotent: don't add a second nationalitaet entry to the same payload.
   AND NOT (coalesce(m.clubdesk_push_changes, '[]'::jsonb)
            @> '[{"field":"nationalitaet"}]'::jsonb);

COMMIT;

SELECT 'members_multi_nationality' AS metric, count(*) AS value
  FROM members WHERE nationalitaet_codes LIKE '%,%'
UNION ALL
SELECT 'members_pending_clubdesk_push', count(*)
  FROM members WHERE clubdesk_push_pending IS TRUE;
