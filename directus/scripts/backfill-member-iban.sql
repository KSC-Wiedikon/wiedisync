-- backfill-member-iban.sql — pre-fill members.iban from the ClubDesk member
-- export (clubdesk_export staging, loaded by import-clubdesk-csv.mjs from the
-- "export_all.csv" the treasurer downloads).
--
-- Usage:
--   npm run db:iban:backfill:dev
--   npm run db:iban:backfill:prod
--
-- Re-runnable + idempotent: only fills members whose iban IS NULL, so it never
-- clobbers an IBAN a member has entered/corrected in the Finance tab, and never
-- overwrites a previous backfill. Safe to run after every ClubDesk re-import to
-- pick up newly-added IBANs.
--
-- Match rule (same as clubdesk-diff-queries.sql): a Directus member matches a
-- ClubDesk row if ANY of:
--   1. lower(members.email)      = lower(clubdesk.email)
--   2. lower(members.email)      = lower(clubdesk.email_alternativ)
--   3. members.license_nr        = clubdesk.lizenznummer   (both non-empty)
--
-- Only shape-valid IBANs are written (ISO 13616 skeleton: 2 letters, 2 check
-- digits, 11–30 alphanumerics, stored without spaces). ClubDesk holds the bank's
-- own data, so the mod-97 checksum is trusted; the frontend re-validates mod-97
-- when a member next edits it. members.iban is sensitive financial PII (own-member
-- + admin only) — see migration 117 + setup-permissions.mjs.

\timing off
\set ON_ERROR_STOP on

BEGIN;

WITH cd AS (
  SELECT
    LOWER(NULLIF(email, ''))             AS email,
    LOWER(NULLIF(email_alternativ, ''))  AS email_alt,
    NULLIF(lizenznummer, '')             AS lic,
    UPPER(REGEXP_REPLACE(iban, '\s', '', 'g')) AS iban_norm
  FROM clubdesk_export
  WHERE NULLIF(iban, '') IS NOT NULL
),
valid AS (
  SELECT * FROM cd
  WHERE iban_norm ~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$'
),
matched AS (
  -- DISTINCT ON keeps the backfill deterministic if a member happens to match
  -- more than one ClubDesk row / IBAN.
  SELECT DISTINCT ON (m.id) m.id AS member_id, v.iban_norm
  FROM members m
  JOIN valid v ON (
        LOWER(NULLIF(m.email, '')) = v.email
     OR LOWER(NULLIF(m.email, '')) = v.email_alt
     OR (NULLIF(m.license_nr, '') IS NOT NULL AND m.license_nr = v.lic)
  )
  WHERE m.iban IS NULL
  ORDER BY m.id, v.iban_norm
)
UPDATE members m
SET iban = matched.iban_norm
FROM matched
WHERE m.id = matched.member_id;

COMMIT;

-- Report: how many members now have an IBAN on file.
\echo
\echo ── members.iban after backfill ──
SELECT
  count(*)                              AS members_total,
  count(*) FILTER (WHERE iban IS NOT NULL) AS with_iban
FROM members;
