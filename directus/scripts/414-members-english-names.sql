-- Migration 414: members in English, part 1 — column NAMES only (phase 2b-1 of
-- the English-only DB migration, plan: .planning/english-db-migration.md).
--
-- members: adresse → address, plz → postal_code, ort → city,
--   billing_plz → billing_postal_code, billing_ort → billing_city,
--   anrede → salutation, ahv_nummer → ahv_number, beitragskategorie → fee_category,
--   sektion → club_section, sport_section → permissions_section,
--   eintritt → joined_on, austritt → left_on, is_spielplaner → is_scheduler,
--   kantonsschule → cantonal_school.
-- events: sport_section → permissions_section.
--
-- VALUES DO NOT CHANGE here (Herr/Frau, ClubDesk fee labels, 'Volleyball', …):
-- that is 2b-2, through clubdesk_value_map. Nationality is 2b-3. So the
-- ClubDesk sync-up CSV must come out byte-identical after this migration.
--
-- Postgres carries a RENAME into views, CHECKs, indexes and RLS, but NOT into
-- function bodies — the sport-section and staff-Gratis functions are
-- recreated below. Function NAMES (kscw_*_sport_section) stay: they are
-- internal and English already.
--
-- Data that stores member column names as text is renamed too:
-- clubdesk_sync_proposals.field, members.clubdesk_push_changes[].field and
-- clubdesk_field_map.app_column ('section' → 'club_section'). History
-- (user_logs, directus_revisions) keeps the old keys; staff_gratis_revert
-- matches both.
--
-- Schema + data + Directus metadata only; permissions follow from
-- setup-permissions.mjs. Idempotent.

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

-- ── 1. Columns ───────────────────────────────────────────────────────────────
SELECT pg_temp.rename_col('members', 'adresse',           'address');
SELECT pg_temp.rename_col('members', 'plz',               'postal_code');
SELECT pg_temp.rename_col('members', 'ort',               'city');
SELECT pg_temp.rename_col('members', 'billing_plz',       'billing_postal_code');
SELECT pg_temp.rename_col('members', 'billing_ort',       'billing_city');
SELECT pg_temp.rename_col('members', 'anrede',            'salutation');
SELECT pg_temp.rename_col('members', 'ahv_nummer',        'ahv_number');
SELECT pg_temp.rename_col('members', 'beitragskategorie', 'fee_category');
SELECT pg_temp.rename_col('members', 'sektion',           'club_section');
SELECT pg_temp.rename_col('members', 'sport_section',     'permissions_section');
SELECT pg_temp.rename_col('members', 'eintritt',          'joined_on');
SELECT pg_temp.rename_col('members', 'austritt',          'left_on');
SELECT pg_temp.rename_col('members', 'is_spielplaner',    'is_scheduler');
SELECT pg_temp.rename_col('members', 'kantonsschule',     'cantonal_school');
SELECT pg_temp.rename_col('events',  'sport_section',     'permissions_section');

-- Constraint names that spell a renamed column.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'members_austritt_needs_departed_status') THEN
    ALTER TABLE members RENAME CONSTRAINT members_austritt_needs_departed_status TO members_left_on_needs_departed_status;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'members_sport_section_check') THEN
    ALTER TABLE members RENAME CONSTRAINT members_sport_section_check TO members_permissions_section_check;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'events_sport_section_check') THEN
    ALTER TABLE events RENAME CONSTRAINT events_sport_section_check TO events_permissions_section_check;
  END IF;
END $$;

-- ── 2. Function bodies that name the renamed columns (before any UPDATE on
-- members: its BEFORE trigger runs trg_members_sport_section) ─────────────────────────
CREATE OR REPLACE FUNCTION public.kscw_member_sport_section(p_member integer, p_sektion text, p_fee text)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH sports AS (
    SELECT DISTINCT lower(t.sport) AS sport
    FROM (
      SELECT team AS team_id FROM member_teams WHERE member = p_member
      UNION ALL
      SELECT teams_id FROM teams_coaches WHERE members_id = p_member
      UNION ALL
      SELECT teams_id FROM teams_responsibles WHERE members_id = p_member
    ) links
    JOIN teams t ON t.id = links.team_id
    WHERE lower(t.sport) IN ('volleyball', 'basketball')
  ), n AS (SELECT count(*) AS c, min(sport) AS only FROM sports)
  SELECT CASE
    WHEN n.c > 1 THEN 'both'
    WHEN n.c = 1 THEN n.only
    WHEN lower(btrim(coalesce(p_sektion, ''), E' \t\r\n')) = 'volleyball' THEN 'volleyball'
    WHEN lower(btrim(coalesce(p_sektion, ''), E' \t\r\n')) = 'basketball' THEN 'basketball'
    WHEN left(lower(btrim(coalesce(p_fee, ''), E' \t\r\n')), 3) = 'vb ' THEN 'volleyball'
    WHEN left(lower(btrim(coalesce(p_fee, ''), E' \t\r\n')), 3) = 'bb ' THEN 'basketball'
    ELSE 'both'
  END
  FROM n
$function$;

CREATE OR REPLACE FUNCTION public.kscw_refresh_event_sport_section(p_events integer[])
 RETURNS void
 LANGUAGE sql
 SET search_path TO 'public'
AS $function$
  UPDATE events e
  SET permissions_section = kscw_event_sport_section(e.id)
  WHERE e.id = ANY(p_events)
    AND e.permissions_section IS DISTINCT FROM kscw_event_sport_section(e.id)
$function$;

CREATE OR REPLACE FUNCTION public.kscw_refresh_member_sport_section(p_members integer[])
 RETURNS void
 LANGUAGE sql
 SET search_path TO 'public'
AS $function$
  UPDATE members m
  SET permissions_section = kscw_member_sport_section(m.id, m.club_section, m.fee_category)
  WHERE m.id = ANY(p_members)
    AND m.permissions_section IS DISTINCT FROM kscw_member_sport_section(m.id, m.club_section, m.fee_category)
$function$;

CREATE OR REPLACE FUNCTION public.staff_gratis_fill()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_clubdesk_id    text;
  v_pending_before boolean;
  v_revision_hwm   bigint;
BEGIN
  -- 262's rule, unchanged. Row-locked first, so the row the UPDATE changes is
  -- the row that was judged and pending_before is its real prior value.
  SELECT m.clubdesk_id, m.clubdesk_push_pending
    INTO v_clubdesk_id, v_pending_before
    FROM members m
   WHERE m.id = NEW.members_id
     AND COALESCE(BTRIM(m.fee_category), '') = ''
     AND m.kscw_membership_active IS TRUE
     AND NOT EXISTS (SELECT 1 FROM member_teams mt
                      WHERE mt.member = NEW.members_id
                        AND COALESCE(mt.guest_level, 0) = 0)
     FOR UPDATE OF m;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  UPDATE members m SET
    fee_category = 'Gratis',
    clubdesk_push_pending = CASE WHEN m.clubdesk_id IS NOT NULL
      THEN true ELSE m.clubdesk_push_pending END,
    clubdesk_push_changes = CASE WHEN m.clubdesk_id IS NOT NULL THEN
      (SELECT COALESCE(jsonb_agg(e), '[]'::jsonb)
         FROM jsonb_array_elements(COALESCE(m.clubdesk_push_changes, '[]'::jsonb)) e
        WHERE e->>'field' NOT IN ('beitragskategorie', 'fee_category'))
      || jsonb_build_array(jsonb_build_object(
           'field', 'fee_category', 'old_value', NULL, 'new_value', 'Gratis'))
      ELSE m.clubdesk_push_changes END
  WHERE m.id = NEW.members_id;

  -- High-water mark for the revert's directus_revisions backstop. Directus owns
  -- that table and it is not in SCHEMA.sql, hence the guard (a bare database
  -- has none; plpgsql only plans the SELECT when it runs).
  IF to_regclass('public.directus_revisions') IS NOT NULL THEN
    SELECT COALESCE(max(r.id), 0) INTO v_revision_hwm FROM directus_revisions r;
  END IF;

  INSERT INTO user_logs (action, collection_name, record_id, data, "user", date_created)
  VALUES ('fee_category_auto', 'members', NEW.members_id::text,
          jsonb_build_object(
            'source', 'staff_gratis_fill',
            'field', 'fee_category',
            'value', 'Gratis',
            'team', NEW.teams_id,
            'junction', TG_TABLE_NAME,
            'junction_id', NEW.id,
            'clubdesk_queued', v_clubdesk_id IS NOT NULL,
            'pending_before', v_pending_before,
            'revision_hwm', v_revision_hwm)::json,
          NULL, now());

  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.staff_gratis_revert()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_member      integer := OLD.members_id;
  m             record;
  fill          record;
  v_hwm         bigint;
  v_changes     jsonb;
  v_had_entry   boolean := false;
  v_in_flight   boolean;
  v_reached     boolean;
  v_clear       boolean;
BEGIN
  -- Still staff somewhere (checked at COMMIT) → no seat ended. Cheapest test
  -- first: both junctions are a few hundred rows.
  IF EXISTS (SELECT 1 FROM teams_coaches WHERE members_id = v_member)
     OR EXISTS (SELECT 1 FROM teams_responsibles WHERE members_id = v_member) THEN
    RETURN NULL;
  END IF;

  BEGIN
    -- Locked so nothing changes the row between the checks and the UPDATE.
    -- NOT FOUND = the member was deleted and took this junction row with it.
    SELECT mm.fee_category, mm.clubdesk_id, mm.clubdesk_push_pending,
           mm.clubdesk_push_changes, mm.clubdesk_pushed_at, mm.date_updated
      INTO m
      FROM members mm
     WHERE mm.id = v_member
       FOR UPDATE;
    IF NOT FOUND OR m.fee_category IS DISTINCT FROM 'Gratis' THEN
      RETURN NULL;
    END IF;
    IF EXISTS (SELECT 1 FROM member_teams mt
                WHERE mt.member = v_member
                  AND COALESCE(mt.guest_level, 0) = 0) THEN
      RETURN NULL;
    END IF;

    -- The newest fee-category row on this member must be the fill's.
    SELECT l.id, l.action, l.date_created, l.data
      INTO fill
      FROM user_logs l
     WHERE l.collection_name = 'members'
       AND l.record_id = v_member::text
       AND (strpos(COALESCE(l.data::text, ''), 'beitragskategorie') > 0 OR strpos(COALESCE(l.data::text, ''), 'fee_category') > 0)
     ORDER BY l.id DESC
     LIMIT 1;
    IF NOT FOUND OR fill.action IS DISTINCT FROM 'fee_category_auto' THEN
      RETURN NULL;
    END IF;

    -- Backstop: an items-API write in system context names the column in a
    -- revision but leaves no user_logs row.
    v_hwm := (fill.data->>'revision_hwm')::bigint;
    IF v_hwm IS NOT NULL AND to_regclass('public.directus_revisions') IS NOT NULL THEN
      IF EXISTS (SELECT 1 FROM directus_revisions r
                  WHERE r.id > v_hwm
                    AND r.collection = 'members'
                    AND r.item = v_member::text
                    AND (strpos(COALESCE(r.delta::text, ''), 'beitragskategorie') > 0 OR strpos(COALESCE(r.delta::text, ''), 'fee_category') > 0)) THEN
        RETURN NULL;
      END IF;
    END IF;

    -- ClubDesk: is a sync-up carrying this member queued or running (its CSV is
    -- already built), or was the member pushed since the fill?
    v_in_flight := EXISTS (
      SELECT 1 FROM clubdesk_member_sync s
       WHERE s.id = 1
         AND s.up_state IN ('queued', 'running')
         AND jsonb_typeof(s.up_member_ids) = 'array'
         AND (s.up_member_ids @> to_jsonb(v_member)
              OR s.up_member_ids @> to_jsonb(v_member::text)));
    -- Unknown counts as reached: a false "check ClubDesk" is cheap, a missed one is not.
    v_reached := COALESCE(v_in_flight
      OR (m.clubdesk_pushed_at IS NOT NULL AND m.clubdesk_pushed_at >= fill.date_created), true);

    -- Drop the queued 'Gratis' entry (262's shape); keep every other entry.
    IF jsonb_typeof(m.clubdesk_push_changes) = 'array' AND EXISTS (
         SELECT 1 FROM jsonb_array_elements(m.clubdesk_push_changes) e
          WHERE e->>'field' IN ('beitragskategorie', 'fee_category')
            AND e->>'new_value' = 'Gratis') THEN
      v_had_entry := true;
      SELECT COALESCE(jsonb_agg(t.e ORDER BY t.ord), '[]'::jsonb)
        INTO v_changes
        FROM jsonb_array_elements(m.clubdesk_push_changes) WITH ORDINALITY AS t(e, ord)
       WHERE t.e->>'field' NOT IN ('beitragskategorie', 'fee_category');
    END IF;

    -- The pending flag goes only when the fill was provably its sole reason
    -- (see header: "array empty" alone is no proof).
    v_clear := COALESCE(v_had_entry
      AND jsonb_array_length(v_changes) = 0
      AND NOT v_reached
      AND (fill.data->>'pending_before') = 'false'
      AND (m.date_updated IS NULL OR m.date_updated <= fill.date_created)
      AND NOT EXISTS (SELECT 1 FROM user_logs l
                       WHERE l.collection_name = 'members'
                         AND l.record_id = v_member::text
                         AND l.id > fill.id), false);

    UPDATE members SET
      fee_category = NULL,
      clubdesk_push_changes = CASE WHEN v_had_entry
        THEN NULLIF(v_changes, '[]'::jsonb) ELSE clubdesk_push_changes END,
      clubdesk_push_pending = CASE WHEN v_clear
        THEN false ELSE clubdesk_push_pending END
    WHERE id = v_member;

    INSERT INTO user_logs (action, collection_name, record_id, data, "user", date_created)
    VALUES ('fee_category_auto_revert', 'members', v_member::text,
            jsonb_build_object(
              'source', 'staff_gratis_revert',
              'field', 'fee_category',
              'old_value', 'Gratis',
              'value', NULL,
              'team', OLD.teams_id,
              'junction', TG_TABLE_NAME,
              'junction_id', OLD.id,
              'auto_fill_log', fill.id,
              'clubdesk', CASE WHEN v_reached THEN 'needs_manual_fix'
                               WHEN v_had_entry THEN 'push_dequeued'
                               ELSE 'not_pushed' END,
              'push_entry_removed', v_had_entry,
              'push_pending_cleared', v_clear)::json,
            NULL, now());

    IF v_reached THEN
      INSERT INTO user_logs (action, collection_name, record_id, data, "user", date_created)
      VALUES ('fee_category_auto_revert_needs_clubdesk', 'members', v_member::text,
              jsonb_build_object(
                'source', 'staff_gratis_revert',
                'field', 'fee_category',
                'clubdesk_value', 'Gratis',
                'clubdesk_id', m.clubdesk_id,
                'reason', CASE WHEN v_in_flight THEN 'push_in_flight' ELSE 'pushed' END,
                'pushed_at', m.clubdesk_pushed_at,
                'auto_fill_log', fill.id,
                'action_needed', 'Clear the auto-assigned Gratis Beitragskategorie in ClubDesk by hand: the sync-up never blanks a register cell, and until then a sync-down proposes Gratis back.')::json,
              NULL, now());
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'staff_gratis_revert: member % not reverted: % (SQLSTATE %)',
      v_member, SQLERRM, SQLSTATE;
  END;

  RETURN NULL;
END $function$;

CREATE OR REPLACE FUNCTION public.trg_events_sport_section()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.permissions_section := kscw_event_sport_section(NEW.id);
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.trg_members_sport_section()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.permissions_section := kscw_member_sport_section(NEW.id, NEW.club_section, NEW.fee_category);
  RETURN NEW;
END $function$;

-- ── 3. Column names stored as data ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION pg_temp.member_col(p text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p
    WHEN 'adresse' THEN 'address' WHEN 'plz' THEN 'postal_code' WHEN 'ort' THEN 'city'
    WHEN 'billing_plz' THEN 'billing_postal_code' WHEN 'billing_ort' THEN 'billing_city'
    WHEN 'anrede' THEN 'salutation' WHEN 'ahv_nummer' THEN 'ahv_number'
    WHEN 'beitragskategorie' THEN 'fee_category' WHEN 'sektion' THEN 'club_section'
    WHEN 'eintritt' THEN 'joined_on' WHEN 'austritt' THEN 'left_on'
    WHEN 'is_spielplaner' THEN 'is_scheduler' WHEN 'kantonsschule' THEN 'cantonal_school'
    ELSE p END
$$;

UPDATE clubdesk_sync_proposals SET field = pg_temp.member_col(field)
 WHERE field IS DISTINCT FROM pg_temp.member_col(field);

UPDATE members m SET clubdesk_push_changes = (
    SELECT jsonb_agg(CASE WHEN jsonb_typeof(e) = 'object' AND e ? 'field'
                          THEN jsonb_set(e, '{field}', to_jsonb(pg_temp.member_col(e->>'field')))
                          ELSE e END ORDER BY ord)
      FROM jsonb_array_elements(m.clubdesk_push_changes) WITH ORDINALITY AS t(e, ord))
 WHERE jsonb_typeof(m.clubdesk_push_changes) = 'array'
   AND EXISTS (SELECT 1 FROM jsonb_array_elements(m.clubdesk_push_changes) e
                WHERE jsonb_typeof(e) = 'object'
                  AND e->>'field' IS DISTINCT FROM pg_temp.member_col(e->>'field'));

UPDATE clubdesk_field_map SET app_column = 'club_section'
 WHERE app_table = 'members' AND app_column = 'section';

-- Saved Data Studio layouts / filters on members.
UPDATE directus_presets p
   SET layout_query = CASE WHEN layout_query IS NULL THEN NULL ELSE (
         SELECT regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
                regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
                  layout_query::text,
                  '"adresse"', '"address"', 'g'), '"plz"', '"postal_code"', 'g'), '"ort"', '"city"', 'g'),
                  '"billing_plz"', '"billing_postal_code"', 'g'), '"billing_ort"', '"billing_city"', 'g'),
                  '"anrede"', '"salutation"', 'g'), '"ahv_nummer"', '"ahv_number"', 'g'),
                  '"beitragskategorie"', '"fee_category"', 'g'), '"sektion"', '"club_section"', 'g'),
                  '"sport_section"', '"permissions_section"', 'g'), '"eintritt"', '"joined_on"', 'g'),
                  '"austritt"', '"left_on"', 'g'), '"is_spielplaner"', '"is_scheduler"', 'g'),
                  '"kantonsschule"', '"cantonal_school"', 'g')::json) END,
       filter = CASE WHEN filter IS NULL THEN NULL ELSE (
         SELECT regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
                regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
                  filter::text,
                  '"adresse"', '"address"', 'g'), '"plz"', '"postal_code"', 'g'), '"ort"', '"city"', 'g'),
                  '"billing_plz"', '"billing_postal_code"', 'g'), '"billing_ort"', '"billing_city"', 'g'),
                  '"anrede"', '"salutation"', 'g'), '"ahv_nummer"', '"ahv_number"', 'g'),
                  '"beitragskategorie"', '"fee_category"', 'g'), '"sektion"', '"club_section"', 'g'),
                  '"sport_section"', '"permissions_section"', 'g'), '"eintritt"', '"joined_on"', 'g'),
                  '"austritt"', '"left_on"', 'g'), '"is_spielplaner"', '"is_scheduler"', 'g'),
                  '"kantonsschule"', '"cantonal_school"', 'g')::json) END
 WHERE collection IN ('members', 'events');

COMMIT;
