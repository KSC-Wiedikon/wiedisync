-- Migration 342: retire the 'NONE' federation-of-origin sentinel.
--
-- Until now the public form's first option was "None / not licensed with a
-- national federation at 14", stored as the literal 'NONE'. Two problems with
-- it, and they compound:
--
--   1. It answers the wrong question. A federation of *origin* is the body that
--      FIRST licensed the player (migration 227). If nobody has licensed them
--      yet and their first licence is issued here, then Swiss Volley / Swiss
--      Basketball IS their federation of origin — 'CH', not "none". The
--      sentinel recorded an absence where there is in fact an answer.
--   2. Under the age-14 wording it silently swallowed real transfers. Someone
--      first licensed by FIPAV at 20 and arriving here truthfully answered
--      "nobody licensed me at 14" → 'NONE' → `federationBucketOf` filed them as
--      `settled` and no transfer certificate was ever chased. Asking "who
--      licensed you first" cannot produce that miss.
--
-- On top of that it was the top-of-list option and got picked accordingly: 10
-- of the last 15 registrations answering the question chose it, nearly all of
-- them Swiss juniors whose first licence comes from us.
--
-- Backfill rule, applied to both tables:
--   • primary nationality is CH (or unknown) → 'CH'. Their first licence is the
--     Swiss one; this is the case the sentinel was really being used for.
--   • primary nationality is foreign        → that country's code, mirroring
--     migration 239's seed rule (nationality as the starting guess), so the
--     row lands on the Transfers worklist and a human resolves it rather than
--     the club silently asserting Swiss origin for a foreign national.
--
-- Prod effect: members 9 rows (8 → CH, 1 → IT: Matteo Mazzocchi, Italian, whose
-- possible FIP origin is exactly the case branch 2 exists for), registrations
-- 10 rows (9 → CH, 1 → GR). Registration rows are the historical submission
-- record; they are re-expressed under the new definition rather than corrected,
-- and the approved member rows they produced remain the truth.
--
-- After the backfill the CHECK constraints stop accepting 'NONE' at all, so the
-- sentinel cannot come back from a stale cached form bundle (see
-- `normalizeFederation`, which maps a late 'NONE' to 'CH' before it reaches
-- the column).
--
-- Bounded data migration + schema + idempotent.

BEGIN;

UPDATE members
   SET federation_of_origin = CASE
         WHEN nationalitaet_codes IS NOT NULL
          AND split_part(nationalitaet_codes, ',', 1) ~ '^[A-Z]{2}$'
          AND split_part(nationalitaet_codes, ',', 1) <> 'CH'
         THEN split_part(nationalitaet_codes, ',', 1)
         ELSE 'CH'
       END
 WHERE federation_of_origin = 'NONE';

UPDATE registrations
   SET federation_of_origin = CASE
         WHEN nationalitaet_codes IS NOT NULL
          AND split_part(nationalitaet_codes, ',', 1) ~ '^[A-Z]{2}$'
          AND split_part(nationalitaet_codes, ',', 1) <> 'CH'
         THEN split_part(nationalitaet_codes, ',', 1)
         ELSE 'CH'
       END
 WHERE federation_of_origin = 'NONE';

ALTER TABLE members DROP CONSTRAINT IF EXISTS members_federation_of_origin_fmt;
ALTER TABLE members ADD CONSTRAINT members_federation_of_origin_fmt
  CHECK (federation_of_origin IS NULL OR federation_of_origin ~ '^[A-Z]{2}$');

ALTER TABLE registrations DROP CONSTRAINT IF EXISTS registrations_federation_of_origin_fmt;
ALTER TABLE registrations ADD CONSTRAINT registrations_federation_of_origin_fmt
  CHECK (federation_of_origin IS NULL OR federation_of_origin ~ '^[A-Z]{2}$');

COMMENT ON COLUMN members.federation_of_origin IS
  'National federation that FIRST licensed the member (their federation of origin — NOT the most recent one). ISO 3166-1 alpha-2, or NULL = not answered. A member whose first licence is issued here is ''CH'': there is no "none" — migration 342 retired that sentinel.';

COMMENT ON COLUMN registrations.federation_of_origin IS
  'Federation of origin from the public form: the federation that FIRST licensed the applicant. ISO alpha-2, or NULL (not answered). First-ever licence = ''CH'' (the sentinel ''NONE'' was retired by migration 342).';

UPDATE directus_fields
   SET note = 'Federation that FIRST licensed the member (federation of origin, not the most recent): ISO 3166-1 alpha-2 code, or empty (not answered). A first-ever licence issued here is CH.'
 WHERE collection = 'members' AND field = 'federation_of_origin';

UPDATE directus_fields
   SET note = 'Federation of origin as submitted on the public form: ISO 3166-1 alpha-2 code, or empty (not answered). A first-ever licence issued here is CH.'
 WHERE collection = 'registrations' AND field = 'federation_of_origin';

COMMIT;
