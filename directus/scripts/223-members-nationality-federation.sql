-- Migration 223: coded nationality (multi) + federation of origin on members
-- and registrations.
--
-- WHY
-- `members.nationalitaet` was free-text varchar(100) holding an ALREADY-GERMAN
-- ClubDesk picklist value ("Schweiz", "Italien"). That made it (a) untranslatable
-- for the ~non-German UI locales, (b) single-valued, and (c) silently breakable —
-- two prod rows held English names ("Italy", "Switzerland") which ClubDesk's
-- import drops into its "nicht erkannte" bucket.
--
-- This migration introduces ISO 3166-1 alpha-2 codes as the canonical value and
-- DEMOTES `nationalitaet` to a derived, ClubDesk-facing mirror of the FIRST code.
-- `nationalitaet` is deliberately kept (not dropped): the whole ClubDesk push /
-- drift / echo apparatus reads it, and a trigger now guarantees it can never
-- diverge from the codes no matter which of the four write paths touches the row
-- (profile edit, admin explorer, ClubDesk down-sync, registration approval).
--
-- Federation of origin is the national federation a player was last licensed
-- with — the Swiss Volley transfer-certificate / FIBA letter-of-clearance key.
-- Stored as an ISO code, the sentinel 'NONE' ("never licensed elsewhere"), or
-- NULL ("not answered"). NULL vs 'NONE' is a real distinction: only an explicit
-- 'NONE' lets us skip a clearance chase.
--
-- Schema-only + idempotent (repo rule: permissions live in setup-permissions.mjs).

BEGIN;

-- ── 1. Country lookup ────────────────────────────────────────────────────────
-- Seeded from the kscw-website country list (public/js/registration-form.js),
-- which is also what seeded ClubDesk's picklists — so name_de is the exact wire
-- format ClubDesk expects. 7 of these differ from Intl/CLDR's German spelling
-- (Botswana vs Botsuana, Moldau vs Republik Moldau, …); do not "fix" them.
CREATE TABLE IF NOT EXISTS country_codes (
  code    varchar(2) PRIMARY KEY,
  name_de text NOT NULL,
  name_en text NOT NULL
);

INSERT INTO country_codes (code, name_de, name_en) VALUES
  ('AD', 'Andorra', 'Andorra'),
  ('AE', 'Vereinigte Arabische Emirate', 'United Arab Emirates'),
  ('AF', 'Afghanistan', 'Afghanistan'),
  ('AG', 'Antigua und Barbuda', 'Antigua and Barbuda'),
  ('AL', 'Albanien', 'Albania'),
  ('AM', 'Armenien', 'Armenia'),
  ('AO', 'Angola', 'Angola'),
  ('AR', 'Argentinien', 'Argentina'),
  ('AT', 'Österreich', 'Austria'),
  ('AU', 'Australien', 'Australia'),
  ('AZ', 'Aserbaidschan', 'Azerbaijan'),
  ('BA', 'Bosnien und Herzegowina', 'Bosnia and Herzegovina'),
  ('BB', 'Barbados', 'Barbados'),
  ('BD', 'Bangladesch', 'Bangladesh'),
  ('BE', 'Belgien', 'Belgium'),
  ('BF', 'Burkina Faso', 'Burkina Faso'),
  ('BG', 'Bulgarien', 'Bulgaria'),
  ('BH', 'Bahrain', 'Bahrain'),
  ('BI', 'Burundi', 'Burundi'),
  ('BJ', 'Benin', 'Benin'),
  ('BN', 'Brunei', 'Brunei'),
  ('BO', 'Bolivien', 'Bolivia'),
  ('BR', 'Brasilien', 'Brazil'),
  ('BS', 'Bahamas', 'Bahamas'),
  ('BT', 'Bhutan', 'Bhutan'),
  ('BW', 'Botswana', 'Botswana'),
  ('BY', 'Belarus', 'Belarus'),
  ('BZ', 'Belize', 'Belize'),
  ('CA', 'Kanada', 'Canada'),
  ('CD', 'Kongo (Dem. Rep.)', 'Congo (DRC)'),
  ('CF', 'Zentralafrikanische Republik', 'Central African Republic'),
  ('CG', 'Kongo (Rep.)', 'Congo (Republic)'),
  ('CH', 'Schweiz', 'Switzerland'),
  ('CL', 'Chile', 'Chile'),
  ('CM', 'Kamerun', 'Cameroon'),
  ('CN', 'China', 'China'),
  ('CO', 'Kolumbien', 'Colombia'),
  ('CR', 'Costa Rica', 'Costa Rica'),
  ('CU', 'Kuba', 'Cuba'),
  ('CV', 'Kap Verde', 'Cape Verde'),
  ('CY', 'Zypern', 'Cyprus'),
  ('CZ', 'Tschechien', 'Czech Republic'),
  ('DE', 'Deutschland', 'Germany'),
  ('DJ', 'Dschibuti', 'Djibouti'),
  ('DK', 'Dänemark', 'Denmark'),
  ('DM', 'Dominica', 'Dominica'),
  ('DO', 'Dominikanische Republik', 'Dominican Republic'),
  ('DZ', 'Algerien', 'Algeria'),
  ('EC', 'Ecuador', 'Ecuador'),
  ('EE', 'Estland', 'Estonia'),
  ('EG', 'Ägypten', 'Egypt'),
  ('ER', 'Eritrea', 'Eritrea'),
  ('ES', 'Spanien', 'Spain'),
  ('ET', 'Äthiopien', 'Ethiopia'),
  ('FI', 'Finnland', 'Finland'),
  ('FJ', 'Fidschi', 'Fiji'),
  ('FM', 'Mikronesien', 'Micronesia'),
  ('FR', 'Frankreich', 'France'),
  ('GA', 'Gabun', 'Gabon'),
  ('GB', 'Vereinigtes Königreich', 'United Kingdom'),
  ('GD', 'Grenada', 'Grenada'),
  ('GE', 'Georgien', 'Georgia'),
  ('GH', 'Ghana', 'Ghana'),
  ('GM', 'Gambia', 'Gambia'),
  ('GN', 'Guinea', 'Guinea'),
  ('GQ', 'Äquatorialguinea', 'Equatorial Guinea'),
  ('GR', 'Griechenland', 'Greece'),
  ('GT', 'Guatemala', 'Guatemala'),
  ('GW', 'Guinea-Bissau', 'Guinea-Bissau'),
  ('GY', 'Guyana', 'Guyana'),
  ('HN', 'Honduras', 'Honduras'),
  ('HR', 'Kroatien', 'Croatia'),
  ('HT', 'Haiti', 'Haiti'),
  ('HU', 'Ungarn', 'Hungary'),
  ('ID', 'Indonesien', 'Indonesia'),
  ('IE', 'Irland', 'Ireland'),
  ('IL', 'Israel', 'Israel'),
  ('IN', 'Indien', 'India'),
  ('IQ', 'Irak', 'Iraq'),
  ('IR', 'Iran', 'Iran'),
  ('IS', 'Island', 'Iceland'),
  ('IT', 'Italien', 'Italy'),
  ('JM', 'Jamaika', 'Jamaica'),
  ('JO', 'Jordanien', 'Jordan'),
  ('JP', 'Japan', 'Japan'),
  ('KE', 'Kenia', 'Kenya'),
  ('KG', 'Kirgisistan', 'Kyrgyzstan'),
  ('KH', 'Kambodscha', 'Cambodia'),
  ('KI', 'Kiribati', 'Kiribati'),
  ('KM', 'Komoren', 'Comoros'),
  ('KN', 'St. Kitts und Nevis', 'Saint Kitts and Nevis'),
  ('KP', 'Nordkorea', 'North Korea'),
  ('KR', 'Südkorea', 'South Korea'),
  ('KW', 'Kuwait', 'Kuwait'),
  ('KZ', 'Kasachstan', 'Kazakhstan'),
  ('LA', 'Laos', 'Laos'),
  ('LB', 'Libanon', 'Lebanon'),
  ('LC', 'St. Lucia', 'Saint Lucia'),
  ('LI', 'Liechtenstein', 'Liechtenstein'),
  ('LK', 'Sri Lanka', 'Sri Lanka'),
  ('LR', 'Liberia', 'Liberia'),
  ('LS', 'Lesotho', 'Lesotho'),
  ('LT', 'Litauen', 'Lithuania'),
  ('LU', 'Luxemburg', 'Luxembourg'),
  ('LV', 'Lettland', 'Latvia'),
  ('LY', 'Libyen', 'Libya'),
  ('MA', 'Marokko', 'Morocco'),
  ('MC', 'Monaco', 'Monaco'),
  ('MD', 'Moldau', 'Moldova'),
  ('ME', 'Montenegro', 'Montenegro'),
  ('MG', 'Madagaskar', 'Madagascar'),
  ('MH', 'Marshallinseln', 'Marshall Islands'),
  ('MK', 'Nordmazedonien', 'North Macedonia'),
  ('ML', 'Mali', 'Mali'),
  ('MM', 'Myanmar', 'Myanmar'),
  ('MN', 'Mongolei', 'Mongolia'),
  ('MR', 'Mauretanien', 'Mauritania'),
  ('MT', 'Malta', 'Malta'),
  ('MU', 'Mauritius', 'Mauritius'),
  ('MV', 'Malediven', 'Maldives'),
  ('MW', 'Malawi', 'Malawi'),
  ('MX', 'Mexiko', 'Mexico'),
  ('MY', 'Malaysia', 'Malaysia'),
  ('MZ', 'Mosambik', 'Mozambique'),
  ('NA', 'Namibia', 'Namibia'),
  ('NE', 'Niger', 'Niger'),
  ('NG', 'Nigeria', 'Nigeria'),
  ('NI', 'Nicaragua', 'Nicaragua'),
  ('NL', 'Niederlande', 'Netherlands'),
  ('NO', 'Norwegen', 'Norway'),
  ('NP', 'Nepal', 'Nepal'),
  ('NR', 'Nauru', 'Nauru'),
  ('NZ', 'Neuseeland', 'New Zealand'),
  ('OM', 'Oman', 'Oman'),
  ('PA', 'Panama', 'Panama'),
  ('PE', 'Peru', 'Peru'),
  ('PG', 'Papua-Neuguinea', 'Papua New Guinea'),
  ('PH', 'Philippinen', 'Philippines'),
  ('PK', 'Pakistan', 'Pakistan'),
  ('PL', 'Polen', 'Poland'),
  ('PS', 'Palästina', 'Palestine'),
  ('PT', 'Portugal', 'Portugal'),
  ('PW', 'Palau', 'Palau'),
  ('PY', 'Paraguay', 'Paraguay'),
  ('QA', 'Katar', 'Qatar'),
  ('RO', 'Rumänien', 'Romania'),
  ('RS', 'Serbien', 'Serbia'),
  ('RU', 'Russland', 'Russia'),
  ('RW', 'Ruanda', 'Rwanda'),
  ('SA', 'Saudi-Arabien', 'Saudi Arabia'),
  ('SB', 'Salomonen', 'Solomon Islands'),
  ('SC', 'Seychellen', 'Seychelles'),
  ('SD', 'Sudan', 'Sudan'),
  ('SE', 'Schweden', 'Sweden'),
  ('SG', 'Singapur', 'Singapore'),
  ('SI', 'Slowenien', 'Slovenia'),
  ('SK', 'Slowakei', 'Slovakia'),
  ('SL', 'Sierra Leone', 'Sierra Leone'),
  ('SM', 'San Marino', 'San Marino'),
  ('SN', 'Senegal', 'Senegal'),
  ('SO', 'Somalia', 'Somalia'),
  ('SR', 'Suriname', 'Suriname'),
  ('SS', 'Südsudan', 'South Sudan'),
  ('ST', 'São Tomé und Príncipe', 'São Tomé and Príncipe'),
  ('SV', 'El Salvador', 'El Salvador'),
  ('SY', 'Syrien', 'Syria'),
  ('SZ', 'Eswatini', 'Eswatini'),
  ('TD', 'Tschad', 'Chad'),
  ('TG', 'Togo', 'Togo'),
  ('TH', 'Thailand', 'Thailand'),
  ('TJ', 'Tadschikistan', 'Tajikistan'),
  ('TL', 'Timor-Leste', 'Timor-Leste'),
  ('TM', 'Turkmenistan', 'Turkmenistan'),
  ('TN', 'Tunesien', 'Tunisia'),
  ('TO', 'Tonga', 'Tonga'),
  ('TR', 'Türkei', 'Turkey'),
  ('TT', 'Trinidad und Tobago', 'Trinidad and Tobago'),
  ('TV', 'Tuvalu', 'Tuvalu'),
  ('TW', 'Taiwan', 'Taiwan'),
  ('TZ', 'Tansania', 'Tanzania'),
  ('UA', 'Ukraine', 'Ukraine'),
  ('UG', 'Uganda', 'Uganda'),
  ('US', 'Vereinigte Staaten', 'United States'),
  ('UY', 'Uruguay', 'Uruguay'),
  ('UZ', 'Usbekistan', 'Uzbekistan'),
  ('VA', 'Vatikanstadt', 'Vatican City'),
  ('VC', 'St. Vincent und die Grenadinen', 'Saint Vincent and the Grenadines'),
  ('VE', 'Venezuela', 'Venezuela'),
  ('VN', 'Vietnam', 'Vietnam'),
  ('VU', 'Vanuatu', 'Vanuatu'),
  ('WS', 'Samoa', 'Samoa'),
  ('XK', 'Kosovo', 'Kosovo'),
  ('YE', 'Jemen', 'Yemen'),
  ('ZA', 'Südafrika', 'South Africa'),
  ('ZM', 'Sambia', 'Zambia'),
  ('ZW', 'Simbabwe', 'Zimbabwe')
ON CONFLICT (code) DO UPDATE SET name_de = EXCLUDED.name_de, name_en = EXCLUDED.name_en;

CREATE INDEX IF NOT EXISTS country_codes_name_de_lower_idx ON country_codes (lower(name_de));
CREATE INDEX IF NOT EXISTS country_codes_name_en_lower_idx ON country_codes (lower(name_en));

-- ── 2. Columns ───────────────────────────────────────────────────────────────
ALTER TABLE members
  ADD COLUMN IF NOT EXISTS nationalitaet_codes  varchar(200),
  ADD COLUMN IF NOT EXISTS federation_of_origin varchar(8);

COMMENT ON COLUMN members.nationalitaet_codes IS
  'Canonical nationality: ordered, comma-separated ISO 3166-1 alpha-2 codes ("CH,IT"). The FIRST code is primary and is what members.nationalitaet mirrors for ClubDesk (whose field is single-valued).';
COMMENT ON COLUMN members.nationalitaet IS
  'DERIVED — German display name of the first code in nationalitaet_codes. Kept because the ClubDesk push/drift/echo path reads it. Maintained by trigger members_sync_nationality_trg; do not write it directly.';
COMMENT ON COLUMN members.federation_of_origin IS
  'National federation the member was last licensed with (Swiss Volley transfer certificate / FIBA letter of clearance). ISO 3166-1 alpha-2, or ''NONE'' = never licensed elsewhere, or NULL = not answered.';

ALTER TABLE registrations
  ADD COLUMN IF NOT EXISTS nationalitaet_codes  varchar(200),
  ADD COLUMN IF NOT EXISTS federation_of_origin varchar(8);

COMMENT ON COLUMN registrations.nationalitaet_codes IS
  'Ordered, comma-separated ISO 3166-1 alpha-2 codes from the public form. nationalitaet_code (singular, migration 161) stays as the primary/first code so the BB required-document gate keeps working unchanged.';
COMMENT ON COLUMN registrations.federation_of_origin IS
  'Federation of origin from the public form. ISO alpha-2, ''NONE'', or NULL.';

-- Format guards. A CHECK cannot subquery country_codes, so this validates shape
-- only — membership is enforced by the application + the trigger below.
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'members_nationalitaet_codes_fmt') THEN
    ALTER TABLE members ADD CONSTRAINT members_nationalitaet_codes_fmt
      CHECK (nationalitaet_codes IS NULL OR nationalitaet_codes ~ '^[A-Z]{2}(,[A-Z]{2})*$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'members_federation_of_origin_fmt') THEN
    ALTER TABLE members ADD CONSTRAINT members_federation_of_origin_fmt
      CHECK (federation_of_origin IS NULL OR federation_of_origin = 'NONE' OR federation_of_origin ~ '^[A-Z]{2}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'registrations_nationalitaet_codes_fmt') THEN
    ALTER TABLE registrations ADD CONSTRAINT registrations_nationalitaet_codes_fmt
      CHECK (nationalitaet_codes IS NULL OR nationalitaet_codes ~ '^[A-Z]{2}(,[A-Z]{2})*$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'registrations_federation_of_origin_fmt') THEN
    ALTER TABLE registrations ADD CONSTRAINT registrations_federation_of_origin_fmt
      CHECK (federation_of_origin IS NULL OR federation_of_origin = 'NONE' OR federation_of_origin ~ '^[A-Z]{2}$');
  END IF;
END $do$;

-- ClubDesk down-sync staging (migration 064) gains the new custom column.
ALTER TABLE clubdesk_export
  ADD COLUMN IF NOT EXISTS federation_of_origin text;

-- ── 3. Keep members.nationalitaet in lockstep with the codes ─────────────────
-- Bidirectional so that every write path lands correct data:
--   codes written  → nationalitaet := German name of the first code   (authoritative)
--   name written   → codes := that country's code                      (legacy/down-sync fill)
-- Codes win when both change in one statement.
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
      SELECT name_de INTO resolved FROM country_codes WHERE code = first_code;
      IF resolved IS NOT NULL THEN
        NEW.nationalitaet := resolved;
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  IF (TG_OP = 'INSERT' AND NULLIF(btrim(COALESCE(NEW.nationalitaet, '')), '') IS NOT NULL)
     OR (TG_OP = 'UPDATE' AND NEW.nationalitaet IS DISTINCT FROM OLD.nationalitaet) THEN
    SELECT code INTO resolved FROM country_codes
      WHERE lower(name_de) = lower(btrim(COALESCE(NEW.nationalitaet, '')))
         OR lower(name_en) = lower(btrim(COALESCE(NEW.nationalitaet, '')))
      LIMIT 1;
    IF resolved IS NOT NULL THEN
      NEW.nationalitaet_codes := resolved;
      NEW.nationalitaet := (SELECT name_de FROM country_codes WHERE code = resolved);
    END IF;
  END IF;

  RETURN NEW;
END $fn$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS members_sync_nationality_trg ON members;
CREATE TRIGGER members_sync_nationality_trg
  BEFORE INSERT OR UPDATE OF nationalitaet, nationalitaet_codes ON members
  FOR EACH ROW EXECUTE FUNCTION members_sync_nationality();

-- ── 4. Backfill ──────────────────────────────────────────────────────────────
-- All 25 distinct values present on prod resolve cleanly (23 German + the two
-- English strays "Italy"/"Switzerland"). The trigger's codes→name direction then
-- rewrites those two to "Italien"/"Schweiz", repairing them for ClubDesk.
UPDATE members m
   SET nationalitaet_codes = c.code
  FROM country_codes c
 WHERE m.nationalitaet_codes IS NULL
   AND NULLIF(btrim(COALESCE(m.nationalitaet, '')), '') IS NOT NULL
   AND (lower(c.name_de) = lower(btrim(m.nationalitaet)) OR lower(c.name_en) = lower(btrim(m.nationalitaet)));

UPDATE registrations r
   SET nationalitaet_codes = COALESCE(NULLIF(upper(btrim(r.nationalitaet_code)), ''), c.code)
  FROM country_codes c
 WHERE r.nationalitaet_codes IS NULL
   AND NULLIF(btrim(COALESCE(r.nationalitaet, '')), '') IS NOT NULL
   AND (lower(c.name_de) = lower(btrim(r.nationalitaet)) OR lower(c.name_en) = lower(btrim(r.nationalitaet)));

-- Registrations that carry only the ISO code (no resolvable name).
UPDATE registrations
   SET nationalitaet_codes = upper(btrim(nationalitaet_code))
 WHERE nationalitaet_codes IS NULL
   AND nationalitaet_code ~ '^[A-Za-z]{2}$';

-- ── 5. Expose to the Directus items API / admin data model ───────────────────
INSERT INTO directus_fields (collection, field, interface, options, readonly, hidden, sort, width, note)
SELECT 'members', 'nationalitaet_codes', 'input', NULL, false, false, 200, 'half',
  'Nationality as ordered ISO 3166-1 alpha-2 codes ("CH,IT"). First code is primary. members.nationalitaet mirrors it automatically.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'members' AND field = 'nationalitaet_codes');

INSERT INTO directus_fields (collection, field, interface, options, readonly, hidden, sort, width, note)
SELECT 'members', 'federation_of_origin', 'input', NULL, false, false, 201, 'half',
  'Federation of origin: ISO 3166-1 alpha-2 code, ''NONE'' (never licensed elsewhere), or empty (not answered).'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'members' AND field = 'federation_of_origin');

-- nationalitaet is now derived — flag it read-only in the admin data model so a
-- Directus-side edit can't create the drift the trigger exists to prevent.
UPDATE directus_fields
   SET readonly = true,
       note = 'DERIVED from nationalitaet_codes (first code, German name) — edit nationalitaet_codes instead.'
 WHERE collection = 'members' AND field = 'nationalitaet';

INSERT INTO directus_fields (collection, field, interface, readonly, width, note)
SELECT 'registrations', 'nationalitaet_codes', 'input', true, 'half',
  'Ordered ISO 3166-1 alpha-2 codes from the public form. nationalitaet_code holds the primary/first code.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'registrations' AND field = 'nationalitaet_codes');

INSERT INTO directus_fields (collection, field, interface, readonly, width, note)
SELECT 'registrations', 'federation_of_origin', 'input', true, 'half',
  'Federation of origin from the public form: ISO alpha-2, ''NONE'', or empty.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'registrations' AND field = 'federation_of_origin');

COMMIT;

-- After applying: regenerate directus/scripts/SCHEMA.sql via `npm run db:baseline:prod`
-- and re-run `npm run db:setup-perms:dev|prod` (new member-editable fields).
