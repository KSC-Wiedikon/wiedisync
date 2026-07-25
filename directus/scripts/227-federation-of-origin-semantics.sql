-- Migration 227: correct the definition of federation_of_origin.
--
-- Migration 223 documented the column as "the national federation the member was
-- LAST licensed with". That is wrong, and the name says so: a federation of
-- *origin* is the one that FIRST licensed the player — where they were formed —
-- not the most recent one they held a licence with.
--
-- The distinction is not cosmetic. Under the old reading, a player licensed in
-- Italy, then Germany, then arriving here would answer "Germany"; under the
-- correct one they answer "Italy". The two also serve different purposes: the
-- most recent federation is who issues a transfer certificate, whereas the first
-- one is what establishes formation/origin (compare Swiss Volley's own
-- `is_locally_educated` / `is_foreigner` flags mirrored in `sv_vm_check`). 223's
-- comment additionally cited the transfer certificate as the reason for the
-- column, which belongs to the *last* federation — so that claim is dropped
-- rather than restated against the wrong field.
--
-- The 'NONE' sentinel is re-documented accordingly: it means the member has never
-- held a licence with any federation (their first licence will be issued here),
-- not "never licensed abroad".
--
-- No data change: the column is 0/709 on prod, so nothing was ever stored under
-- the old reading and no re-interpretation of existing values is needed. Comments
-- and Directus field notes only.
--
-- Schema-only + idempotent.

BEGIN;

COMMENT ON COLUMN members.federation_of_origin IS
  'National federation that FIRST licensed the member (their federation of origin — NOT the most recent one). ISO 3166-1 alpha-2, or ''NONE'' = has never held a licence with any federation, or NULL = not answered.';

COMMENT ON COLUMN registrations.federation_of_origin IS
  'Federation of origin from the public form: the federation that FIRST licensed the applicant. ISO alpha-2, ''NONE'' (never licensed before), or NULL (not answered).';

UPDATE directus_fields
   SET note = 'Federation that FIRST licensed the member (federation of origin, not the most recent): ISO 3166-1 alpha-2 code, ''NONE'' (never licensed before), or empty (not answered).'
 WHERE collection = 'members' AND field = 'federation_of_origin';

UPDATE directus_fields
   SET note = 'Federation of origin from the public form — the federation that FIRST licensed the applicant. ISO alpha-2, ''NONE'', or empty.'
 WHERE collection = 'registrations' AND field = 'federation_of_origin';

COMMIT;

-- After applying: regenerate directus/scripts/SCHEMA.sql (`npm run db:baseline:prod`),
-- whose copy of the 223 comment is now stale.
