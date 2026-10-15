-- Migration 421: city halls + volley feedback in English, drop
-- vm_vb_spielplan_contact (phase 5 of the English-only DB migration, plan:
-- .planning/english-db-migration.md).
--
-- Hallenfinder cache (private tables, migration 242/269 — no Directus
-- collection, no permissions; read only through /kscw/hallenfinder/search)
--   city_halls.einrichtung_id, city_hall_availability.einrichtung_id → facility_id
--     (the Stadt Zürich query parameter `einrichtung=` stays in the scraper and
--     in the deep links — it is the city's vocabulary, not ours)
--   city_halls.plz / stadtkreis / stadtquartier / schulkreis
--     → postal_code / city_district / city_quarter / school_district
--     (the values — "11", "Seebach", "Glattal" — are the city's place names, unchanged)
--   city_halls.hall_type  sporthalle → sports_hall, gymnastikraum → gym_room,
--     dreifachhalle → triple_hall, doppelhalle → double_hall (the last two are
--     not on prod today, but the scraper derives them from a hall's name).
--     hall_type_label stays the city's own Hallentyp text ("Einfachhalle" …).
--   FK city_hall_availability_einrichtung_id_fkey → …_facility_id_fkey.
--
-- volley_feedback
--   rating_verein / rating_vorstand / rating_tk_leitung / rating_kommunikation
--     → rating_club / rating_board / rating_technical_committee / rating_communication
--   (rating_training, functions, teams and the rest were already English.)
--   POST /kscw/public/volley-feedback still accepts the German keys: the form on
--   kscw-website posts them.
--
-- vm_vb_spielplan_contact
--   Dropped (plan decision 4, 2026-10-15): no code reads or writes it; prod holds
--   7 rows, all created 01.04.2026 and never updated; no views, triggers or
--   relations depend on it. Its directus_collections / directus_fields /
--   directus_presets rows go with it (no directus_relations, directus_shares,
--   directus_versions or directus_permissions rows exist on dev or prod —
--   permissions come from setup-permissions.mjs, which never granted it).
--   directus_activity / directus_revisions keep the old rows (history).
--
-- Directus is restarted by the deploy (schema-cache bust). Idempotent.

BEGIN;

-- ── helpers ─────────────────────────────────────────────────────────────────
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

CREATE OR REPLACE FUNCTION pg_temp.rename_constraint(p_table text, p_old text, p_new text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint
              WHERE conname = p_old AND conrelid = to_regclass('public.' || p_table)) THEN
    EXECUTE format('ALTER TABLE public.%I RENAME CONSTRAINT %I TO %I', p_table, p_old, p_new);
  END IF;
END $$;

-- ── 1. Hallenfinder: columns ────────────────────────────────────────────────
SELECT pg_temp.rename_col('city_halls',             'einrichtung_id', 'facility_id');
SELECT pg_temp.rename_col('city_hall_availability', 'einrichtung_id', 'facility_id');
SELECT pg_temp.rename_col('city_halls', 'plz',           'postal_code');
SELECT pg_temp.rename_col('city_halls', 'stadtkreis',    'city_district');
SELECT pg_temp.rename_col('city_halls', 'stadtquartier', 'city_quarter');
SELECT pg_temp.rename_col('city_halls', 'schulkreis',    'school_district');
SELECT pg_temp.rename_constraint('city_hall_availability',
  'city_hall_availability_einrichtung_id_fkey', 'city_hall_availability_facility_id_fkey');

-- ── 2. Hallenfinder: hall_type values ───────────────────────────────────────
-- No trigger on city_halls; the UPDATE touches only the value.
UPDATE city_halls SET hall_type = CASE hall_type
    WHEN 'sporthalle'    THEN 'sports_hall'
    WHEN 'gymnastikraum' THEN 'gym_room'
    WHEN 'dreifachhalle' THEN 'triple_hall'
    WHEN 'doppelhalle'   THEN 'double_hall' END
 WHERE hall_type IN ('sporthalle', 'gymnastikraum', 'dreifachhalle', 'doppelhalle');

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'city_halls_hall_type_values') THEN
    ALTER TABLE city_halls ADD CONSTRAINT city_halls_hall_type_values
      CHECK (hall_type IS NULL OR hall_type IN ('sports_hall', 'gym_room', 'triple_hall', 'double_hall'));
  END IF;
END $$;

-- ── 3. volley_feedback: columns ─────────────────────────────────────────────
SELECT pg_temp.rename_col('volley_feedback', 'rating_verein',        'rating_club');
SELECT pg_temp.rename_col('volley_feedback', 'rating_vorstand',      'rating_board');
SELECT pg_temp.rename_col('volley_feedback', 'rating_tk_leitung',    'rating_technical_committee');
SELECT pg_temp.rename_col('volley_feedback', 'rating_kommunikation', 'rating_communication');

-- Saved Data Studio layouts / filters naming a renamed field.
CREATE OR REPLACE FUNCTION pg_temp.preset_text(p text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT regexp_replace(regexp_replace(regexp_replace(regexp_replace(p,
           '"rating_verein"',        '"rating_club"', 'g'),
           '"rating_vorstand"',      '"rating_board"', 'g'),
           '"rating_tk_leitung"',    '"rating_technical_committee"', 'g'),
           '"rating_kommunikation"', '"rating_communication"', 'g')
$$;
UPDATE directus_presets
   SET layout_query = CASE WHEN layout_query IS NULL THEN NULL ELSE pg_temp.preset_text(layout_query::text)::json END,
       filter       = CASE WHEN filter IS NULL THEN NULL ELSE pg_temp.preset_text(filter::text)::json END
 WHERE collection = 'volley_feedback'
   AND (layout_query::text IS DISTINCT FROM pg_temp.preset_text(layout_query::text)
     OR filter::text IS DISTINCT FROM pg_temp.preset_text(filter::text));

-- ── 4. Drop vm_vb_spielplan_contact ─────────────────────────────────────────
DELETE FROM directus_presets   WHERE collection = 'vm_vb_spielplan_contact';
DELETE FROM directus_relations WHERE many_collection = 'vm_vb_spielplan_contact'
                                  OR one_collection  = 'vm_vb_spielplan_contact';
DELETE FROM directus_fields    WHERE collection = 'vm_vb_spielplan_contact';
UPDATE directus_collections SET "group" = NULL WHERE "group" = 'vm_vb_spielplan_contact';
-- directus_shares / directus_versions cascade on the collection key.
DELETE FROM directus_collections WHERE collection = 'vm_vb_spielplan_contact';
DROP TABLE IF EXISTS public.vm_vb_spielplan_contact;   -- its id sequence is OWNED BY it

-- ── 5. Comments ─────────────────────────────────────────────────────────────
COMMENT ON COLUMN city_halls.facility_id IS 'Stable hall id from the City of Zürich tool (its `einrichtung` query parameter). Column einrichtung_id before migration 421.';
COMMENT ON COLUMN city_hall_availability.facility_id IS 'city_halls.facility_id. Column einrichtung_id before migration 421.';
COMMENT ON COLUMN city_halls.postal_code IS 'Postal code parsed from the address, e.g. "8052". Column plz before migration 421.';
COMMENT ON COLUMN city_halls.city_district IS 'Stadtkreis number as the city prints it, e.g. "11". Column stadtkreis before migration 421.';
COMMENT ON COLUMN city_halls.city_quarter IS 'Stadtquartier name as the city prints it, e.g. "Seebach". Column stadtquartier before migration 421.';
COMMENT ON COLUMN city_halls.school_district IS 'Schulkreis name as the city prints it, e.g. "Glattal". Column schulkreis before migration 421.';
COMMENT ON COLUMN city_halls.hall_type IS 'sports_hall | gym_room | triple_hall | double_hall — derived from the hall NAME by hallenfinder-scrape.mjs; the UI type filter matches on it. Were sporthalle / gymnastikraum / dreifachhalle / doppelhalle before migration 421. hall_type_label keeps the city''s own Hallentyp text.';
COMMENT ON COLUMN volley_feedback.rating_club IS '1–5 rating of the club. Column rating_verein before migration 421.';
COMMENT ON COLUMN volley_feedback.rating_board IS '1–5 rating of the board (Vorstand). Column rating_vorstand before migration 421.';
COMMENT ON COLUMN volley_feedback.rating_technical_committee IS '1–5 rating of the technical committee lead (TK-Leitung). Column rating_tk_leitung before migration 421.';
COMMENT ON COLUMN volley_feedback.rating_communication IS '1–5 rating of club communication. Column rating_kommunikation before migration 421.';

COMMIT;
