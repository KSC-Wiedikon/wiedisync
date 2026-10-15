-- Migration 415: member values in English, step 1 of 3 (phase 2b-2a of the
-- English-only DB migration, plan: .planning/english-db-migration.md).
--
--   salutation (members + registrations)       Herr / Frau        → mr / ms
--   cantonal_school (members + registrations)  'Nein'             → 'none'
--                                              'Andere Kantonsschule' → 'other'
--                                              (school names stay; NULL keeps
--                                              meaning "never asked")
--   members.licence_category                   'Offizielle/r'     → 'official'
--                                              (RLL / JLL / Senior / U 14 … are
--                                              federation codes and stay)
--
-- ClubDesk keeps its German values: the push maps back at the cell
-- (member-values.js / app_to_cd), the pull maps on the way in (cd_to_app).
-- Stored copies of these values move too: pending/refused ClubDesk proposals,
-- members.clubdesk_push_changes, and the Directus dropdown choices.
--
-- CHECKs make the slugs the contract. Writes through the items API are
-- normalised by kscw-hooks first, so a cached pre-415 bundle sending 'Herr'
-- does not fail. Idempotent.

BEGIN;

-- ── 1. Values ────────────────────────────────────────────────────────────────
UPDATE members SET salutation = CASE btrim(salutation) WHEN 'Herr' THEN 'mr' WHEN 'Frau' THEN 'ms' END
 WHERE salutation IS NOT NULL AND salutation NOT IN ('mr', 'ms');
UPDATE registrations SET salutation = CASE btrim(salutation) WHEN 'Herr' THEN 'mr' WHEN 'Frau' THEN 'ms' END
 WHERE salutation IS NOT NULL AND salutation NOT IN ('mr', 'ms');

UPDATE members SET cantonal_school = CASE
    WHEN btrim(cantonal_school) = '' THEN NULL
    WHEN lower(btrim(cantonal_school)) = 'nein' THEN 'none'
    WHEN btrim(cantonal_school) = 'Andere Kantonsschule' THEN 'other'
    ELSE btrim(cantonal_school) END
 WHERE cantonal_school IS NOT NULL
   AND (btrim(cantonal_school) = '' OR lower(btrim(cantonal_school)) = 'nein' OR btrim(cantonal_school) = 'Andere Kantonsschule');
UPDATE registrations SET cantonal_school = CASE
    WHEN btrim(cantonal_school) = '' THEN NULL
    WHEN lower(btrim(cantonal_school)) = 'nein' THEN 'none'
    WHEN btrim(cantonal_school) = 'Andere Kantonsschule' THEN 'other'
    ELSE btrim(cantonal_school) END
 WHERE cantonal_school IS NOT NULL
   AND (btrim(cantonal_school) = '' OR lower(btrim(cantonal_school)) = 'nein' OR btrim(cantonal_school) = 'Andere Kantonsschule');

UPDATE members SET licence_category = 'official'
 WHERE licence_category ~* '^(offizielle/r|ufficiale|officiel(/le)?)$';

-- ── 2. Stored copies ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION pg_temp.member_value(p_field text, p_value text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_value IS NULL THEN NULL
    WHEN p_field = 'salutation' AND btrim(p_value) = 'Herr' THEN 'mr'
    WHEN p_field = 'salutation' AND btrim(p_value) = 'Frau' THEN 'ms'
    WHEN p_field = 'cantonal_school' AND lower(btrim(p_value)) = 'nein' THEN 'none'
    WHEN p_field = 'cantonal_school' AND btrim(p_value) = 'Andere Kantonsschule' THEN 'other'
    WHEN p_field = 'licence_category' AND p_value ~* '^(offizielle/r|ufficiale|officiel(/le)?)$' THEN 'official'
    ELSE p_value END
$$;

-- Proposals stage ClubDesk's cell; the accept path normalises it, but the
-- refused tombstone compares proposed_value exactly — convert both sides so a
-- refused 'Herr' still blocks a re-proposed 'mr'.
UPDATE clubdesk_sync_proposals
   SET current_value  = pg_temp.member_value(field, current_value),
       proposed_value = pg_temp.member_value(field, proposed_value)
 WHERE field IN ('salutation', 'cantonal_school', 'licence_category')
   AND (current_value  IS DISTINCT FROM pg_temp.member_value(field, current_value)
     OR proposed_value IS DISTINCT FROM pg_temp.member_value(field, proposed_value));

UPDATE members m SET clubdesk_push_changes = (
    SELECT jsonb_agg(CASE
             WHEN jsonb_typeof(e) = 'object' AND e->>'field' IN ('salutation', 'cantonal_school', 'licence_category')
             THEN e || jsonb_build_object(
                    'old_value', pg_temp.member_value(e->>'field', e->>'old_value'),
                    'new_value', pg_temp.member_value(e->>'field', e->>'new_value'))
             ELSE e END ORDER BY ord)
      FROM jsonb_array_elements(m.clubdesk_push_changes) WITH ORDINALITY AS t(e, ord))
 WHERE jsonb_typeof(m.clubdesk_push_changes) = 'array'
   AND EXISTS (SELECT 1 FROM jsonb_array_elements(m.clubdesk_push_changes) e
                WHERE jsonb_typeof(e) = 'object'
                  AND e->>'field' IN ('salutation', 'cantonal_school', 'licence_category'));

-- ── 3. CHECKs ────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'members_salutation_values') THEN
    ALTER TABLE members ADD CONSTRAINT members_salutation_values
      CHECK (salutation IS NULL OR salutation IN ('mr', 'ms'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'registrations_salutation_values') THEN
    ALTER TABLE registrations ADD CONSTRAINT registrations_salutation_values
      CHECK (salutation IS NULL OR salutation IN ('mr', 'ms'));
  END IF;
  -- The two former German sentinels may not come back; school names are free.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'members_cantonal_school_no_legacy') THEN
    ALTER TABLE members ADD CONSTRAINT members_cantonal_school_no_legacy
      CHECK (cantonal_school IS NULL OR (lower(btrim(cantonal_school)) <> 'nein' AND btrim(cantonal_school) NOT IN ('', 'Andere Kantonsschule')));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'members_licence_category_no_legacy') THEN
    ALTER TABLE members ADD CONSTRAINT members_licence_category_no_legacy
      CHECK (licence_category IS NULL OR licence_category !~* '^(offizielle/r|ufficiale|officiel(/le)?)$');
  END IF;
END $$;

-- ── 4. Directus metadata ─────────────────────────────────────────────────────
UPDATE directus_fields
   SET options = replace(replace(options::text,
         '{"text":"Nein","value":"Nein"}', '{"text":"None","value":"none"}'),
         '{"text":"Andere Kantonsschule","value":"Andere Kantonsschule"}', '{"text":"Other","value":"other"}')::json
 WHERE collection = 'members' AND field = 'cantonal_school' AND options IS NOT NULL;
UPDATE directus_fields
   SET interface = 'select-dropdown',
       options = '{"choices":[{"text":"Mr","value":"mr"},{"text":"Ms","value":"ms"}],"allowNone":true}'::json
 WHERE collection IN ('members', 'registrations') AND field = 'salutation';

COMMENT ON COLUMN members.salutation IS 'mr | ms (migration 415). ClubDesk Anrede Herr/Frau via member-values.js / clubdesk_value_map.';
COMMENT ON COLUMN members.cantonal_school IS 'School name; ''none'' = asked, not at a Kantonsschule; ''other'' = a school the list does not name; NULL = never asked (migration 415).';

COMMIT;
