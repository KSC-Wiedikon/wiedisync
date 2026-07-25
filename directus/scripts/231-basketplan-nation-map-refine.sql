-- Migration 231: resolve Basketplan nation options that migration 230 left flagged.
--
-- 230 mapped 180 of 296 options and deliberately flagged the rest rather than
-- guess. Running the real scrape (256 people) showed the flagging was too broad:
-- the only two members it actually blocked were "République tchèque" and
-- "République islamique d'Iran" — not ambiguous at all, just FIBA-style French
-- names that CLDR does not emit and my alias table had missed. Flagging them was
-- the right default; leaving them flagged now that they are known would be lazy.
--
-- Also resolves four legacy abbreviation options with a single unambiguous
-- reading: D / ALL / BRD = Germany, A = Austria. `D` matters in practice — one
-- member (Fürstenwerth) carries Suisse + D as a dual nationality.
--
-- ⚠ STILL FLAGGED ON PURPOSE, do not "finish the job" here:
--   • MAC  — Macedonia or Macao? A real member (Scalese) carries it as nation_2,
--            so a guess would put a wrong nationality on a real person.
--   • YUG, 'Serbie et Monténegro', 'République populaire' — historical entities
--            with no current ISO 3166-1 alpha-2 code.
--   • Aruba, Bermudes, Guam, Palau*, Porto Rico, the Virgin/Cayman/Cook Islands,
--            Samoa américaines, Antilles néerlandaises, Hong-Kong, Côte d'Ivoire —
--            absent from our own 196-country list (src/utils/countries.generated.ts
--            + country_codes), so there is nothing valid to map them TO. The
--            members.nationalitaet_codes CHECK would accept the code, but the
--            trigger could not derive a German name for ClubDesk and
--            countryLabel() would render the raw code.
--
-- ⚠ Côte d'Ivoire is a genuine GAP IN OUR OWN LIST, not a Basketplan quirk — the
-- kscw-website country list has no CI entry at all. No member is affected today.
-- Fixing it means regenerating countries.generated.ts and re-seeding
-- country_codes; deliberately out of scope here.
--
-- Schema-only + idempotent.

BEGIN;

UPDATE basketplan_nations SET iso = v.iso, ambiguous = false
  FROM (VALUES
    ('République tchèque',                          'CZ'),
    ('République islamique d''Iran',                'IR'),
    ('Vietnam',                                     'VN'),
    ('Swaziland',                                   'SZ'),
    ('République-Unie de Tanzanie',                 'TZ'),
    ('République démocratique Populaire Lao',       'LA'),
    ('République populaire démocratique de Corée',  'KP'),
    ('Ex-République yougoslave de Macédonie',       'MK'),
    ('Palau',                                       'PW'),
    -- Legacy abbreviation options that coexist beside the proper names.
    ('D',   'DE'),
    ('ALL', 'DE'),
    ('BRD', 'DE'),
    ('A',   'AT')
  ) AS v(label, iso)
 WHERE basketplan_nations.label_fr = v.label
   AND EXISTS (SELECT 1 FROM country_codes c WHERE c.code = v.iso);

COMMIT;

-- Report what a fill would still skip, so the residue stays visible.
SELECT 'still_ambiguous_options' AS metric, count(*) AS value
  FROM basketplan_nations WHERE ambiguous;
