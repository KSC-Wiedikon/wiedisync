-- Migration 417: member values in English, step 3 of 3 — the fee category,
-- together with the finance tables that key on it (phase 2b-2c of the
-- English-only DB migration, plan: .planning/english-db-migration.md).
--
-- One vocabulary at a time for billing: members, registrations, the dues
-- schedule (finance_dues_rates), the books' income-account map and the
-- invoices all switch to the slug in this one transaction.
--
--   'VB Erwerbstätige' → vb_employed … 'Passivmitglied' → passive,
--   'Gratis' → free, 'Kein Beitrag' → none (clubdesk_value_map, domain
--   fee_category; legacy spellings collapse onto their slug).
--   New slug: vb_pupil_league_discounted ('VB Schüler*in Meisterschaft mit Abzug',
--   only ever in the income-account map).
--   finance_dues_rates.sektion follows the club-section slugs (416).
--
-- Invoices, emails and admin pages keep PRINTING the ClubDesk label
-- (member-values.js feeCategoryLabel) — decision 15.10.2026. The ClubDesk push
-- maps the slug back at the cell; the pull and the finance mirror import stage
-- slugs. The sport rule moves from the 'vb '/'bb ' prefix to 'vb_'/'bb_'
-- (kscw_member_sport_section accepts both during the switch).
--
-- Idempotent. finance_dues_runs.filter_json keeps the labels it was run with
-- (write-only audit).

BEGIN;

INSERT INTO clubdesk_value_map (domain, app_value, clubdesk_value, is_canonical) VALUES
  ('fee_category', 'vb_pupil_league_discounted', 'VB Schüler*in Meisterschaft mit Abzug', true)
ON CONFLICT (domain, clubdesk_value) DO NOTHING;

-- Any spelling → slug; an unknown value is kept (reported below, never lost).
CREATE OR REPLACE FUNCTION pg_temp.fee_slug(p text) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN p IS NULL OR btrim(p) = '' THEN NULLIF(btrim(p), '')
              ELSE COALESCE(cd_to_app('fee_category', p), p) END
$$;

-- ── 1. Functions that read or write the value ───────────────────────────────
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
    WHEN left(lower(btrim(coalesce(p_fee, ''), E' \t\r\n')), 3) IN ('vb_', 'vb ') THEN 'volleyball'
    WHEN left(lower(btrim(coalesce(p_fee, ''), E' \t\r\n')), 3) IN ('bb_', 'bb ') THEN 'basketball'
    ELSE 'both'
  END
  FROM n
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
    fee_category = 'free',
    clubdesk_push_pending = CASE WHEN m.clubdesk_id IS NOT NULL
      THEN true ELSE m.clubdesk_push_pending END,
    clubdesk_push_changes = CASE WHEN m.clubdesk_id IS NOT NULL THEN
      (SELECT COALESCE(jsonb_agg(e), '[]'::jsonb)
         FROM jsonb_array_elements(COALESCE(m.clubdesk_push_changes, '[]'::jsonb)) e
        WHERE e->>'field' NOT IN ('beitragskategorie', 'fee_category'))
      || jsonb_build_array(jsonb_build_object(
           'field', 'fee_category', 'old_value', NULL, 'new_value', 'free'))
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
            'value', 'free',
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
    IF NOT FOUND OR m.fee_category IS DISTINCT FROM 'free' THEN
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
            AND e->>'new_value' IN ('free', 'Gratis')) THEN
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
              'old_value', 'free',
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

-- ── 2. Values ────────────────────────────────────────────────────────────────
UPDATE members SET fee_category = pg_temp.fee_slug(fee_category)
 WHERE fee_category IS DISTINCT FROM pg_temp.fee_slug(fee_category);
UPDATE registrations SET fee_category = pg_temp.fee_slug(fee_category)
 WHERE fee_category IS DISTINCT FROM pg_temp.fee_slug(fee_category);
UPDATE finance_invoices SET fee_category = pg_temp.fee_slug(fee_category)
 WHERE fee_category IS DISTINCT FROM pg_temp.fee_slug(fee_category);

UPDATE finance_dues_rates
   SET category = pg_temp.fee_slug(category),
       sektion  = CASE lower(btrim(sektion)) WHEN 'volleyball' THEN 'volleyball' WHEN 'basketball' THEN 'basketball'
                    WHEN 'kscw' THEN 'club' WHEN '' THEN NULL ELSE sektion END
 WHERE category IS DISTINCT FROM pg_temp.fee_slug(category)
    OR sektion IS DISTINCT FROM (CASE lower(btrim(sektion)) WHEN 'volleyball' THEN 'volleyball' WHEN 'basketball' THEN 'basketball'
                                   WHEN 'kscw' THEN 'club' WHEN '' THEN NULL ELSE sektion END);

-- Income-account map: the key collapses (legacy spellings share their slug's
-- account — checked on prod 15.10.2026). Keep one row per slug; a mapped
-- account wins over an unmapped one, the newest edit over an older one.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM finance_income_account_map
              WHERE fee_category IS DISTINCT FROM pg_temp.fee_slug(fee_category)) THEN
    CREATE TEMP TABLE _iam ON COMMIT DROP AS
      SELECT DISTINCT ON (pg_temp.fee_slug(fee_category))
             pg_temp.fee_slug(fee_category) AS fee_category, account, date_updated, updated_by_name
        FROM finance_income_account_map
       ORDER BY pg_temp.fee_slug(fee_category), (account IS NULL), date_updated DESC;
    DELETE FROM finance_income_account_map;
    INSERT INTO finance_income_account_map (fee_category, account, date_updated, updated_by_name)
      SELECT fee_category, account, date_updated, updated_by_name FROM _iam;
  END IF;
END $$;

-- ── 3. Stored copies ─────────────────────────────────────────────────────────
UPDATE clubdesk_sync_proposals
   SET current_value  = pg_temp.fee_slug(current_value),
       proposed_value = pg_temp.fee_slug(proposed_value)
 WHERE field = 'fee_category'
   AND (current_value IS DISTINCT FROM pg_temp.fee_slug(current_value)
     OR proposed_value IS DISTINCT FROM pg_temp.fee_slug(proposed_value));

UPDATE members m SET clubdesk_push_changes = (
    SELECT jsonb_agg(CASE
             WHEN jsonb_typeof(e) = 'object' AND e->>'field' = 'fee_category'
             THEN e || jsonb_build_object('old_value', pg_temp.fee_slug(e->>'old_value'),
                                          'new_value', pg_temp.fee_slug(e->>'new_value'))
             ELSE e END ORDER BY ord)
      FROM jsonb_array_elements(m.clubdesk_push_changes) WITH ORDINALITY AS t(e, ord))
 WHERE jsonb_typeof(m.clubdesk_push_changes) = 'array'
   AND EXISTS (SELECT 1 FROM jsonb_array_elements(m.clubdesk_push_changes) e
                WHERE jsonb_typeof(e) = 'object' AND e->>'field' = 'fee_category');

-- ── 4. CHECKs (members + registrations: the categories the club bills) ──────
DO $$
DECLARE v_slugs text[] := ARRAY['vb_employed','vb_student_league','vb_pupil_league','vb_pupil_tournament',
  'vb_pupil_first_year','vb_tournament_kwi','vb_student_discounted','vb_pupil_league_discounted',
  'bb_employed','bb_employed_first_league','bb_student','bb_student_first_league','bb_youth_league',
  'bb_minis_tournament','bb_2_trainings','bb_1_training','passive','free','none'];
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'members_fee_category_values') THEN
    EXECUTE format('ALTER TABLE members ADD CONSTRAINT members_fee_category_values CHECK (fee_category IS NULL OR fee_category = ANY (%L::text[]))', v_slugs);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'registrations_fee_category_values') THEN
    EXECUTE format('ALTER TABLE registrations ADD CONSTRAINT registrations_fee_category_values CHECK (fee_category IS NULL OR fee_category = ANY (%L::text[]))', v_slugs);
  END IF;
END $$;

COMMENT ON COLUMN members.fee_category IS 'Fee category slug (migration 417): vb_employed … passive / free / none. ClubDesk Beitragskategorie via member-values.js feeCategoryLabel / clubdesk_value_map.';

COMMIT;
