-- Migration 413: registrations + event_signups in English (phase 2a of the
-- English-only DB migration, plan: .planning/english-db-migration.md).
--
-- Columns (registrations):
--   anrede → salutation
--   vorname → first_name, nachname → last_name, telefon_mobil → phone,
--   adresse → address, plz → postal_code, ort → city, geburtsdatum → birthdate
--   geschlecht → sex                 männlich/weiblich → m/f
--   ahv_nummer → ahv_number
--   beitragskategorie → fee_category
--   kantonsschule → cantonal_school
--   rolle → role                     Spieler*in/Trainer*in/Guest/Teamverantwortliche*r/
--                                    Andere → player/coach/guest/team_responsible/other
--   bemerkungen → remarks
--   lizenz → officials_requested     'OTR 1, Schiedsrichter' → 'otr1,bb_referee'
--                                    (vb_scorer, vb_referee, bb_referee, otr1, otr2, otn)
--   schiedsrichter_stufe → referee_level
--   sektion_choice → club_section_choice
--   bb_doc_freibrief → bb_doc_release_letter
--   bb_situation                     neu/rueckkehr → new/returning
--   bb_recent_licence                'ja'/'nein' → boolean
--   nationalitaet + nationalitaet_code + nationalitaet_codes → nationality_codes
--
-- event_signups.sex: männlich/weiblich → m/f.
--
-- `nationality_codes` stays a comma-separated varchar ('IT,CH', first = primary),
-- not text[]: the Directus items API, the app and the endpoints all handle it as
-- a string, and members (phase 2b) will use the same shape.
--
-- Values whose vocabulary `members` shares and still stores in German —
-- salutation (Herr/Frau), fee_category (ClubDesk labels, read by the fee
-- engine), cantonal_school ('Nein' / 'Andere Kantonsschule'),
-- club_section_choice — keep their values here and convert in phase 2b
-- together with members, so one vocabulary is live per domain at any time.
-- `sex` converts now: members.sex is already m/f.
--
-- `members` is NOT touched: the approval path maps these English names and slugs
-- onto members' current German columns/values until phase 2b.
--
-- Old cached SPAs and the kscw-website form still send German keys; the
-- /kscw/registration endpoint accepts both for one release.
--
-- Schema + data + Directus metadata only. Idempotent: every rename is guarded,
-- every value UPDATE only matches old values.

BEGIN;

-- ── 1. Column renames ────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION pg_temp.rename_col(p_table text, p_old text, p_new text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = p_table AND column_name = p_old)
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = p_table AND column_name = p_new) THEN
    EXECUTE format('ALTER TABLE public.%I RENAME COLUMN %I TO %I', p_table, p_old, p_new);
  END IF;
  -- Directus metadata follows the column.
  UPDATE directus_fields SET field = p_new WHERE collection = p_table AND field = p_old;
END $$;

SELECT pg_temp.rename_col('registrations', 'anrede',               'salutation');
SELECT pg_temp.rename_col('registrations', 'vorname',              'first_name');
SELECT pg_temp.rename_col('registrations', 'nachname',             'last_name');
SELECT pg_temp.rename_col('registrations', 'telefon_mobil',        'phone');
SELECT pg_temp.rename_col('registrations', 'adresse',              'address');
SELECT pg_temp.rename_col('registrations', 'plz',                  'postal_code');
SELECT pg_temp.rename_col('registrations', 'ort',                  'city');
SELECT pg_temp.rename_col('registrations', 'geburtsdatum',         'birthdate');
SELECT pg_temp.rename_col('registrations', 'geschlecht',           'sex');
SELECT pg_temp.rename_col('registrations', 'ahv_nummer',           'ahv_number');
SELECT pg_temp.rename_col('registrations', 'beitragskategorie',    'fee_category');
SELECT pg_temp.rename_col('registrations', 'kantonsschule',        'cantonal_school');
SELECT pg_temp.rename_col('registrations', 'rolle',                'role');
SELECT pg_temp.rename_col('registrations', 'bemerkungen',          'remarks');
SELECT pg_temp.rename_col('registrations', 'lizenz',               'officials_requested');
SELECT pg_temp.rename_col('registrations', 'schiedsrichter_stufe', 'referee_level');
SELECT pg_temp.rename_col('registrations', 'sektion_choice',       'club_section_choice');
SELECT pg_temp.rename_col('registrations', 'bb_doc_freibrief',     'bb_doc_release_letter');

-- ── 2. Nationality: three columns → nationality_codes ───────────────────────

ALTER TABLE registrations ADD COLUMN IF NOT EXISTS nationality_codes varchar(200);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'registrations' AND column_name = 'nationalitaet_codes') THEN
    -- Preference: the resolved list, then the single code, then the country
    -- name looked up the same way the members trigger does it.
    UPDATE registrations r
       SET nationality_codes = COALESCE(
             NULLIF(btrim(r.nationalitaet_codes), ''),
             NULLIF(upper(btrim(r.nationalitaet_code)), ''),
             (SELECT c.code FROM country_codes c
               WHERE lower(btrim(r.nationalitaet)) IN (lower(c.name_de), lower(c.name_en), lower(c.name_de_clubdesk))
               LIMIT 1),
             (SELECT a.code FROM country_name_aliases a
               WHERE lower(a.alias) = lower(btrim(r.nationalitaet))
               LIMIT 1))
     WHERE r.nationality_codes IS NULL;

    ALTER TABLE registrations DROP CONSTRAINT IF EXISTS registrations_nationalitaet_codes_fmt;
    ALTER TABLE registrations DROP COLUMN nationalitaet_codes;
    ALTER TABLE registrations DROP COLUMN IF EXISTS nationalitaet_code;
    ALTER TABLE registrations DROP COLUMN IF EXISTS nationalitaet;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'registrations_nationality_codes_fmt') THEN
    ALTER TABLE registrations ADD CONSTRAINT registrations_nationality_codes_fmt
      CHECK (nationality_codes IS NULL OR nationality_codes ~ '^[A-Z]{2}(,[A-Z]{2})*$');
  END IF;
END $$;

DELETE FROM directus_fields
 WHERE collection = 'registrations' AND field IN ('nationalitaet', 'nationalitaet_code', 'nationalitaet_codes');
INSERT INTO directus_fields (collection, field, interface, hidden, readonly, width, note)
SELECT 'registrations', 'nationality_codes', 'input', false, false, 'half',
       'ISO codes, comma-separated; the first one is the primary nationality'
 WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'registrations' AND field = 'nationality_codes');

-- ── 3. Values → English slugs ────────────────────────────────────────────────

UPDATE registrations SET sex = CASE btrim(sex) WHEN 'männlich' THEN 'm' WHEN 'weiblich' THEN 'f' END
 WHERE sex IS NOT NULL AND sex NOT IN ('m', 'f');
UPDATE event_signups SET sex = CASE btrim(sex) WHEN 'männlich' THEN 'm' WHEN 'weiblich' THEN 'f' END
 WHERE sex IS NOT NULL AND sex NOT IN ('m', 'f');

-- The form also offers 'Teamverantwortliche*r' and 'Andere'. A passive
-- registration's `rolle` was a copy of its licence list — that lives in
-- officials_requested now, so it becomes NULL.
UPDATE registrations SET role = CASE btrim(role)
    WHEN 'Spieler*in' THEN 'player' WHEN 'Trainer*in' THEN 'coach' WHEN 'Guest' THEN 'guest'
    WHEN 'Teamverantwortliche*r' THEN 'team_responsible' WHEN 'Andere' THEN 'other' END
 WHERE role IS NOT NULL AND role NOT IN ('player', 'coach', 'guest', 'team_responsible', 'other');

UPDATE registrations SET bb_situation = CASE bb_situation WHEN 'neu' THEN 'new' WHEN 'rueckkehr' THEN 'returning' END
 WHERE bb_situation IN ('neu', 'rueckkehr');
UPDATE registrations SET bb_situation = NULL WHERE btrim(bb_situation) = '';

-- 'OTR 1, Schiedsrichter' → 'otr1,bb_referee'. The form's tokens: VB
-- 'Schreiber' / 'Schiedsrichter', BB 'OTR 1' / 'OTR 2' / 'OTN' / 'Schiedsrichter',
-- passive 'VB Schreiber' / 'VB Schiedsrichter' / 'BB OTR 1' / … / 'BB Schiedsrichter'.
-- A bare 'Schiedsrichter' takes the sport of the membership. Unknown tokens are
-- kept lower-cased without spaces so nothing is silently dropped.
CREATE OR REPLACE FUNCTION pg_temp.official_slug(p_token text, p_membership text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE lower(regexp_replace(p_token, '\s+', '', 'g'))
    WHEN 'schreiber'        THEN 'vb_scorer'
    WHEN 'vbschreiber'      THEN 'vb_scorer'
    WHEN 'vbschiedsrichter' THEN 'vb_referee'
    WHEN 'bbschiedsrichter' THEN 'bb_referee'
    WHEN 'schiedsrichter'   THEN CASE p_membership WHEN 'basketball' THEN 'bb_referee' ELSE 'vb_referee' END
    WHEN 'otr1'   THEN 'otr1'  WHEN 'bbotr1' THEN 'otr1'
    WHEN 'otr2'   THEN 'otr2'  WHEN 'bbotr2' THEN 'otr2'
    WHEN 'otn'    THEN 'otn'   WHEN 'bbotn'  THEN 'otn'
    ELSE lower(regexp_replace(p_token, '\s+', '', 'g')) END
$$;

UPDATE registrations r SET officials_requested = (
    SELECT NULLIF(string_agg(pg_temp.official_slug(t, r.membership_type), ',' ORDER BY ord), '')
      FROM unnest(string_to_array(r.officials_requested, ',')) WITH ORDINALITY AS u(t, ord)
     WHERE btrim(t) <> '')
 WHERE officials_requested IS NOT NULL
   AND officials_requested !~ '^(vb_scorer|vb_referee|bb_referee|otr1|otr2|otn)(,(vb_scorer|vb_referee|bb_referee|otr1|otr2|otn))*$';

-- bb_docs_waived holds document COLUMN names as data.
UPDATE registrations SET bb_docs_waived = regexp_replace(bb_docs_waived, '\mbb_doc_freibrief\M', 'bb_doc_release_letter', 'g')
 WHERE bb_docs_waived ~ '\mbb_doc_freibrief\M';

-- bb_recent_licence 'ja'/'nein' → boolean
DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
       WHERE table_name = 'registrations' AND column_name = 'bb_recent_licence') <> 'boolean' THEN
    ALTER TABLE registrations DROP CONSTRAINT IF EXISTS registrations_bb_recent_licence_check;
    ALTER TABLE registrations ALTER COLUMN bb_recent_licence TYPE boolean
      USING CASE bb_recent_licence WHEN 'ja' THEN true WHEN 'nein' THEN false END;
  END IF;
END $$;
UPDATE directus_fields SET interface = 'boolean', special = 'cast-boolean', options = NULL
 WHERE collection = 'registrations' AND field = 'bb_recent_licence';

-- ── 4. Value CHECKs (the slugs are the contract now) ─────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'registrations_sex_values') THEN
    ALTER TABLE registrations ADD CONSTRAINT registrations_sex_values
      CHECK (sex IS NULL OR sex IN ('m', 'f'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'registrations_role_values') THEN
    ALTER TABLE registrations ADD CONSTRAINT registrations_role_values
      CHECK (role IS NULL OR role IN ('player', 'coach', 'guest', 'team_responsible', 'other'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'registrations_bb_situation_values') THEN
    ALTER TABLE registrations ADD CONSTRAINT registrations_bb_situation_values
      CHECK (bb_situation IS NULL OR bb_situation IN ('new', 'returning', 'transfer_ch', 'transfer_intl'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_signups_sex_values') THEN
    ALTER TABLE event_signups ADD CONSTRAINT event_signups_sex_values
      CHECK (sex IS NULL OR sex IN ('m', 'f'));
  END IF;
END $$;

-- ── 5. Directus metadata: dropdown choices + the saved layout ───────────────

UPDATE directus_fields SET options = '{"choices":[{"text":"Male","value":"m"},{"text":"Female","value":"f"}]}'::json
 WHERE collection IN ('registrations', 'event_signups') AND field = 'sex' AND interface = 'select-dropdown';
UPDATE directus_presets
   SET layout_query = replace(replace(replace(replace(layout_query::text,
         '"anrede"', '"salutation"'), '"vorname"', '"first_name"'),
         '"nachname"', '"last_name"'), '"lizenz"', '"officials_requested"')::json
 WHERE collection = 'registrations'
   AND layout_query::text ~ '"(anrede|vorname|nachname|lizenz)"';

COMMIT;
