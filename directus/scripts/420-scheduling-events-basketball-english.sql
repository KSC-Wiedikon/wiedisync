-- Migration 420: scheduling, events and basketball in English (phase 4 of the
-- English-only DB migration, plan: .planning/english-db-migration.md).
--
-- Tables
--   spielplaner_assignments    → scheduler_assignments   (+ o2m aliases
--                                members/teams.spielplaner_assignments → scheduler_assignments)
--   svrz_spielplaner_contacts  → svrz_scheduler_contacts
--   Constraint / index names follow. Directus metadata moves with the key:
--   directus_collections, directus_fields, directus_relations, directus_presets.
--   directus_permissions comes from setup-permissions.mjs (run it after this,
--   on a RESTARTED Directus — a stale schema cache does not know the new names).
--   directus_activity / directus_revisions / user_logs keep the old name (history).
--
-- Columns
--   game_scheduling_seasons.spielsamstage  → game_saturdays
--   basketball_team_rules.ferien_hard      → school_holidays_hard
--   basketball_groups.modus                → mode (values: Basketplan text, unchanged)
--
-- Values
--   events.event_type             verein → club, trainingsweekend → training_weekend
--   game_scheduling_slots.source  spielsamstag → game_saturday, spielhalle → game_hall,
--                                 spielsonntag → game_sunday
--   game_scheduling_seasons.team_slot_config  the same source slugs (source / sources)
--   game_scheduling_seasons.bb_slot_config    keys spielsamstage(_hard) → game_saturdays(_hard),
--                                 status fraglich → uncertain, bei_bedarf → if_needed
--   basketball_slots.score_reasons[].code     spielsamstag_<status> → game_saturday_<status>,
--                                 ferien_soft → school_holidays_soft
--   bb_tournaments.list_status    'Anmelden' → open, 'Anmeldefrist abgelaufen'
--                                 (…geschlossen / …voll) → closed, anything else → NULL
--   basketplan_people.licence_category  Offizielle/r → official (leftovers; the
--                                 scraper writes the slug since 415)
--
-- CHECKs make the slugs the contract. Items-API writes are normalised by
-- kscw-hooks first (scheduling-values.js), so a cached pre-420 bundle or the
-- kscw-website admin sending 'verein' does not fail. /kscw/public/events still
-- answers event_type in the old spelling for the website.
--
-- hall_slots.label 'Spielhalle' is user content (a slot's name) and stays.
-- Idempotent.

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

CREATE OR REPLACE FUNCTION pg_temp.rename_table(p_old text, p_new text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF to_regclass('public.' || p_old) IS NOT NULL AND to_regclass('public.' || p_new) IS NULL THEN
    EXECUTE format('ALTER TABLE public.%I RENAME TO %I', p_old, p_new);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.rename_constraint(p_table text, p_old text, p_new text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint
              WHERE conname = p_old AND conrelid = to_regclass('public.' || p_table)) THEN
    EXECUTE format('ALTER TABLE public.%I RENAME CONSTRAINT %I TO %I', p_table, p_old, p_new);
  END IF;
END $$;

-- The collection key is directus_collections' primary key, referenced by
-- directus_collections.group, directus_shares and directus_versions (no ON
-- UPDATE CASCADE): insert the new key, repoint, then drop the old row.
CREATE OR REPLACE FUNCTION pg_temp.rename_collection(p_old text, p_new text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM directus_collections WHERE collection = p_old)
     AND NOT EXISTS (SELECT 1 FROM directus_collections WHERE collection = p_new) THEN
    INSERT INTO directus_collections
      SELECT (jsonb_populate_record(NULL::directus_collections,
                to_jsonb(c) || jsonb_build_object('collection', p_new))).*
        FROM directus_collections c WHERE c.collection = p_old;
    UPDATE directus_collections SET "group" = p_new WHERE "group" = p_old;
    UPDATE directus_shares   SET collection = p_new WHERE collection = p_old;
    UPDATE directus_versions SET collection = p_new WHERE collection = p_old;
    DELETE FROM directus_collections WHERE collection = p_old;
  END IF;
  UPDATE directus_fields    SET collection      = p_new WHERE collection      = p_old;
  UPDATE directus_relations SET many_collection = p_new WHERE many_collection = p_old;
  UPDATE directus_relations SET one_collection  = p_new WHERE one_collection  = p_old;
  UPDATE directus_presets   SET collection      = p_new WHERE collection      = p_old;
END $$;

-- ── 1. Tables ───────────────────────────────────────────────────────────────
SELECT pg_temp.rename_table('spielplaner_assignments', 'scheduler_assignments');
SELECT pg_temp.rename_constraint('scheduler_assignments', 'spielplaner_assignments_pkey',              'scheduler_assignments_pkey');
SELECT pg_temp.rename_constraint('scheduler_assignments', 'uq_spielplaner_assignments_member_team',    'uq_scheduler_assignments_member_team');
SELECT pg_temp.rename_constraint('scheduler_assignments', 'spielplaner_assignments_kscw_team_foreign',  'scheduler_assignments_kscw_team_foreign');
SELECT pg_temp.rename_constraint('scheduler_assignments', 'spielplaner_assignments_member_foreign',     'scheduler_assignments_member_foreign');
SELECT pg_temp.rename_constraint('scheduler_assignments', 'spielplaner_assignments_user_created_foreign', 'scheduler_assignments_user_created_foreign');
ALTER INDEX IF EXISTS public.idx_spielplaner_assignments_kscw_team RENAME TO idx_scheduler_assignments_kscw_team;
SELECT pg_temp.rename_collection('spielplaner_assignments', 'scheduler_assignments');

SELECT pg_temp.rename_table('svrz_spielplaner_contacts', 'svrz_scheduler_contacts');
SELECT pg_temp.rename_constraint('svrz_scheduler_contacts', 'svrz_spielplaner_contacts_pkey', 'svrz_scheduler_contacts_pkey');
SELECT pg_temp.rename_constraint('svrz_scheduler_contacts', 'svrz_spielplaner_contacts_svrz_persistence_id_unique', 'svrz_scheduler_contacts_svrz_persistence_id_unique');
SELECT pg_temp.rename_collection('svrz_spielplaner_contacts', 'svrz_scheduler_contacts');

-- The o2m aliases on members / teams carry the table's old name as their field name.
UPDATE directus_fields SET field = 'scheduler_assignments'
 WHERE collection IN ('members', 'teams') AND field = 'spielplaner_assignments';
UPDATE directus_relations SET one_field = 'scheduler_assignments'
 WHERE one_collection IN ('members', 'teams') AND one_field = 'spielplaner_assignments';

COMMENT ON TABLE scheduler_assignments IS 'Per-team Spielplaner: member may schedule home games of kscw_team (table spielplaner_assignments before migration 420).';
COMMENT ON TABLE svrz_scheduler_contacts IS 'Club-level Spielplaner contacts from SVRZ, synced daily by svrz-scheduling-sync.mjs (table svrz_spielplaner_contacts before migration 420).';

-- ── 2. Columns ──────────────────────────────────────────────────────────────
SELECT pg_temp.rename_col('game_scheduling_seasons', 'spielsamstage', 'game_saturdays');
SELECT pg_temp.rename_col('basketball_team_rules',   'ferien_hard',   'school_holidays_hard');
SELECT pg_temp.rename_col('basketball_groups',       'modus',         'mode');

-- ── 3. Values ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION pg_temp.slot_source(p text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE lower(btrim(p))
    WHEN 'spielsamstag' THEN 'game_saturday'
    WHEN 'spielhalle'   THEN 'game_hall'
    WHEN 'spielsonntag' THEN 'game_sunday'
    ELSE p END
$$;

-- team_slot_config: { "<team id>": { "source": "…" } | { "sources": ["…", …] } }
CREATE OR REPLACE FUNCTION pg_temp.team_slot_config(p jsonb) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  out jsonb := '{}'::jsonb;
  k text;
  v jsonb;
BEGIN
  IF p IS NULL OR jsonb_typeof(p) <> 'object' THEN RETURN p; END IF;
  FOR k, v IN SELECT * FROM jsonb_each(p) LOOP
    IF jsonb_typeof(v) = 'object' THEN
      IF jsonb_typeof(v->'source') = 'string' THEN
        v := v || jsonb_build_object('source', pg_temp.slot_source(v->>'source'));
      END IF;
      IF jsonb_typeof(v->'sources') = 'array' THEN
        v := v || jsonb_build_object('sources', (
          SELECT COALESCE(jsonb_agg(CASE WHEN jsonb_typeof(s) = 'string'
                                         THEN to_jsonb(pg_temp.slot_source(s #>> '{}')) ELSE s END
                                    ORDER BY ord), '[]'::jsonb)
            FROM jsonb_array_elements(v->'sources') WITH ORDINALITY AS t(s, ord)));
      END IF;
    END IF;
    out := out || jsonb_build_object(k, v);
  END LOOP;
  RETURN out;
END $$;

-- bb_slot_config: keys renamed (a key already present under the new name wins),
-- Spielsamstag statuses to slugs.
CREATE OR REPLACE FUNCTION pg_temp.bb_slot_config(p jsonb) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  q jsonb;
BEGIN
  IF p IS NULL OR jsonb_typeof(p) <> 'object' THEN RETURN p; END IF;
  q := p - 'spielsamstage' - 'spielsamstage_hard';
  IF p ? 'spielsamstage' AND NOT p ? 'game_saturdays' THEN
    q := q || jsonb_build_object('game_saturdays', p->'spielsamstage');
  END IF;
  IF p ? 'spielsamstage_hard' AND NOT p ? 'game_saturdays_hard' THEN
    q := q || jsonb_build_object('game_saturdays_hard', p->'spielsamstage_hard');
  END IF;
  IF jsonb_typeof(q->'game_saturdays') = 'array' THEN
    q := q || jsonb_build_object('game_saturdays', (
      SELECT COALESCE(jsonb_agg(CASE
               WHEN jsonb_typeof(e) = 'object' AND e->>'status' IN ('fraglich', 'bei_bedarf')
               THEN e || jsonb_build_object('status',
                      CASE e->>'status' WHEN 'fraglich' THEN 'uncertain' ELSE 'if_needed' END)
               ELSE e END ORDER BY ord), '[]'::jsonb)
        FROM jsonb_array_elements(q->'game_saturdays') WITH ORDINALITY AS t(e, ord)));
  END IF;
  RETURN q;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.score_code(p text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p
    WHEN 'spielsamstag_given'      THEN 'game_saturday_given'
    WHEN 'spielsamstag_desired'    THEN 'game_saturday_desired'
    WHEN 'spielsamstag_fraglich'   THEN 'game_saturday_uncertain'
    WHEN 'spielsamstag_bei_bedarf' THEN 'game_saturday_if_needed'
    WHEN 'ferien_soft'             THEN 'school_holidays_soft'
    ELSE p END
$$;

CREATE OR REPLACE FUNCTION pg_temp.list_status(p text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p IS NULL OR btrim(p) = '' THEN NULL
    WHEN btrim(p) ~* '^(open|anmelden)$' THEN 'open'
    WHEN btrim(p) ~* '^closed$' OR p ~* '(abgelaufen|geschlossen|voll)' THEN 'closed'
    ELSE NULL END
$$;

-- events (BEFORE UPDATE triggers only re-derive permissions_section / open_roster;
-- trg_events_notify ignores an event_type-only change).
UPDATE events SET event_type = CASE lower(btrim(event_type))
    WHEN 'verein' THEN 'club' WHEN 'trainingsweekend' THEN 'training_weekend' END
 WHERE lower(btrim(event_type)) IN ('verein', 'trainingsweekend');

UPDATE game_scheduling_slots SET source = pg_temp.slot_source(source)
 WHERE source IS DISTINCT FROM pg_temp.slot_source(source);

UPDATE game_scheduling_seasons
   SET team_slot_config = pg_temp.team_slot_config(team_slot_config::jsonb)::json
 WHERE team_slot_config IS NOT NULL
   AND team_slot_config::jsonb IS DISTINCT FROM pg_temp.team_slot_config(team_slot_config::jsonb);

UPDATE game_scheduling_seasons SET bb_slot_config = pg_temp.bb_slot_config(bb_slot_config)
 WHERE bb_slot_config IS DISTINCT FROM pg_temp.bb_slot_config(bb_slot_config);

UPDATE basketball_slots s SET score_reasons = (
    SELECT jsonb_agg(CASE WHEN jsonb_typeof(e) = 'object' AND e ? 'code'
                          THEN e || jsonb_build_object('code', pg_temp.score_code(e->>'code'))
                          ELSE e END ORDER BY ord)
      FROM jsonb_array_elements(s.score_reasons) WITH ORDINALITY AS t(e, ord))
 WHERE jsonb_typeof(s.score_reasons) = 'array'
   AND EXISTS (SELECT 1 FROM jsonb_array_elements(s.score_reasons) e
                WHERE jsonb_typeof(e) = 'object'
                  AND e->>'code' IS DISTINCT FROM pg_temp.score_code(e->>'code'));

UPDATE bb_tournaments SET list_status = pg_temp.list_status(list_status)
 WHERE list_status IS DISTINCT FROM pg_temp.list_status(list_status);

UPDATE basketplan_people SET licence_category = 'official'
 WHERE licence_category ~* '^(offizielle/r|ufficiale|officiel(/le)?)$';

-- ── 4. CHECKs ───────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'events_event_type_values') THEN
    ALTER TABLE events ADD CONSTRAINT events_event_type_values
      CHECK (event_type IS NULL OR event_type IN ('club', 'social', 'meeting', 'tournament', 'training_weekend', 'friendly', 'other'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'game_scheduling_slots_source_values') THEN
    ALTER TABLE game_scheduling_slots ADD CONSTRAINT game_scheduling_slots_source_values
      CHECK (source IS NULL OR source IN ('hall_slot', 'game_saturday', 'game_hall', 'game_sunday', 'manual', 'derby'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bb_tournaments_list_status_values') THEN
    ALTER TABLE bb_tournaments ADD CONSTRAINT bb_tournaments_list_status_values
      CHECK (list_status IS NULL OR list_status IN ('open', 'closed'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'basketplan_people_licence_category_no_legacy') THEN
    ALTER TABLE basketplan_people ADD CONSTRAINT basketplan_people_licence_category_no_legacy
      CHECK (licence_category IS NULL OR licence_category !~* '^(offizielle/r|ufficiale|officiel(/le)?)$');
  END IF;
END $$;

-- ── 5. Directus metadata ────────────────────────────────────────────────────
UPDATE directus_fields
   SET options = '{"choices":[{"text":"Club","value":"club"},{"text":"Social","value":"social"},{"text":"Meeting","value":"meeting"},{"text":"Tournament","value":"tournament"},{"text":"Training weekend","value":"training_weekend"},{"text":"Friendly","value":"friendly"},{"text":"Other","value":"other"}]}'::json
 WHERE collection = 'events' AND field = 'event_type' AND COALESCE(options::text, '') !~ '"value":"club"';
UPDATE directus_fields
   SET options = '{"choices":[{"text":"Hall slot","value":"hall_slot"},{"text":"Game Saturday","value":"game_saturday"},{"text":"Game hall","value":"game_hall"},{"text":"Game Sunday","value":"game_sunday"},{"text":"Manual","value":"manual"},{"text":"Derby","value":"derby"}]}'::json
 WHERE collection = 'game_scheduling_slots' AND field = 'source' AND COALESCE(options::text, '') !~ '"value":"game_saturday"';

-- Saved Data Studio layouts / filters that name a renamed field or value.
CREATE OR REPLACE FUNCTION pg_temp.preset_text(p text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
         regexp_replace(regexp_replace(regexp_replace(p,
           '"spielplaner_assignments"', '"scheduler_assignments"', 'g'),
           '"spielsamstage"', '"game_saturdays"', 'g'),
           '"ferien_hard"', '"school_holidays_hard"', 'g'),
           '"modus"', '"mode"', 'g'),
           '"verein"', '"club"', 'g'),
           '"trainingsweekend"', '"training_weekend"', 'g'),
           '"spielsamstag"', '"game_saturday"', 'g'),
           '"spielhalle"', '"game_hall"', 'g'),
           '"spielsonntag"', '"game_sunday"', 'g')
$$;
UPDATE directus_presets
   SET layout_query = CASE WHEN layout_query IS NULL THEN NULL ELSE pg_temp.preset_text(layout_query::text)::json END,
       filter       = CASE WHEN filter IS NULL THEN NULL ELSE pg_temp.preset_text(filter::text)::json END
 WHERE collection IN ('members', 'teams', 'scheduler_assignments', 'events', 'game_scheduling_seasons',
                      'game_scheduling_slots', 'basketball_team_rules', 'basketball_groups')
   AND (layout_query::text IS DISTINCT FROM pg_temp.preset_text(layout_query::text)
     OR filter::text IS DISTINCT FROM pg_temp.preset_text(filter::text));

-- ── 6. Column comments ──────────────────────────────────────────────────────
COMMENT ON COLUMN events.event_type IS 'club | social | meeting | tournament | training_weekend | friendly | other (migration 420; were verein / trainingsweekend). club + tournament are the club-wide / public types.';
COMMENT ON COLUMN game_scheduling_slots.source IS 'hall_slot | game_saturday | game_hall | game_sunday | manual | derby (migration 420; were spielsamstag / spielhalle / spielsonntag).';
COMMENT ON COLUMN game_scheduling_seasons.game_saturdays IS 'Volleyball Spielsamstage: [{date, slots:[{time, hall_id}]}] (column spielsamstage before migration 420).';
COMMENT ON COLUMN game_scheduling_seasons.team_slot_config IS 'Per-team volleyball home-slot sources: {"<team id>": {"sources": ["hall_slot", "game_saturday"]}} (legacy single "source"; slugs since migration 420).';
COMMENT ON COLUMN game_scheduling_seasons.bb_slot_config IS 'Club-level basketball slot-generation config: {version, timeslots:[{dow,time,allow[],tolerate[]}], game_saturdays:[{date,status,note}], game_saturdays_hard, max_weekends, max_weekends_crisis}. dow uses JS getDay (5=Fri, 6=Sat, 0=Sun); the TIMES are not authoritative here — they reference the fixed grid in src/modules/gameScheduling/utils/probasketSeason.ts (FRIDAY_SLOTS/SATURDAY_SLOTS/SUNDAY_SLOTS), so the two cannot drift. allow = the slot is meant for this category; tolerate = permitted but scored lower. game_saturdays.status: given (volleyball already booked KWI that weekend) | desired | uncertain | if_needed. Keys were spielsamstage / spielsamstage_hard and statuses fraglich / bei_bedarf before migration 420. The per-LEAGUE season windows and the ProBasket Ferien/Sperrdaten are NOT stored here — they live in probasketSeason.ts and are mirrored by kscw-endpoints/src/basketball-slots.js.';
COMMENT ON COLUMN basketball_groups.mode IS 'Group mode as the ProBasket workbook states it, verbatim (e.g. "Hin- und Rückrunde"). Column modus before migration 420.';
COMMENT ON COLUMN bb_tournaments.list_status IS 'Basketplan tournament-list action column as a slug: open (Anmelden) | closed (Anmeldefrist abgelaufen / geschlossen / voll) | NULL (no action, or a wording we do not know — stays pickable). Migration 420; was the raw text.';
COMMENT ON COLUMN basketplan_people.licence_category IS 'Licence category from the club licence list (Senior / U 6..U 20 / official — Offizielle/r before migration 420). Harvested from showPrintLicences.do — the person page does not carry it. Applied to members.licence_category fill-or-BB-refresh only; Volleymanager codes (RLL/JLL/…) are never overwritten.';

COMMIT;
