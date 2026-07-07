-- Migration 188: delete unparseable phone values (user decision 2026-07-07:
-- "delete phones that don't match, worst case they update them on their
-- profile"). After the 186/187 backfills, 6 members.phone values remained that
-- kscw_normalize_phone cannot safely rewrite (Excel-destroyed cells, digit-
-- short numbers, pre-2007 formats, foreign numbers missing '+'). Policy from
-- here: only CANONICAL values live in wiedisync — the down-sync fill was
-- changed the same day to skip unrewritable ClubDesk values (import-clubdesk-
-- csv.mjs), so deleted garbage cannot re-import; members re-enter their number
-- in the profile (validated + canonicalized on save).
--
-- Generic + idempotent: NULLs ANY phone the normalizer rejects, so a future
-- stray (e.g. written by a not-yet-normalizing path) is swept on re-run too.
-- Depends on migration 186 (kscw_normalize_phone).

BEGIN;

UPDATE members SET phone = NULL
WHERE NULLIF(btrim(phone), '') IS NOT NULL
  AND kscw_normalize_phone(phone) IS NULL;

UPDATE members SET billing_phone = NULL
WHERE NULLIF(btrim(billing_phone), '') IS NOT NULL
  AND kscw_normalize_phone(billing_phone) IS NULL;

UPDATE registrations SET telefon_mobil = NULL
WHERE NULLIF(btrim(telefon_mobil), '') IS NOT NULL
  AND kscw_normalize_phone(telefon_mobil) IS NULL;

COMMIT;
