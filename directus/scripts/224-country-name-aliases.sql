-- Migration 224: country-name aliases + ClubDesk wire spellings.
--
-- Fixes forward on 223. Two gaps surfaced when 223 was applied to dev:
--
--   1. One member's stored nationality "Großbritannien" resolved to NO code.
--      The generated country list (from kscw-website) calls GB "Vereinigtes
--      Königreich", but ClubDesk's picklist — and therefore every value the
--      down-sync has ever written — says "Großbritannien". A single canonical
--      German name per country is not enough to parse real-world input.
--
--   2. Consequently, pushing "Vereinigtes Königreich" back at ClubDesk would
--      land the row in its "nicht erkannte" bucket. The code→name direction
--      needs ClubDesk's spelling, which is NOT always the display spelling.
--
-- So: name_de stays the display/canonical German name, name_de_clubdesk becomes
-- the ClubDesk wire format (identical for 195 of 196 countries), and a separate
-- alias table absorbs every other spelling we might have to parse.
--
-- Schema-only + idempotent.

BEGIN;

-- ── 1. ClubDesk wire spelling ────────────────────────────────────────────────
ALTER TABLE country_codes
  ADD COLUMN IF NOT EXISTS name_de_clubdesk text;

COMMENT ON COLUMN country_codes.name_de_clubdesk IS
  'Exact value ClubDesk''s Nationalität / Federation of Origin picklists expect. Defaults to name_de; overridden only where ClubDesk''s spelling differs (verified against clubdesk_export).';

UPDATE country_codes SET name_de_clubdesk = name_de WHERE name_de_clubdesk IS NULL;

INSERT INTO country_codes (code, name_de, name_en, name_de_clubdesk)
SELECT c.code, c.name_de, c.name_en, o.cd_name
  FROM (VALUES
  ('GB', 'Großbritannien')
  ) AS o(code, cd_name)
  JOIN country_codes c ON c.code = o.code
ON CONFLICT (code) DO UPDATE SET name_de_clubdesk = EXCLUDED.name_de_clubdesk;

ALTER TABLE country_codes ALTER COLUMN name_de_clubdesk SET NOT NULL;

-- ── 2. Alias table ───────────────────────────────────────────────────────────
-- Every German/English spelling we may have to parse, from countryCodes.ts plus
-- ClubDesk and colloquial variants (USA, Holland, England, Weissrussland, …).
CREATE TABLE IF NOT EXISTS country_name_aliases (
  alias text PRIMARY KEY,
  code  varchar(2) NOT NULL REFERENCES country_codes(code) ON DELETE CASCADE
);

COMMENT ON TABLE country_name_aliases IS
  'Lowercased country-name spellings → ISO alpha-2. Parse direction only; never use for display or for the ClubDesk push (that is country_codes.name_de_clubdesk).';

INSERT INTO country_name_aliases (alias, code) VALUES
  ('afghanistan', 'AF'),
  ('ägypten', 'EG'),
  ('albania', 'AL'),
  ('albanien', 'AL'),
  ('algeria', 'DZ'),
  ('algerien', 'DZ'),
  ('amerika', 'US'),
  ('andorra', 'AD'),
  ('angola', 'AO'),
  ('antigua and barbuda', 'AG'),
  ('antigua und barbuda', 'AG'),
  ('äquatorialguinea', 'GQ'),
  ('argentina', 'AR'),
  ('argentinien', 'AR'),
  ('armenia', 'AM'),
  ('armenien', 'AM'),
  ('aserbaidschan', 'AZ'),
  ('äthiopien', 'ET'),
  ('australia', 'AU'),
  ('australien', 'AU'),
  ('austria', 'AT'),
  ('azerbaijan', 'AZ'),
  ('bahamas', 'BS'),
  ('bahrain', 'BH'),
  ('bangladesch', 'BD'),
  ('bangladesh', 'BD'),
  ('barbados', 'BB'),
  ('belarus', 'BY'),
  ('belgien', 'BE'),
  ('belgium', 'BE'),
  ('belize', 'BZ'),
  ('benin', 'BJ'),
  ('bhutan', 'BT'),
  ('birma', 'MM'),
  ('bolivia', 'BO'),
  ('bolivien', 'BO'),
  ('bosnia and herzegovina', 'BA'),
  ('bosnien und herzegowina', 'BA'),
  ('botswana', 'BW'),
  ('brasilien', 'BR'),
  ('brazil', 'BR'),
  ('brunei', 'BN'),
  ('bulgaria', 'BG'),
  ('bulgarien', 'BG'),
  ('burkina faso', 'BF'),
  ('burma', 'MM'),
  ('burundi', 'BI'),
  ('cambodia', 'KH'),
  ('cameroon', 'CM'),
  ('canada', 'CA'),
  ('cape verde', 'CV'),
  ('central african republic', 'CF'),
  ('chad', 'TD'),
  ('chile', 'CL'),
  ('china', 'CN'),
  ('colombia', 'CO'),
  ('comoros', 'KM'),
  ('congo (drc)', 'CD'),
  ('congo (republic)', 'CG'),
  ('costa rica', 'CR'),
  ('croatia', 'HR'),
  ('cuba', 'CU'),
  ('cyprus', 'CY'),
  ('czech republic', 'CZ'),
  ('czechia', 'CZ'),
  ('dänemark', 'DK'),
  ('denmark', 'DK'),
  ('deutschland', 'DE'),
  ('djibouti', 'DJ'),
  ('dominica', 'DM'),
  ('dominican republic', 'DO'),
  ('dominikanische republik', 'DO'),
  ('dschibuti', 'DJ'),
  ('east timor', 'TL'),
  ('ecuador', 'EC'),
  ('egypt', 'EG'),
  ('el salvador', 'SV'),
  ('england', 'GB'),
  ('equatorial guinea', 'GQ'),
  ('eritrea', 'ER'),
  ('estland', 'EE'),
  ('estonia', 'EE'),
  ('eswatini', 'SZ'),
  ('ethiopia', 'ET'),
  ('fidschi', 'FJ'),
  ('fiji', 'FJ'),
  ('finland', 'FI'),
  ('finnland', 'FI'),
  ('france', 'FR'),
  ('frankreich', 'FR'),
  ('gabon', 'GA'),
  ('gabun', 'GA'),
  ('gambia', 'GM'),
  ('georgia', 'GE'),
  ('georgien', 'GE'),
  ('germany', 'DE'),
  ('ghana', 'GH'),
  ('great britain', 'GB'),
  ('greece', 'GR'),
  ('grenada', 'GD'),
  ('griechenland', 'GR'),
  ('grossbritannien', 'GB'),
  ('großbritannien', 'GB'),
  ('guatemala', 'GT'),
  ('guinea', 'GN'),
  ('guinea-bissau', 'GW'),
  ('guyana', 'GY'),
  ('haiti', 'HT'),
  ('holland', 'NL'),
  ('honduras', 'HN'),
  ('hungary', 'HU'),
  ('iceland', 'IS'),
  ('india', 'IN'),
  ('indien', 'IN'),
  ('indonesia', 'ID'),
  ('indonesien', 'ID'),
  ('irak', 'IQ'),
  ('iran', 'IR'),
  ('iraq', 'IQ'),
  ('ireland', 'IE'),
  ('irland', 'IE'),
  ('island', 'IS'),
  ('israel', 'IL'),
  ('italien', 'IT'),
  ('italy', 'IT'),
  ('jamaica', 'JM'),
  ('jamaika', 'JM'),
  ('japan', 'JP'),
  ('jemen', 'YE'),
  ('jordan', 'JO'),
  ('jordanien', 'JO'),
  ('kambodscha', 'KH'),
  ('kamerun', 'CM'),
  ('kanada', 'CA'),
  ('kap verde', 'CV'),
  ('kapverden', 'CV'),
  ('kasachstan', 'KZ'),
  ('katar', 'QA'),
  ('kazakhstan', 'KZ'),
  ('kenia', 'KE'),
  ('kenya', 'KE'),
  ('kirgisistan', 'KG'),
  ('kiribati', 'KI'),
  ('kolumbien', 'CO'),
  ('komoren', 'KM'),
  ('kongo (dem. rep.)', 'CD'),
  ('kongo (rep.)', 'CG'),
  ('kosovo', 'XK'),
  ('kroatien', 'HR'),
  ('kuba', 'CU'),
  ('kuwait', 'KW'),
  ('kyrgyzstan', 'KG'),
  ('laos', 'LA'),
  ('latvia', 'LV'),
  ('lebanon', 'LB'),
  ('lesotho', 'LS'),
  ('lettland', 'LV'),
  ('libanon', 'LB'),
  ('liberia', 'LR'),
  ('libya', 'LY'),
  ('libyen', 'LY'),
  ('liechtenstein', 'LI'),
  ('litauen', 'LT'),
  ('lithuania', 'LT'),
  ('luxembourg', 'LU'),
  ('luxemburg', 'LU'),
  ('macedonia', 'MK'),
  ('madagascar', 'MG'),
  ('madagaskar', 'MG'),
  ('malawi', 'MW'),
  ('malaysia', 'MY'),
  ('maldives', 'MV'),
  ('malediven', 'MV'),
  ('mali', 'ML'),
  ('malta', 'MT'),
  ('marokko', 'MA'),
  ('marshall islands', 'MH'),
  ('marshallinseln', 'MH'),
  ('mauretanien', 'MR'),
  ('mauritania', 'MR'),
  ('mauritius', 'MU'),
  ('mazedonien', 'MK'),
  ('mexico', 'MX'),
  ('mexiko', 'MX'),
  ('micronesia', 'FM'),
  ('mikronesien', 'FM'),
  ('moldau', 'MD'),
  ('moldova', 'MD'),
  ('monaco', 'MC'),
  ('mongolei', 'MN'),
  ('mongolia', 'MN'),
  ('montenegro', 'ME'),
  ('morocco', 'MA'),
  ('mosambik', 'MZ'),
  ('mozambique', 'MZ'),
  ('myanmar', 'MM'),
  ('namibia', 'NA'),
  ('nauru', 'NR'),
  ('nepal', 'NP'),
  ('netherlands', 'NL'),
  ('neuseeland', 'NZ'),
  ('new zealand', 'NZ'),
  ('nicaragua', 'NI'),
  ('niederlande', 'NL'),
  ('niger', 'NE'),
  ('nigeria', 'NG'),
  ('nordirland', 'GB'),
  ('nordkorea', 'KP'),
  ('nordmazedonien', 'MK'),
  ('north korea', 'KP'),
  ('north macedonia', 'MK'),
  ('norway', 'NO'),
  ('norwegen', 'NO'),
  ('oman', 'OM'),
  ('österreich', 'AT'),
  ('osttimor', 'TL'),
  ('pakistan', 'PK'),
  ('palästina', 'PS'),
  ('palau', 'PW'),
  ('palestine', 'PS'),
  ('panama', 'PA'),
  ('papua new guinea', 'PG'),
  ('papua-neuguinea', 'PG'),
  ('paraguay', 'PY'),
  ('peru', 'PE'),
  ('philippinen', 'PH'),
  ('philippines', 'PH'),
  ('poland', 'PL'),
  ('polen', 'PL'),
  ('portugal', 'PT'),
  ('qatar', 'QA'),
  ('romania', 'RO'),
  ('ruanda', 'RW'),
  ('rumänien', 'RO'),
  ('russia', 'RU'),
  ('russland', 'RU'),
  ('rwanda', 'RW'),
  ('saint kitts and nevis', 'KN'),
  ('saint lucia', 'LC'),
  ('saint vincent and the grenadines', 'VC'),
  ('salomonen', 'SB'),
  ('sambia', 'ZM'),
  ('samoa', 'WS'),
  ('san marino', 'SM'),
  ('são tomé and príncipe', 'ST'),
  ('são tomé und príncipe', 'ST'),
  ('saudi arabia', 'SA'),
  ('saudi-arabien', 'SA'),
  ('schottland', 'GB'),
  ('schweden', 'SE'),
  ('schweiz', 'CH'),
  ('senegal', 'SN'),
  ('serbia', 'RS'),
  ('serbien', 'RS'),
  ('seychellen', 'SC'),
  ('seychelles', 'SC'),
  ('sierra leone', 'SL'),
  ('simbabwe', 'ZW'),
  ('singapore', 'SG'),
  ('singapur', 'SG'),
  ('slovakia', 'SK'),
  ('slovenia', 'SI'),
  ('slowakei', 'SK'),
  ('slowenien', 'SI'),
  ('solomon islands', 'SB'),
  ('somalia', 'SO'),
  ('south africa', 'ZA'),
  ('south korea', 'KR'),
  ('south sudan', 'SS'),
  ('spain', 'ES'),
  ('spanien', 'ES'),
  ('sri lanka', 'LK'),
  ('st. kitts und nevis', 'KN'),
  ('st. lucia', 'LC'),
  ('st. vincent und die grenadinen', 'VC'),
  ('südafrika', 'ZA'),
  ('sudan', 'SD'),
  ('südkorea', 'KR'),
  ('südsudan', 'SS'),
  ('suriname', 'SR'),
  ('swasiland', 'SZ'),
  ('swaziland', 'SZ'),
  ('sweden', 'SE'),
  ('switzerland', 'CH'),
  ('syria', 'SY'),
  ('syrien', 'SY'),
  ('tadschikistan', 'TJ'),
  ('taiwan', 'TW'),
  ('tajikistan', 'TJ'),
  ('tansania', 'TZ'),
  ('tanzania', 'TZ'),
  ('thailand', 'TH'),
  ('the netherlands', 'NL'),
  ('timor-leste', 'TL'),
  ('togo', 'TG'),
  ('tonga', 'TO'),
  ('trinidad and tobago', 'TT'),
  ('trinidad und tobago', 'TT'),
  ('tschad', 'TD'),
  ('tschechien', 'CZ'),
  ('tschechische republik', 'CZ'),
  ('tuerkei', 'TR'),
  ('tunesien', 'TN'),
  ('tunisia', 'TN'),
  ('türkei', 'TR'),
  ('turkey', 'TR'),
  ('turkmenistan', 'TM'),
  ('tuvalu', 'TV'),
  ('uganda', 'UG'),
  ('uk', 'GB'),
  ('ukraine', 'UA'),
  ('ungarn', 'HU'),
  ('united arab emirates', 'AE'),
  ('united kingdom', 'GB'),
  ('united states', 'US'),
  ('united states of america', 'US'),
  ('uruguay', 'UY'),
  ('usa', 'US'),
  ('usbekistan', 'UZ'),
  ('uzbekistan', 'UZ'),
  ('vanuatu', 'VU'),
  ('vatican city', 'VA'),
  ('vatikanstadt', 'VA'),
  ('venezuela', 'VE'),
  ('vereinigte arabische emirate', 'AE'),
  ('vereinigte staaten', 'US'),
  ('vereinigte staaten von amerika', 'US'),
  ('vereinigtes königreich', 'GB'),
  ('vietnam', 'VN'),
  ('wales', 'GB'),
  ('weissrussland', 'BY'),
  ('weißrussland', 'BY'),
  ('yemen', 'YE'),
  ('zambia', 'ZM'),
  ('zentralafrikanische republik', 'CF'),
  ('zimbabwe', 'ZW'),
  ('zypern', 'CY')
ON CONFLICT (alias) DO UPDATE SET code = EXCLUDED.code;

-- The canonical names are aliases of themselves.
INSERT INTO country_name_aliases (alias, code)
SELECT lower(name_de), code FROM country_codes ON CONFLICT (alias) DO NOTHING;
INSERT INTO country_name_aliases (alias, code)
SELECT lower(name_en), code FROM country_codes ON CONFLICT (alias) DO NOTHING;
INSERT INTO country_name_aliases (alias, code)
SELECT lower(name_de_clubdesk), code FROM country_codes ON CONFLICT (alias) DO NOTHING;

-- ── 3. Trigger now parses via aliases and emits the ClubDesk spelling ────────
CREATE OR REPLACE FUNCTION members_sync_nationality() RETURNS trigger AS $fn$
DECLARE
  first_code text;
  resolved   text;
BEGIN
  IF (TG_OP = 'INSERT' AND NULLIF(btrim(COALESCE(NEW.nationalitaet_codes, '')), '') IS NOT NULL)
     OR (TG_OP = 'UPDATE' AND NEW.nationalitaet_codes IS DISTINCT FROM OLD.nationalitaet_codes) THEN
    first_code := upper(btrim(split_part(COALESCE(NEW.nationalitaet_codes, ''), ',', 1)));
    IF first_code = '' THEN
      NEW.nationalitaet := NULL;
    ELSE
      SELECT name_de_clubdesk INTO resolved FROM country_codes WHERE code = first_code;
      IF resolved IS NOT NULL THEN
        NEW.nationalitaet := resolved;
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  IF (TG_OP = 'INSERT' AND NULLIF(btrim(COALESCE(NEW.nationalitaet, '')), '') IS NOT NULL)
     OR (TG_OP = 'UPDATE' AND NEW.nationalitaet IS DISTINCT FROM OLD.nationalitaet) THEN
    SELECT code INTO resolved FROM country_name_aliases
      WHERE alias = lower(btrim(COALESCE(NEW.nationalitaet, '')));
    IF resolved IS NOT NULL THEN
      NEW.nationalitaet_codes := resolved;
      NEW.nationalitaet := (SELECT name_de_clubdesk FROM country_codes WHERE code = resolved);
    END IF;
  END IF;

  RETURN NEW;
END $fn$ LANGUAGE plpgsql;

-- ── 4. Re-run the backfill for rows 223 could not resolve ───────────────────
UPDATE members m
   SET nationalitaet_codes = a.code
  FROM country_name_aliases a
 WHERE m.nationalitaet_codes IS NULL
   AND NULLIF(btrim(COALESCE(m.nationalitaet, '')), '') IS NOT NULL
   AND a.alias = lower(btrim(m.nationalitaet));

UPDATE registrations r
   SET nationalitaet_codes = a.code
  FROM country_name_aliases a
 WHERE r.nationalitaet_codes IS NULL
   AND NULLIF(btrim(COALESCE(r.nationalitaet, '')), '') IS NOT NULL
   AND a.alias = lower(btrim(r.nationalitaet));

COMMIT;

-- After applying: regenerate directus/scripts/SCHEMA.sql via `npm run db:baseline:prod`.
