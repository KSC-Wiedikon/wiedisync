-- ClubDesk vs Directus — cross-check queries.
--
-- Usage:
--   npm run db:clubdesk:diff:{dev,prod}
--
-- Sections:
--   I.  Volleyball (Sektion=Volleyball ↔ teams.sport=volleyball, scorer_vb)
--   II. Basketball  (Sektion=Basketball  ↔ teams.sport=basketball, otr1/otr2/otn)
--
-- Match rule for both: a Directus member matches a ClubDesk row if ANY of:
--   1. lower(members.email) = lower(clubdesk.email)
--   2. lower(members.email) = lower(clubdesk.email_alternativ)
--   3. members.license_nr = clubdesk.lizenznummer  (both non-empty)

\timing off
\pset border 2

-- ── Match helpers (recomputed each run) ─────────────────────────────
CREATE OR REPLACE TEMP VIEW cd_match_vb AS
SELECT m.id AS dx_id, cv.clubdesk_id AS cd_id
FROM members m
JOIN clubdesk_volleyball cv
  ON LOWER(NULLIF(m.email, ''))  = LOWER(NULLIF(cv.email, ''))
  OR LOWER(NULLIF(m.email, ''))  = LOWER(NULLIF(cv.email_alternativ, ''))
  OR (NULLIF(m.license_nr, '') IS NOT NULL AND m.license_nr = NULLIF(cv.lizenznummer, ''));

CREATE OR REPLACE TEMP VIEW cd_match_bb AS
SELECT m.id AS dx_id, cb.clubdesk_id AS cd_id
FROM members m
JOIN clubdesk_basketball cb
  ON LOWER(NULLIF(m.email, ''))  = LOWER(NULLIF(cb.email, ''))
  OR LOWER(NULLIF(m.email, ''))  = LOWER(NULLIF(cb.email_alternativ, ''))
  OR (NULLIF(m.license_nr, '') IS NOT NULL AND m.license_nr = NULLIF(cb.lizenznummer, ''));

-- ══════════════════════════════════════════════════════════════════════
-- I. VOLLEYBALL
-- ══════════════════════════════════════════════════════════════════════

\echo
\echo ────────── I. VOLLEYBALL ──────────

\echo
\echo === VB-1. CD volleyball NOT in Directus ===
SELECT cv.nachname, cv.vorname, cv.email, cv.status,
       cv.offiziellen_lizenz, cv.lizenznummer
FROM clubdesk_volleyball cv
LEFT JOIN cd_match_vb cm ON cm.cd_id = cv.clubdesk_id
WHERE cm.dx_id IS NULL
ORDER BY cv.nachname, cv.vorname;

\echo
\echo === VB-2. Directus VB-linked members NOT in CD volleyball ===
SELECT DISTINCT m.id, m.first_name, m.last_name, m.email, m.license_nr,
       m.licences::jsonb AS licences, m.kscw_membership_active
FROM members m
JOIN member_teams mt ON mt.member = m.id
JOIN teams t        ON t.id = mt.team
LEFT JOIN cd_match_vb cm ON cm.dx_id = m.id
WHERE t.sport = 'volleyball' AND cm.cd_id IS NULL
ORDER BY m.last_name, m.first_name;

\echo
\echo === VB-3. CD says scorer_vb, Directus does not ===
SELECT m.id, m.first_name, m.last_name, m.email, m.licences,
       cv.offiziellen_lizenz AS cd_offliz
FROM members m
JOIN clubdesk_volleyball cv ON cv.clubdesk_id = (SELECT cd_id FROM cd_match_vb WHERE dx_id = m.id LIMIT 1)
WHERE cv.offiziellen_lizenz LIKE '%Volleyball Lizenz%'
  AND NOT (COALESCE(m.licences::jsonb, '[]'::jsonb) ? 'scorer_vb')
ORDER BY m.last_name;

\echo
\echo === VB-4. Directus has scorer_vb, CD says no ===
SELECT m.id, m.first_name, m.last_name, m.email, m.licences,
       COALESCE(NULLIF(cv.offiziellen_lizenz, ''), '(empty)') AS cd_offliz
FROM members m
JOIN clubdesk_volleyball cv ON cv.clubdesk_id = (SELECT cd_id FROM cd_match_vb WHERE dx_id = m.id LIMIT 1)
WHERE COALESCE(cv.offiziellen_lizenz, '') NOT LIKE '%Volleyball Lizenz%'
  AND COALESCE(m.licences::jsonb, '[]'::jsonb) ? 'scorer_vb'
ORDER BY m.last_name;

\echo
\echo === VB-5. Shells: in Directus, CD-vb matched, NO team links ===
SELECT m.id, m.first_name, m.last_name, m.email,
       cv.status, cv.offiziellen_lizenz, cv.gruppen
FROM members m
JOIN cd_match_vb cm        ON cm.dx_id = m.id
JOIN clubdesk_volleyball cv ON cv.clubdesk_id = cm.cd_id
LEFT JOIN member_teams mt  ON mt.member = m.id
WHERE mt.id IS NULL
  AND m.kscw_membership_active = true
ORDER BY m.last_name;

-- ══════════════════════════════════════════════════════════════════════
-- II. BASKETBALL
-- ══════════════════════════════════════════════════════════════════════

\echo
\echo ────────── II. BASKETBALL ──────────

\echo
\echo === BB-1. CD basketball NOT in Directus ===
SELECT cb.nachname, cb.vorname, cb.email, cb.status,
       cb.offiziellen_lizenz, cb.lizenznummer
FROM clubdesk_basketball cb
LEFT JOIN cd_match_bb cm ON cm.cd_id = cb.clubdesk_id
WHERE cm.dx_id IS NULL
ORDER BY cb.nachname, cb.vorname;

\echo
\echo === BB-2. Directus BB-linked members NOT in CD basketball ===
SELECT DISTINCT m.id, m.first_name, m.last_name, m.email, m.license_nr,
       m.licences::jsonb AS licences, m.kscw_membership_active
FROM members m
JOIN member_teams mt ON mt.member = m.id
JOIN teams t        ON t.id = mt.team
LEFT JOIN cd_match_bb cm ON cm.dx_id = m.id
WHERE t.sport = 'basketball' AND cm.cd_id IS NULL
ORDER BY m.last_name, m.first_name;

\echo
\echo === BB-3. CD says OTR/OTN licence, Directus is missing it ===
SELECT m.id, m.first_name, m.last_name, m.email,
       cb.offiziellen_lizenz AS cd_offliz,
       clubdesk_offliz_to_dx(cb.offiziellen_lizenz) AS expected_dx_licence,
       m.licences AS dx_licences
FROM members m
JOIN clubdesk_basketball cb ON cb.clubdesk_id = (SELECT cd_id FROM cd_match_bb WHERE dx_id = m.id LIMIT 1)
WHERE clubdesk_offliz_to_dx(cb.offiziellen_lizenz) IS NOT NULL
  AND NOT (COALESCE(m.licences::jsonb, '[]'::jsonb) ? clubdesk_offliz_to_dx(cb.offiziellen_lizenz))
ORDER BY m.last_name;

\echo
\echo === BB-4. Directus has BB official licence, CD does not ===
SELECT m.id, m.first_name, m.last_name, m.email, m.licences,
       COALESCE(NULLIF(cb.offiziellen_lizenz, ''), '(empty)') AS cd_offliz
FROM members m
JOIN clubdesk_basketball cb ON cb.clubdesk_id = (SELECT cd_id FROM cd_match_bb WHERE dx_id = m.id LIMIT 1)
WHERE clubdesk_offliz_to_dx(cb.offiziellen_lizenz) IS NULL
  AND (COALESCE(m.licences::jsonb, '[]'::jsonb) ?| ARRAY['otr1_bb','otr2_bb','otn_bb'])
ORDER BY m.last_name;

\echo
\echo === BB-5. Shells: in Directus, CD-bb matched, NO team links ===
SELECT m.id, m.first_name, m.last_name, m.email,
       cb.status, cb.offiziellen_lizenz, cb.gruppen
FROM members m
JOIN cd_match_bb cm         ON cm.dx_id = m.id
JOIN clubdesk_basketball cb ON cb.clubdesk_id = cm.cd_id
LEFT JOIN member_teams mt   ON mt.member = m.id
WHERE mt.id IS NULL
  AND m.kscw_membership_active = true
ORDER BY m.last_name;

-- ══════════════════════════════════════════════════════════════════════
-- Headcounts
-- ══════════════════════════════════════════════════════════════════════

\echo
\echo ────────── Headcounts ──────────
SELECT 'cd_volleyball' AS bucket, COUNT(*)::text AS n FROM clubdesk_volleyball
UNION ALL SELECT 'cd_basketball',  COUNT(*)::text FROM clubdesk_basketball
UNION ALL SELECT 'cd_kscw',        COUNT(*)::text FROM clubdesk_people WHERE sektion = 'KSCW'
UNION ALL SELECT 'cd_no_sektion',  COUNT(*)::text FROM clubdesk_people WHERE COALESCE(sektion, '') = ''
UNION ALL SELECT 'dx_vb_linked',   COUNT(DISTINCT m.id)::text FROM members m JOIN member_teams mt ON mt.member=m.id JOIN teams t ON t.id=mt.team WHERE t.sport='volleyball'
UNION ALL SELECT 'dx_bb_linked',   COUNT(DISTINCT m.id)::text FROM members m JOIN member_teams mt ON mt.member=m.id JOIN teams t ON t.id=mt.team WHERE t.sport='basketball'
UNION ALL SELECT 'last_import',    to_char(last_import_at AT TIME ZONE 'Europe/Zurich', 'YYYY-MM-DD HH24:MI') FROM clubdesk_export_meta WHERE id=1;
