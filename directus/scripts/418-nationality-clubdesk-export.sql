-- Migration 418: one nationality column + English clubdesk_export columns
-- (phase 2b-3 of the English-only DB migration, plan: .planning/english-db-migration.md).
--
-- ── Nationality ─────────────────────────────────────────────────────────────
-- members.nationalitaet_codes → members.nationality_codes ('IT,CH', the same
-- comma-separated varchar as registrations.nationality_codes since 413). The
-- FIRST code is the one ClubDesk's single-valued Nationalität cell receives.
--
-- members.nationalitaet (ClubDesk's German name of the first code, derived by
-- trigger members_sync_nationality_trg) is dropped together with the trigger.
-- The push now computes the cell at push time from country_codes.name_de_clubdesk
-- of the first code — exactly what the trigger stored (checked on dev
-- 15.10.2026: 756/756 members identical). The trigger's second branch was the
-- latent data-loss bug: writing the name (a ClubDesk proposal accept) replaced
-- 'IT,CH' with a single code. The pull now PREPENDS a ClubDesk code instead.
--
-- Stored copies move too: clubdesk_sync_proposals.field and
-- members.clubdesk_push_changes[].field ('nationalitaet' / 'nationalitaet_codes'
-- → 'nationality_codes') with their values turned into codes, the Directus
-- field metadata and saved presets.
--
-- ── clubdesk_export ─────────────────────────────────────────────────────────
-- The staging mirror of the ClubDesk export gets English snake_case columns —
-- the names clubdesk_field_map.staging_column has carried since 412. VALUES stay
-- raw ClubDesk strings; translation happens where a value leaves staging. The
-- views clubdesk_people / clubdesk_volleyball / clubdesk_basketball are
-- recreated with the new names (view columns cannot be renamed in place).
--
-- Schema + data + Directus metadata only; permissions follow from
-- setup-permissions.mjs. Idempotent: every step checks before it acts.

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.rename_col(p_table text, p_old text, p_new text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = p_table AND column_name = p_old)
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = p_table AND column_name = p_new) THEN
    EXECUTE format('ALTER TABLE public.%I RENAME COLUMN %I TO %I', p_table, p_old, p_new);
  END IF;
  UPDATE directus_fields SET field = p_new WHERE collection = p_table AND field = p_old;
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- Part A — nationality
-- ════════════════════════════════════════════════════════════════════════════

-- ── A1. The trigger names both columns: it goes first ──────────────────────
DROP TRIGGER IF EXISTS members_sync_nationality_trg ON members;
DROP FUNCTION IF EXISTS public.members_sync_nationality();

-- ── A2. Codes column ────────────────────────────────────────────────────────
SELECT pg_temp.rename_col('members', 'nationalitaet_codes', 'nationality_codes');
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'members_nationalitaet_codes_fmt') THEN
    ALTER TABLE members RENAME CONSTRAINT members_nationalitaet_codes_fmt TO members_nationality_codes_fmt;
  END IF;
END $$;

-- ── A3. The derived name column ─────────────────────────────────────────────
-- A row that holds a name but no codes (none on dev/prod today) keeps its
-- answer: the name resolves through the same alias table the trigger used.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'members' AND column_name = 'nationalitaet') THEN
    UPDATE members m SET nationality_codes = a.code
      FROM country_name_aliases a
     WHERE m.nationality_codes IS NULL
       AND NULLIF(btrim(m.nationalitaet), '') IS NOT NULL
       AND a.alias = lower(btrim(m.nationalitaet));
    ALTER TABLE members DROP COLUMN nationalitaet;
  END IF;
END $$;
DELETE FROM directus_fields WHERE collection = 'members' AND field = 'nationalitaet';

-- ── A4. Stored copies: field name + value shape (a code list) ──────────────
-- Any spelling → the code list it names: 'IT,CH' stays, 'Italien' → 'IT',
-- 'Italien, Schweiz' → 'IT,CH'. A value that does not resolve completely is
-- kept as it is (never lost); the accept path refuses it and a human decides.
CREATE OR REPLACE FUNCTION pg_temp.nat_codes(p text) RETURNS text LANGUAGE plpgsql STABLE AS $$
DECLARE
  part   text;
  v_code text;
  codes  text[] := '{}';
BEGIN
  IF p IS NULL OR btrim(p) = '' THEN RETURN p; END IF;
  FOREACH part IN ARRAY string_to_array(p, ',') LOOP
    part := btrim(part);
    CONTINUE WHEN part = '';
    IF part ~ '^[A-Z]{2}$' THEN
      v_code := part;
    ELSE
      SELECT a.code INTO v_code FROM country_name_aliases a WHERE a.alias = lower(part);
      IF v_code IS NULL THEN
        SELECT c.code INTO v_code FROM country_codes c
         WHERE lower(c.name_de_clubdesk) = lower(part) OR lower(c.name_de) = lower(part)
            OR lower(c.name_en) = lower(part)
         ORDER BY c.code LIMIT 1;
      END IF;
      IF v_code IS NULL THEN RETURN p; END IF;
    END IF;
    IF NOT v_code = ANY (codes) THEN codes := codes || v_code; END IF;
  END LOOP;
  RETURN NULLIF(array_to_string(codes, ','), '');
END $$;

UPDATE clubdesk_sync_proposals
   SET field          = 'nationality_codes',
       current_value  = pg_temp.nat_codes(current_value),
       proposed_value = pg_temp.nat_codes(proposed_value)
 WHERE field IN ('nationalitaet', 'nationalitaet_codes');

UPDATE members m SET clubdesk_push_changes = (
    SELECT jsonb_agg(CASE
             WHEN jsonb_typeof(e) = 'object' AND e->>'field' IN ('nationalitaet', 'nationalitaet_codes')
             THEN e || jsonb_build_object(
                    'field', 'nationality_codes',
                    'old_value', pg_temp.nat_codes(e->>'old_value'),
                    'new_value', pg_temp.nat_codes(e->>'new_value'))
             ELSE e END ORDER BY ord)
      FROM jsonb_array_elements(m.clubdesk_push_changes) WITH ORDINALITY AS t(e, ord))
 WHERE jsonb_typeof(m.clubdesk_push_changes) = 'array'
   AND EXISTS (SELECT 1 FROM jsonb_array_elements(m.clubdesk_push_changes) e
                WHERE jsonb_typeof(e) = 'object' AND e->>'field' IN ('nationalitaet', 'nationalitaet_codes'));

UPDATE clubdesk_field_map SET app_column = 'nationality_codes'
 WHERE app_table = 'members' AND app_column IN ('nationalitaet', 'nationalitaet_codes');

-- Saved Data Studio layouts / filters on members.
UPDATE directus_presets
   SET layout_query = CASE WHEN layout_query IS NULL THEN NULL ELSE
         regexp_replace(layout_query::text, '"nationalitaet(_codes)?"', '"nationality_codes"', 'g')::json END,
       filter = CASE WHEN filter IS NULL THEN NULL ELSE
         regexp_replace(filter::text, '"nationalitaet(_codes)?"', '"nationality_codes"', 'g')::json END
 WHERE collection = 'members'
   AND (layout_query::text ~ '"nationalitaet' OR filter::text ~ '"nationalitaet');

COMMENT ON COLUMN members.nationality_codes IS 'Nationality: ordered, comma-separated ISO 3166-1 alpha-2 codes ("IT,CH"). The FIRST code is primary — the ClubDesk push sends country_codes.name_de_clubdesk of it as the single-valued Nationalität cell (migration 418).';

-- ════════════════════════════════════════════════════════════════════════════
-- Part B — clubdesk_export in English
-- ════════════════════════════════════════════════════════════════════════════

-- ── B1. The views read the old names: drop, rename, recreate ───────────────
DROP VIEW IF EXISTS clubdesk_volleyball;
DROP VIEW IF EXISTS clubdesk_basketball;
DROP VIEW IF EXISTS clubdesk_people;

SELECT pg_temp.rename_col('clubdesk_export', o, n) FROM (VALUES
  ('gruppe',                'group_name'),
  ('funktion',              'function'),
  ('nachname',              'last_name'),
  ('vorname',               'first_name'),
  ('firma',                 'company'),
  ('rolle',                 'role'),
  ('rolle_2',               'role_2'),
  ('anrede',                'salutation'),
  ('titel',                 'title'),
  ('briefanrede',           'letter_salutation'),
  ('benutzer_id',           'user_id'),
  ('adresse',               'address'),
  ('adress_zusatz',         'address_extra'),
  ('plz',                   'postal_code'),
  ('ort',                   'city'),
  ('land',                  'country'),
  ('nationalitaet',         'nationality'),
  ('telefon_privat',        'phone_private'),
  ('telefon_geschaeft',     'phone_business'),
  ('telefon_mobil',         'phone_mobile'),
  ('email_alternativ',      'email_alternative'),
  ('gruppen',               'groups'),
  ('eintritt',              'joined_on'),
  ('mitgliedsjahre',        'membership_years'),
  ('austritt',              'left_on'),
  ('zivilstand',            'marital_status'),
  ('geschlecht',            'sex'),
  ('geburtsdatum',          'birthdate'),
  ('alter_',                'age'),
  ('jahrgang',              'birth_year'),
  ('bemerkungen',           'remarks'),
  ('firmen_webseite',       'company_website'),
  ('rechnungsversand',      'invoice_delivery'),
  ('nie_mahnen',            'never_dun'),
  ('kontoinhaber',          'account_holder'),
  ('lizenznummer',          'licence_no'),
  ('lizenzart',             'licence_type'),
  ('lizenz_bestellt',       'licence_ordered'),
  ('sektion',               'section'),
  ('beitragskategorie',     'fee_category'),
  ('betrag_bezahlt',        'amount_paid'),
  ('clubnummer',            'club_number'),
  ('mittelschule_zh',       'cantonal_school'),
  ('offiziellen_lizenz',    'official_licence'),
  ('mitgliederbeitrag',     'membership_fee'),
  ('ahv_nummer',            'ahv_number'),
  ('passivmitglied',        'passive_member'),
  ('offiziellen_100er',     'officials_surcharge'),
  ('gruppe_2',              'group_name_2'),
  ('funktion_2',            'function_2'),
  ('gruppen_2',             'groups_2'),
  ('jg',                    'birth_year_short'),
  ('zuletzt_geaendert_am',  'last_changed_at'),
  ('zuletzt_geaendert_von', 'last_changed_by'),
  ('gruppen_bracketed',     'groups_bracketed'),
  ('rolle_bracketed',       'role_bracketed'),
  ('gast',                  'guest'),
  ('trainer_lizenz',        'trainer_licence')
) AS r(o, n);

ALTER INDEX IF EXISTS idx_clubdesk_export_sektion RENAME TO idx_clubdesk_export_section;

-- One row per contact (the export has one row per contact AND group).
CREATE VIEW clubdesk_people AS
 SELECT DISTINCT ON (COALESCE(NULLIF(clubdesk_id, ''::text), lower(NULLIF(email, ''::text)))) clubdesk_id,
    last_name,
    first_name,
    email,
    email_alternative,
    status,
    sex,
    birthdate,
    birth_year,
    age,
    licence_no,
    licence_type,
    section,
    fee_category,
    official_licence,
    passive_member,
    phone_mobile,
    groups,
    imported_at
   FROM clubdesk_export
  ORDER BY COALESCE(NULLIF(clubdesk_id, ''::text), lower(NULLIF(email, ''::text))), row_id;

CREATE VIEW clubdesk_basketball AS
 SELECT clubdesk_id, last_name, first_name, email, email_alternative, status, sex, birthdate,
    birth_year, age, licence_no, licence_type, section, fee_category, official_licence,
    passive_member, phone_mobile, groups, imported_at
   FROM clubdesk_people
  WHERE section = 'Basketball'::text;

CREATE VIEW clubdesk_volleyball AS
 SELECT clubdesk_id, last_name, first_name, email, email_alternative, status, sex, birthdate,
    birth_year, age, licence_no, licence_type, section, fee_category, official_licence,
    passive_member, phone_mobile, groups, imported_at
   FROM clubdesk_people
  WHERE section = 'Volleyball'::text;

COMMENT ON TABLE clubdesk_export IS 'Staging mirror of the ClubDesk member export ("Alle Kontakte"), one row per contact and group. TRUNCATEd and reloaded by every sync-down (import-clubdesk-csv.mjs). Column names are English since migration 418 (= clubdesk_field_map.staging_column); VALUES are raw ClubDesk strings.';
COMMENT ON COLUMN clubdesk_export.guest IS 'ClubDesk "Gast" checkbox (Ja/Nein) as exported. Written ONLY by wiedisync''s sync-up push; staged here so computeClubdeskDrift can compare it against the current-season roster. Never flows back into members — member_teams.guest_level is the source of truth.';
COMMENT ON COLUMN clubdesk_export.trainer_licence IS 'ClubDesk "Trainer Lizenz" free-text cell as exported — the coaching qualification in ClubDesk''s own wording, comma-separated ("J+S, B"). Parsed back into members.trainer_licences codes (JS/C/B/A) by the down-sync, and re-rendered on the way up by trainerLicenceCell.';
COMMENT ON COLUMN clubdesk_export.nationality IS 'ClubDesk "Nationalität" cell as exported (German country name, single value). Compared against the FIRST of members.nationality_codes.';

-- Saved Data Studio layouts / filters, should the mirror ever get one.
UPDATE directus_presets
   SET layout_query = CASE WHEN layout_query IS NULL THEN NULL ELSE
         regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(layout_query::text,
           '"vorname"', '"first_name"', 'g'), '"nachname"', '"last_name"', 'g'),
           '"gruppen_bracketed"', '"groups_bracketed"', 'g'), '"offiziellen_lizenz"', '"official_licence"', 'g'),
           '"sektion"', '"section"', 'g')::json END
 WHERE collection IN ('clubdesk_export', 'clubdesk_people', 'clubdesk_volleyball', 'clubdesk_basketball');

COMMIT;
