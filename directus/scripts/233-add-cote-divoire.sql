-- Migration 233: add Côte d'Ivoire (CI) to the country tables.
--
-- ⚠ It was never "missing" from the source list — the kscw-website COUNTRIES
-- array has carried it all along. The generator that produced
-- src/utils/countries.generated.ts (and, via it, migration 223's country_codes
-- seed) matched values with `'([^']*)'`, which cannot cross the BACKSLASH-ESCAPED
-- apostrophe in `de: 'Côte d\'Ivoire'` — so the whole entry silently failed to
-- match and vanished, taking the country with it. 196 seeded, 197 in the source.
--
-- The generator regex now tolerates escaped characters, so a future regeneration
-- keeps it. This migration repairs the two DB tables 223/224 seeded from the
-- broken output, and un-flags the corresponding Basketplan option (migration 230
-- listed 'Côte d''Ivoire' as unmapped for exactly this reason — there was no CI
-- row in country_codes to map it TO, not because Basketplan was unclear).
--
-- Nobody currently holds it, so this is purely pre-emptive.
--
-- Schema-only + idempotent.

BEGIN;

INSERT INTO country_codes (code, name_de, name_en, name_de_clubdesk)
VALUES ('CI', 'Côte d''Ivoire', 'Côte d''Ivoire', 'Côte d''Ivoire')
ON CONFLICT (code) DO UPDATE
  SET name_de = EXCLUDED.name_de,
      name_en = EXCLUDED.name_en,
      name_de_clubdesk = COALESCE(country_codes.name_de_clubdesk, EXCLUDED.name_de_clubdesk);

-- Parse-direction spellings, incl. the German exonym and the accent-free form a
-- member is likely to type.
INSERT INTO country_name_aliases (alias, code) VALUES
  ('côte d''ivoire', 'CI'),
  ('cote d''ivoire', 'CI'),
  ('elfenbeinküste', 'CI'),
  ('elfenbeinkueste', 'CI'),
  ('ivory coast', 'CI')
ON CONFLICT (alias) DO UPDATE SET code = EXCLUDED.code;

-- Basketplan's own option can now resolve.
UPDATE basketplan_nations SET iso = 'CI', ambiguous = false
 WHERE label_fr = 'Côte d''Ivoire'
   AND EXISTS (SELECT 1 FROM country_codes c WHERE c.code = 'CI');

COMMIT;

SELECT 'country_codes' AS t, count(*)::text AS n FROM country_codes
UNION ALL SELECT 'ci_aliases', count(*)::text FROM country_name_aliases WHERE code = 'CI'
UNION ALL SELECT 'basketplan_ci', coalesce(max(iso), 'unmapped') FROM basketplan_nations WHERE label_fr = 'Côte d''Ivoire';
