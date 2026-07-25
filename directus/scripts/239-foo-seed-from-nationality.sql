-- Migration 239: seed federation_of_origin from the primary nationality for
-- members who have not answered.
--
-- ⚠ NATIONALITY IS NOT FEDERATION OF ORIGIN, and this migration knowingly
-- conflates them. Federation of origin is the association that licensed the
-- person AT AGE 14 (FIVB Sports Regulations, via Swiss Volley); citizenship is a
-- different fact. An Italian citizen raised in Zürich who has only ever played
-- here was licensed at 14 by Swiss Volley, so their true FoO is CH — this
-- migration will write IT. Explicitly requested as a starting point on the
-- understanding that members correct their own record.
--
-- What makes it recoverable rather than destructive:
--   • FILL-ONLY — the 4 members who have actually answered are never touched.
--   • `transfer_status` is left NULL for every seeded row, so "nobody has looked
--     at this yet" remains readable. A seeded value and a reviewed one are still
--     distinguishable, which is what stops this from silently becoming truth.
--   • Members with no nationality at all (96) are left NULL rather than guessed
--     at, so the Transfers page keeps a genuine "never asked" cohort.
--
-- Expected effect on prod: 609 rows set — 481 to CH (which derives to "no
-- transfer needed" and is almost always right, since a Swiss passport at 14
-- overwhelmingly means a Swiss licence) and 128 to a foreign federation, which
-- WILL appear on the Transfers page as needing a transfer. Most of those are
-- expected to be false positives resolved by asking the member; that is the
-- accepted trade for having a worklist at all.
--
-- Uses the FIRST code only — `nationalitaet_codes` is ordered and the first entry
-- is the primary nationality (migration 223), the same one ClubDesk receives.
--
-- Bounded data migration + idempotent.

BEGIN;

UPDATE members m
   SET federation_of_origin = split_part(m.nationalitaet_codes, ',', 1)
 WHERE m.federation_of_origin IS NULL
   AND m.nationalitaet_codes IS NOT NULL
   AND split_part(m.nationalitaet_codes, ',', 1) ~ '^[A-Z]{2}$'
   -- Never write a code the country table does not know: the CHECK would accept
   -- it, but the UI could not render a name for it.
   AND EXISTS (SELECT 1 FROM country_codes c WHERE c.code = split_part(m.nationalitaet_codes, ',', 1));

COMMIT;

SELECT 'foo_set_total' AS metric, count(*)::text AS value FROM members WHERE federation_of_origin IS NOT NULL
UNION ALL SELECT 'foo_ch_no_transfer', count(*)::text FROM members WHERE federation_of_origin = 'CH'
UNION ALL SELECT 'foo_foreign_actionable', count(*)::text FROM members
  WHERE federation_of_origin IS NOT NULL AND federation_of_origin NOT IN ('CH','NONE')
UNION ALL SELECT 'foo_still_null_never_asked', count(*)::text FROM members WHERE federation_of_origin IS NULL
UNION ALL SELECT 'transfer_status_set (must stay 0)', count(*)::text FROM members WHERE transfer_status IS NOT NULL;
