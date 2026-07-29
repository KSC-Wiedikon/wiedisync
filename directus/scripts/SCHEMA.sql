-- ============================================================================
-- KSCW SCHEMA baseline — GENERATED, DO NOT EDIT BY HAND
-- ============================================================================
--
-- Generated:   2026-07-29T14:01:53.401Z
-- Source:      prod (db=postgres)
-- Generator:   directus/scripts/regenerate-baseline.mjs
--
-- This is the consolidated DDL/triggers/FKs/grants snapshot for a FRESH
-- install. Re-running it on an existing DB is unsafe — apply only on a
-- clean Postgres database, then run setup-permissions.mjs and any post-
-- baseline migrations via apply-migrations.mjs.
--
-- DO NOT EDIT MANUALLY — regenerate via:
--   npm run db:baseline:prod
-- after applying schema migrations on prod.
--
-- Permissions are NOT in this file. They live in setup-permissions.mjs
-- (canonical declarative source). Run after applying SCHEMA.sql.
-- ============================================================================

--
-- PostgreSQL database dump
--

\restrict Lf8DJ0dqzKlFEXiGngWiatht4HjqIY84jgr5nlhrDhCyVcMNKWJ9DHNV3hoLjhJ

-- Dumped from database version 16.14 (Debian 16.14-1.pgdg13+1)
-- Dumped by pg_dump version 16.14 (Debian 16.14-1.pgdg13+1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;


--
-- Name: EXTENSION pgcrypto; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';


--
-- Name: unaccent; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA public;


--
-- Name: EXTENSION unaccent; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION unaccent IS 'text search dictionary that removes accents';


--
-- Name: svrz_push_status_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.svrz_push_status_enum AS ENUM (
    'pending',
    'pushed',
    'failed'
);


--
-- Name: clubdesk_offliz_to_dx(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.clubdesk_offliz_to_dx(offliz text) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$
  SELECT CASE
    WHEN offliz LIKE '%Volleyball Lizenz%'            THEN 'scorer_vb'
    WHEN upper(btrim(offliz)) = 'OTR1'               THEN 'otr1_bb'
    WHEN upper(btrim(offliz)) = 'OTR2'               THEN 'otr2_bb'
    -- Levels before the bare value, or 'OTN1' would never be reached.
    WHEN upper(replace(btrim(offliz), ' ', '')) = 'OTN1' THEN 'otn1_bb'
    WHEN upper(replace(btrim(offliz), ' ', '')) = 'OTN2' THEN 'otn2_bb'
    WHEN upper(btrim(offliz)) = 'OTN'                THEN 'otn_bb'
    ELSE NULL
  END;
$$;


--
-- Name: FUNCTION clubdesk_offliz_to_dx(offliz text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.clubdesk_offliz_to_dx(offliz text) IS 'ClubDesk "Offiziellen Lizenz" string -> members column name. OTN1/OTN2 added 2026-07-25 (migration 229); bare OTN still maps to the coarse otn_bb. NULL = no licence expected.';


--
-- Name: finance_native_txn_lock(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.finance_native_txn_lock() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
DECLARE new_status text; DECLARE old_status text;
BEGIN
  -- Target year (INSERT/UPDATE): cannot write into a closed year — and a native
  -- row must HAVE a year, else the closed-year check can never apply to it.
  IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.source = 'native' THEN
    IF NEW.fiscal_year IS NULL THEN
      RAISE EXCEPTION 'A native ledger entry must carry a fiscal year — a year-less row can never be locked by the year-end close';
    END IF;
    SELECT status INTO new_status FROM finance_fiscal_years WHERE id = NEW.fiscal_year;
    IF new_status = 'closed' THEN
      RAISE EXCEPTION 'Cannot % a native ledger entry in a closed fiscal year — post a reversal in an open year instead', lower(TG_OP);
    END IF;
  END IF;
  -- Current year (UPDATE/DELETE): cannot touch a row that belongs to a closed
  -- year — this is what blocks the fiscal_year re-point bypass.
  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.source = 'native' THEN
    SELECT status INTO old_status FROM finance_fiscal_years WHERE id = OLD.fiscal_year;
    IF old_status = 'closed' THEN
      RAISE EXCEPTION 'Cannot % a native ledger entry that belongs to a closed fiscal year — post a reversal in an open year instead', lower(TG_OP);
    END IF;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;


--
-- Name: fn_activity_chat_event_delete(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_activity_chat_event_delete() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  DELETE FROM conversations
   WHERE type          = 'activity_chat'
     AND activity_type = 'event'
     AND activity_id   = OLD.id;
  RETURN OLD;
END;
$$;


--
-- Name: fn_messaging_dm_autoaccept(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_messaging_dm_autoaccept() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT mr.id AS request_id, mr.conversation AS conv_id,
           mr.sender AS sender_id, mr.recipient AS recipient_id
      FROM message_requests mr
      JOIN member_teams other_mt
        ON other_mt.team = NEW.team
       AND other_mt.member <> NEW.member
     WHERE mr.status = 'pending'
       AND (
         (mr.sender = NEW.member    AND mr.recipient = other_mt.member) OR
         (mr.recipient = NEW.member AND mr.sender    = other_mt.member)
       )
       AND NOT EXISTS (
         SELECT 1 FROM blocks b
          WHERE (b.blocker = mr.sender    AND b.blocked = mr.recipient)
             OR (b.blocker = mr.recipient AND b.blocked = mr.sender)
       )
  LOOP
    UPDATE message_requests
       SET status = 'accepted',
           resolved_at = CURRENT_TIMESTAMP
     WHERE id = r.request_id;
    UPDATE conversations
       SET type = 'dm'
     WHERE id = r.conv_id;
  END LOOP;
  RETURN NEW;
END;
$$;


--
-- Name: fn_messaging_member_team_chat_enabled(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_messaging_member_team_chat_enabled() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NEW.communications_team_chat_enabled = OLD.communications_team_chat_enabled THEN
    RETURN NEW;  -- no change (e.g. UPDATE of another column caused this fire)
  END IF;

  IF NEW.communications_team_chat_enabled = true THEN
    -- Opt in: un-archive conversation_members rows for all teams this member belongs to
    UPDATE conversation_members cm
       SET archived = false
      FROM conversations c
      JOIN member_teams mt ON mt.team = c.team
     WHERE cm.conversation = c.id
       AND cm.member = NEW.id
       AND c.type = 'team'
       AND mt.member = NEW.id;
  ELSE
    -- Opt out: archive all team conversation_members rows
    UPDATE conversation_members cm
       SET archived = true
      FROM conversations c
     WHERE cm.conversation = c.id
       AND cm.member = NEW.id
       AND c.type = 'team';
  END IF;

  RETURN NEW;
END;
$$;


--
-- Name: fn_messaging_teams_insert(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_messaging_teams_insert() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
DECLARE
  v_conv    uuid;
  v_creator integer;
BEGIN
  v_conv := gen_random_uuid();

  -- Creator fallback 1: first coach of the team
  SELECT tc.members_id INTO v_creator
    FROM teams_coaches tc
   WHERE tc.teams_id = NEW.id
   ORDER BY tc.id
   LIMIT 1;

  -- Creator fallback 2: first admin or superuser (members.role is JSON)
  IF v_creator IS NULL THEN
    SELECT id INTO v_creator
      FROM members
     WHERE role::jsonb ?| ARRAY['admin','superuser']
     ORDER BY id
     LIMIT 1;
  END IF;

  -- Creator fallback 3: sentinel system user
  IF v_creator IS NULL THEN
    SELECT id INTO v_creator
      FROM members
     WHERE LOWER(email) = 'system@kscw.ch'
     LIMIT 1;
  END IF;

  -- Create the team conversation with resolved creator
  INSERT INTO conversations (id, type, team, created_by, created_at)
  VALUES (v_conv, 'team', NEW.id, v_creator, CURRENT_TIMESTAMP);

  -- Add ALL existing team members; archived reflects each member's chat preference
  INSERT INTO conversation_members (id, conversation, member, archived)
  SELECT gen_random_uuid(), v_conv, mt.member,
         NOT COALESCE(m.communications_team_chat_enabled, false)
    FROM member_teams mt
    JOIN members m ON m.id = mt.member
   WHERE mt.team = NEW.id
  ON CONFLICT (conversation, member) DO NOTHING;

  RETURN NEW;
END;
$$;


--
-- Name: fn_messaging_teams_members_delete(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_messaging_teams_members_delete() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
DECLARE
  v_conv uuid;
BEGIN
  -- Find the team conversation
  SELECT id INTO v_conv
    FROM conversations
   WHERE type = 'team'
     AND team = OLD.team
   LIMIT 1;

  IF v_conv IS NULL THEN
    RETURN OLD;
  END IF;

  -- Archive (soft-remove) rather than hard-delete to preserve history
  UPDATE conversation_members
     SET archived = true
   WHERE conversation = v_conv
     AND member = OLD.member;

  RETURN OLD;
END;
$$;


--
-- Name: fn_messaging_teams_members_insert(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_messaging_teams_members_insert() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
DECLARE
  v_conv uuid;
  v_enabled boolean;
BEGIN
  -- Find the team conversation (if any)
  SELECT id INTO v_conv
    FROM conversations
   WHERE type = 'team'
     AND team = NEW.team
   LIMIT 1;

  IF v_conv IS NULL THEN
    RETURN NEW;  -- no conversation yet; teams INSERT trigger will handle it
  END IF;

  -- Look up member's chat preference; default false if NULL
  SELECT communications_team_chat_enabled INTO v_enabled
    FROM members WHERE id = NEW.member;

  -- ALWAYS insert — archived = NOT enabled (false = visible, true = hidden)
  -- Upsert: if somehow a row exists, update archived to reflect current preference
  INSERT INTO conversation_members (id, conversation, member, archived)
  VALUES (gen_random_uuid(), v_conv, NEW.member, NOT COALESCE(v_enabled, false))
  ON CONFLICT (conversation, member)
    DO UPDATE SET archived = EXCLUDED.archived;

  RETURN NEW;
END;
$$;


--
-- Name: fn_participations_activity_chat_sync(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_participations_activity_chat_sync() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
DECLARE
  v_row            participations%ROWTYPE;
  v_is_insert_upd  boolean;
  v_activity_id    integer;
  v_conv           uuid;
  v_banned         boolean;
  v_team_enabled   boolean;
  v_in_audience    boolean;
BEGIN
  -- Resolve which row to inspect for NEW vs. OLD (DELETE uses OLD).
  IF TG_OP = 'DELETE' THEN
    v_row := OLD;
    v_is_insert_upd := false;
  ELSE
    v_row := NEW;
    v_is_insert_upd := true;
  END IF;

  -- Event-only early exit
  IF v_row.activity_type IS DISTINCT FROM 'event' THEN
    RETURN v_row;
  END IF;

  -- activity_id cast: text → int; silently skip if non-numeric
  BEGIN
    v_activity_id := v_row.activity_id::integer;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN v_row;
  END;

  -- Resolve conversation (must already exist; broadcast endpoint is sole creator)
  SELECT id INTO v_conv
    FROM conversations
   WHERE type = 'activity_chat'
     AND activity_type = 'event'
     AND activity_id = v_activity_id
   LIMIT 1;

  IF v_conv IS NULL THEN
    RETURN v_row;  -- no conversation → nothing to sync
  END IF;

  -- Load member flags
  SELECT communications_banned, communications_team_chat_enabled
    INTO v_banned, v_team_enabled
    FROM members
   WHERE id = v_row.member;

  IF NOT FOUND THEN
    RETURN v_row;  -- orphan member reference; shouldn't happen but be safe
  END IF;

  -- Banned: always remove
  IF v_banned = true THEN
    DELETE FROM conversation_members
     WHERE conversation = v_conv
       AND member       = v_row.member;
    RETURN v_row;
  END IF;

  -- Determine if this status+op keeps the member in the audience
  v_in_audience := v_is_insert_upd
                   AND v_row.status IN ('confirmed', 'tentative');

  IF v_in_audience THEN
    -- Upsert with archived reflecting team_chat preference
    INSERT INTO conversation_members
      (id, conversation, member, archived, role, joined_at)
    VALUES
      (gen_random_uuid(), v_conv, v_row.member,
       NOT COALESCE(v_team_enabled, false),
       'member', NOW())
    ON CONFLICT (conversation, member)
      DO UPDATE SET archived = EXCLUDED.archived;
  ELSE
    -- Not in audience (declined/waitlist/invited, or DELETE): archive (soft)
    UPDATE conversation_members
       SET archived = true
     WHERE conversation = v_conv
       AND member       = v_row.member;
  END IF;

  RETURN v_row;
END;
$$;


--
-- Name: kscw_compute_fine_amount(integer, integer, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.kscw_compute_fine_amount(p_member integer, p_team integer, p_category text) RETURNS TABLE(amount numeric, tier_offense integer, reset_window_at_issue text)
    LANGUAGE plpgsql STABLE
    SET search_path TO 'public'
    AS $$
DECLARE
  v_rule          record;
  v_window_start  timestamptz;
  v_prior_count   integer;
  v_offense_no    integer;
  v_tier          jsonb;
  v_amount        numeric;
BEGIN
  -- 1. Load the rule. No enabled rule → no rows returned.
  SELECT * INTO v_rule
  FROM fine_rules
  WHERE team = p_team
    AND category = p_category
    AND enabled = true
  LIMIT 1;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- 2. Window start.
  v_window_start := kscw_fine_window_start(v_rule.reset_window, now());

  -- 3. Count prior non-waived fines in window.
  SELECT COUNT(*)::int INTO v_prior_count
  FROM fines
  WHERE member = p_member
    AND team = p_team
    AND category = p_category
    AND status <> 'waived'
    AND issued_at >= v_window_start;
  v_offense_no := v_prior_count + 1;

  -- 4. Tier lookup.
  --    a. exact match on `offense`
  --    b. fall through to highest `offense_min` ≤ offense_no
  --    c. fall through to last tier (any shape)
  v_amount := NULL;

  -- Exact match
  SELECT t INTO v_tier
  FROM jsonb_array_elements(v_rule.tiers) AS t
  WHERE (t->>'offense')::int = v_offense_no
  LIMIT 1;
  IF v_tier IS NOT NULL THEN
    v_amount := (v_tier->>'amount')::numeric;
  END IF;

  -- Highest offense_min ≤ offense_no
  IF v_amount IS NULL THEN
    SELECT t INTO v_tier
    FROM jsonb_array_elements(v_rule.tiers) AS t
    WHERE (t ? 'offense_min') AND (t->>'offense_min')::int <= v_offense_no
    ORDER BY (t->>'offense_min')::int DESC
    LIMIT 1;
    IF v_tier IS NOT NULL THEN
      v_amount := (v_tier->>'amount')::numeric;
    END IF;
  END IF;

  -- Last tier as fallback (covers misconfigured rules with only exact tiers and
  -- a higher offense than any covered — leader still gets a hint).
  -- WITH ORDINALITY exposes the array index so we can pick the *last* element.
  IF v_amount IS NULL THEN
    SELECT elem INTO v_tier
    FROM jsonb_array_elements(v_rule.tiers) WITH ORDINALITY AS arr(elem, ord)
    ORDER BY arr.ord DESC
    LIMIT 1;
    IF v_tier IS NOT NULL THEN
      v_amount := (v_tier->>'amount')::numeric;
    END IF;
  END IF;

  IF v_amount IS NULL THEN
    -- Rule exists but tiers is empty / malformed. Refuse to guess.
    RETURN;
  END IF;

  amount := v_amount;
  tier_offense := v_offense_no;
  reset_window_at_issue := v_rule.reset_window;
  RETURN NEXT;
END;
$$;


--
-- Name: FUNCTION kscw_compute_fine_amount(p_member integer, p_team integer, p_category text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.kscw_compute_fine_amount(p_member integer, p_team integer, p_category text) IS 'Escalation engine. Counts prior non-waived fines in the rule''s reset window, then picks the matching tier: exact offense first, then highest offense_min ≤ N, then last tier as fallback. Returns no rows if no enabled rule or empty tiers — caller must handle.';


--
-- Name: kscw_current_season_start(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.kscw_current_season_start() RETURNS date
    LANGUAGE plpgsql STABLE
    SET search_path TO 'public'
    AS $$
DECLARE
  v_now date := (now() AT TIME ZONE 'Europe/Zurich')::date;
  v_year int := EXTRACT(YEAR FROM v_now)::int;
  v_month int := EXTRACT(MONTH FROM v_now)::int;
BEGIN
  -- JS getMonth() is 0-indexed (May=4, Jun=5); PG EXTRACT MONTH is 1-indexed.
  -- JS check: month < 5 (Jan–May) → previous Sep.
  -- PG equivalent: month <= 5 (Jan–May) → previous Sep. Jun flips both ways:
  -- JS month 5 (Jun) < 5 = false; PG month 6 (Jun) <= 5 = false. Aligned.
  IF v_month <= 5 THEN
    RETURN make_date(v_year - 1, 9, 1);
  ELSE
    RETURN make_date(v_year, 9, 1);
  END IF;
END;
$$;


--
-- Name: FUNCTION kscw_current_season_start(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.kscw_current_season_start() IS 'Sep 1 of the current season, where "current" flips on the Jun 1 cutover (migration 268). Mirrors getCurrentSeason() in src/utils/dateHelpers.ts — keep the two in lockstep. NOTE between Jun 1 and Aug 31 this returns a date in the FUTURE (the season has rolled over but its fixture calendar has not started); callers that need a window START must not anchor on it naked — see kscw_fine_window_start. STABLE (not IMMUTABLE — depends on now()); do not use in indexes or generated columns.';


--
-- Name: kscw_fine_window_start(text, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.kscw_fine_window_start(p_window text, p_ts timestamp with time zone) RETURNS timestamp with time zone
    LANGUAGE plpgsql STABLE
    SET search_path TO 'public'
    AS $$
BEGIN
  CASE p_window
    WHEN 'calendar_month' THEN
      RETURN date_trunc('month', p_ts AT TIME ZONE 'Europe/Zurich')
             AT TIME ZONE 'Europe/Zurich';
    WHEN 'rolling_30d' THEN
      RETURN p_ts - interval '30 days';
    WHEN 'rolling_90d' THEN
      RETURN p_ts - interval '90 days';
    WHEN 'season' THEN
      RETURN (((kscw_current_season_start() - interval '3 months')::date)::timestamp
              AT TIME ZONE 'Europe/Zurich');
    WHEN 'never' THEN
      RETURN 'epoch'::timestamptz;
    ELSE
      -- Unknown window — be conservative and count everything.
      RETURN 'epoch'::timestamptz;
  END CASE;
END;
$$;


--
-- Name: FUNCTION kscw_fine_window_start(p_window text, p_ts timestamp with time zone); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.kscw_fine_window_start(p_window text, p_ts timestamp with time zone) IS 'Start timestamp of the offense-counter window for a fine_rules.reset_window value. calendar_month anchors to the 1st of the month; season anchors to the Jun 1 season rollover (migration 268 — NOT Sep 1, which is in the future for a third of the season and would drop every summer offense); rolling windows subtract N days from now. All wall-clock anchors are Europe/Zurich.';


--
-- Name: kscw_normalize_phone(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.kscw_normalize_phone(raw text) RETURNS text
    LANGUAGE plpgsql IMMUTABLE
    AS $_$
DECLARE
  s text; compact text; cc text; nat text;
BEGIN
  s := btrim(coalesce(raw, ''));
  IF s = '' THEN RETURN NULL; END IF;
  -- Decorations → spaces: apostrophes (legacy CSV-guard corruption), ./-/()
  s := regexp_replace(s, '[''’/.()-]', ' ', 'g');
  s := btrim(regexp_replace(s, '\s+', ' ', 'g'));
  IF s ~ '[^0-9+ ]' THEN RETURN NULL; END IF;
  compact := replace(s, ' ', '');
  -- at most one '+', and only leading
  IF length(compact) - length(replace(compact, '+', '')) > 1
     OR position('+' in compact) > 1 THEN RETURN NULL; END IF;
  IF left(compact, 1) = '+' THEN cc := substr(compact, 2);
  ELSIF left(compact, 2) = '00' THEN cc := substr(compact, 3);
  ELSIF left(compact, 1) = '0' THEN
    nat := substr(compact, 2);
    -- 10-digit Swiss national only; 9-digit values are pre-2007 numbers → NULL
    IF length(nat) <> 9 THEN RETURN NULL; END IF;
    cc := '41' || nat;
  ELSIF length(compact) = 11 AND left(compact, 2) = '41' THEN cc := compact;
  -- bare 9 digits = Swiss national typed without the 0 (14 prod cases 2026-07-07)
  ELSIF length(compact) = 9 THEN cc := '41' || compact;
  ELSE RETURN NULL;
  END IF;
  IF cc !~ '^[1-9][0-9]{7,14}$' THEN RETURN NULL; END IF;
  IF left(cc, 2) = '41' THEN
    nat := substr(cc, 3);
    IF length(nat) = 10 AND left(nat, 1) = '0' THEN nat := substr(nat, 2); END IF; -- "+41 (0)79 …"
    IF length(nat) <> 9 OR left(nat, 1) = '0' THEN RETURN NULL; END IF;
    RETURN '+41 ' || substr(nat, 1, 2) || ' ' || substr(nat, 3, 3) || ' '
                  || substr(nat, 6, 2) || ' ' || substr(nat, 8, 2);
  END IF;
  RETURN '+' || cc;
END $_$;


--
-- Name: members_prevent_email_blanking(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.members_prevent_email_blanking() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  IF OLD.email IS NOT NULL AND btrim(OLD.email) <> ''
     AND (NEW.email IS NULL OR btrim(NEW.email) = '') THEN
    RAISE EXCEPTION
      'members.email cannot be cleared once set (member id %): it is the member''s only contact channel and is required for notifications and ClubDesk sync', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: members_sync_nationality(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.members_sync_nationality() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
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
END $$;


--
-- Name: messaging_protect_sentinel(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.messaging_protect_sentinel() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  IF LOWER(OLD.email) = 'system@kscw.ch' THEN
    RAISE EXCEPTION 'Cannot delete messaging sentinel member (%)', OLD.id;
  END IF;
  RETURN OLD;
END;
$$;


--
-- Name: notify_event_change(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.notify_event_change() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
DECLARE
  v_type text; v_title text; v_id integer;
BEGIN
  IF TG_OP = 'DELETE' THEN v_id := OLD.id; ELSE v_id := NEW.id; END IF;
  
  IF TG_OP = 'INSERT' THEN v_type := 'new_activity';
  ELSIF TG_OP = 'DELETE' THEN v_type := 'cancellation';
  ELSE v_type := 'activity_update'; END IF;
  
  v_title := COALESCE((SELECT title FROM events WHERE id = v_id), 'Event');
  
  IF TG_OP != 'DELETE' THEN
    IF NEW.start_date < CURRENT_DATE THEN RETURN NEW; END IF;
  END IF;

  INSERT INTO notifications (member, type, title, body, activity_type, activity_id, team, read)
  SELECT DISTINCT mt.member, v_type, v_title, '', 'event', v_id::text, et.teams_id, false
  FROM events_teams et
  JOIN member_teams mt ON mt.team = et.teams_id
  WHERE et.events_id = v_id;

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;


--
-- Name: staff_gratis_fill(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.staff_gratis_fill() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  UPDATE members m SET
    beitragskategorie = 'Gratis',
    clubdesk_push_pending = CASE WHEN m.clubdesk_id IS NOT NULL
      THEN true ELSE m.clubdesk_push_pending END,
    clubdesk_push_changes = CASE WHEN m.clubdesk_id IS NOT NULL THEN
      (SELECT COALESCE(jsonb_agg(e), '[]'::jsonb)
         FROM jsonb_array_elements(COALESCE(m.clubdesk_push_changes, '[]'::jsonb)) e
        WHERE e->>'field' <> 'beitragskategorie')
      || jsonb_build_array(jsonb_build_object(
           'field', 'beitragskategorie', 'old_value', NULL, 'new_value', 'Gratis'))
      ELSE m.clubdesk_push_changes END
  WHERE m.id = NEW.members_id
    AND COALESCE(BTRIM(m.beitragskategorie), '') = ''
    AND m.kscw_membership_active IS TRUE
    AND NOT EXISTS (SELECT 1 FROM member_teams mt
                     WHERE mt.member = NEW.members_id
                       AND COALESCE(mt.guest_level, 0) = 0);
  RETURN NEW;
END $$;


--
-- Name: trg_absences_normalize_indefinite(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trg_absences_normalize_indefinite() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NEW.end_date IS NULL THEN
    NEW.indefinite := TRUE;
  END IF;
  IF NEW.indefinite IS TRUE THEN
    NEW.end_date := DATE '2099-12-31';
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: trg_activity_purge_polymorphic(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trg_activity_purge_polymorphic() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  DELETE FROM participations WHERE activity_type = TG_ARGV[0] AND activity_id = OLD.id::text;
  DELETE FROM notifications
   WHERE activity_type = TG_ARGV[0] AND activity_id = OLD.id::text
     AND title NOT IN ('training_deleted', 'game_deleted', 'event_deleted');
  RETURN OLD;
END;
$$;


--
-- Name: trg_events_notify(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trg_events_notify() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
DECLARE
  v_type text;
  v_title_key text;
  v_body text;
  v_id integer;
  v_location text;
BEGIN
  IF TG_OP = 'DELETE' THEN v_id := OLD.id; ELSE v_id := NEW.id; END IF;

  v_location := '';
  IF TG_OP != 'DELETE' AND NEW.location IS NOT NULL THEN
    v_location := NEW.location;
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_type := 'activity_change'; v_title_key := 'event_created';
    v_body := json_build_object(
      'title', COALESCE(NEW.title, ''),
      'date', COALESCE(to_char(NEW.start_date, 'DD.MM.YY'), ''),
      'time', COALESCE(to_char(NEW.start_date, 'HH24:MI'), ''),
      'location', v_location
    )::text;
  ELSIF TG_OP = 'UPDATE' THEN
    v_type := 'activity_change'; v_title_key := 'event_updated';
    v_body := json_build_object(
      'title', COALESCE(NEW.title, ''),
      'date', COALESCE(to_char(NEW.start_date, 'DD.MM.YY'), ''),
      'time', COALESCE(to_char(NEW.start_date, 'HH24:MI'), ''),
      'location', v_location
    )::text;
  ELSIF TG_OP = 'DELETE' THEN
    v_type := 'activity_change'; v_title_key := 'event_deleted';
    v_body := json_build_object(
      'title', COALESCE(OLD.title, '')
    )::text;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD.start_date < CURRENT_DATE THEN RETURN OLD; END IF;
  ELSE
    IF NEW.start_date < CURRENT_DATE THEN RETURN NEW; END IF;
  END IF;

  INSERT INTO notifications (member, type, title, body, activity_type, activity_id, team, read)
  SELECT DISTINCT mt.member, v_type, v_title_key, v_body, 'event', v_id::text, et.teams_id, false
  FROM events_teams et
  JOIN member_teams mt ON mt.team = et.teams_id
  WHERE et.events_id = v_id;

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;


--
-- Name: trg_form_submissions_guard(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trg_form_submissions_guard() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
DECLARE
  f forms%ROWTYPE;
BEGIN
  SELECT * INTO f FROM forms WHERE id = NEW.form;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'form_submissions: form % does not exist', NEW.form;
  END IF;
  IF f.status <> 'open' THEN
    RAISE EXCEPTION 'form_submissions: form % is not open (status=%)', NEW.form, f.status;
  END IF;
  IF f.closes_at IS NOT NULL AND now() > f.closes_at THEN
    RAISE EXCEPTION 'form_submissions: form % is past its deadline (%)', NEW.form, f.closes_at;
  END IF;
  IF NEW.member IS NOT NULL AND NOT f.allow_multiple AND EXISTS (
    SELECT 1 FROM form_submissions s WHERE s.form = NEW.form AND s.member = NEW.member
  ) THEN
    RAISE EXCEPTION 'form_submissions: member % already submitted to form %', NEW.member, NEW.form;
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: trg_form_submissions_update_guard(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trg_form_submissions_update_guard() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
DECLARE
  f forms%ROWTYPE;
BEGIN
  -- Only re-validate when the answers actually change (status flips / admin
  -- back-office edits on other columns shouldn't be blocked by a closed form).
  IF NEW.answers IS NOT DISTINCT FROM OLD.answers THEN
    RETURN NEW;
  END IF;
  SELECT * INTO f FROM forms WHERE id = NEW.form;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'form_submissions: form % does not exist', NEW.form;
  END IF;
  IF f.status <> 'open' THEN
    RAISE EXCEPTION 'form_submissions: form % is not open (status=%)', NEW.form, f.status;
  END IF;
  IF f.closes_at IS NOT NULL AND now() > f.closes_at THEN
    RAISE EXCEPTION 'form_submissions: form % is past its deadline (%)', NEW.form, f.closes_at;
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: trg_games_notify(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trg_games_notify() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
DECLARE
  v_type text; v_title text; v_body text; v_team_id int; v_game_id int;
  v_hall text; v_rec record;
BEGIN
  -- Silencer for bulk re-point during season rollover. Second arg `true` =
  -- return empty string if unset instead of raising.
  IF current_setting('kscw.skip_games_notify', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  -- Pick the right row for field access
  IF TG_OP = 'DELETE' THEN v_rec := OLD; ELSE v_rec := NEW; END IF;
  v_team_id := v_rec.kscw_team; v_game_id := v_rec.id;
  IF v_team_id IS NULL THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  -- Resolve hall name
  SELECT COALESCE(h.name, '') INTO v_hall FROM halls h WHERE h.id = v_rec.hall;
  v_hall := COALESCE(v_hall, '');

  IF TG_OP = 'INSERT' THEN
    v_type := 'activity_change'; v_title := 'game_created';
    v_body := json_build_object(
      'home_team', COALESCE(NEW.home_team, ''), 'away_team', COALESCE(NEW.away_team, ''),
      'date', COALESCE(to_char(NEW.date, 'DD.MM.YY'), ''),
      'time', COALESCE(to_char(NEW.time, 'HH24:MI'), ''), 'hall', v_hall
    )::text;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.status = 'completed' AND (OLD.status IS DISTINCT FROM 'completed') THEN
      v_type := 'result_available'; v_title := 'game_result';
      v_body := json_build_object(
        'home_team', COALESCE(NEW.home_team, ''), 'away_team', COALESCE(NEW.away_team, ''),
        'home_score', COALESCE(NEW.home_score::text, '0'), 'away_score', COALESCE(NEW.away_score::text, '0')
      )::text;
    ELSIF NEW.status = 'cancelled' AND (OLD.status IS DISTINCT FROM 'cancelled') THEN
      v_type := 'activity_change'; v_title := 'game_deleted';
      v_body := json_build_object(
        'home_team', COALESCE(NEW.home_team, ''), 'away_team', COALESCE(NEW.away_team, ''),
        'date', COALESCE(to_char(NEW.date, 'DD.MM.YY'), '')
      )::text;
    ELSIF OLD.status = 'cancelled' AND NEW.status = 'scheduled' THEN
      -- Un-cancel: the team was told "game cancelled" — a silent reappearance
      -- (previously the cosmetic-mute branch when date/time were unchanged)
      -- must not happen. completed is handled above; cancelled→postponed
      -- deliberately does NOT announce "reinstated" (still not happening).
      v_type := 'activity_change'; v_title := 'game_reinstated';
      v_body := json_build_object(
        'home_team', COALESCE(NEW.home_team, ''), 'away_team', COALESCE(NEW.away_team, ''),
        'date', COALESCE(to_char(NEW.date, 'DD.MM.YY'), ''),
        'time', COALESCE(to_char(NEW.time, 'HH24:MI'), ''), 'hall', v_hall
      )::text;
    ELSE
      -- Mute cosmetic updates: only notify when the game was actually rescheduled
      -- (date or time changed). Everything else (referee/set/league/round churn
      -- from the SV feed, in-progress scores) writes the row silently.
      IF NEW.date IS NOT DISTINCT FROM OLD.date AND NEW.time IS NOT DISTINCT FROM OLD.time THEN
        RETURN NEW;
      END IF;
      v_type := 'activity_change'; v_title := 'game_updated';
      v_body := json_build_object(
        'home_team', COALESCE(NEW.home_team, ''), 'away_team', COALESCE(NEW.away_team, ''),
        'date', COALESCE(to_char(NEW.date, 'DD.MM.YY'), ''),
        'time', COALESCE(to_char(NEW.time, 'HH24:MI'), ''), 'hall', v_hall
      )::text;
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    v_type := 'activity_change'; v_title := 'game_deleted';
    v_body := json_build_object(
      'home_team', COALESCE(OLD.home_team, ''), 'away_team', COALESCE(OLD.away_team, ''),
      'date', COALESCE(to_char(OLD.date, 'DD.MM.YY'), '')
    )::text;
  END IF;

  -- Skip notifications for past games (allow result_available up to 3 days after)
  IF v_type = 'result_available' THEN
    IF NEW.date < CURRENT_DATE - INTERVAL '3 days' THEN RETURN NEW; END IF;
  ELSE
    IF TG_OP = 'DELETE' THEN
      IF OLD.date < CURRENT_DATE THEN RETURN OLD; END IF;
    ELSE
      IF NEW.date < CURRENT_DATE THEN RETURN NEW; END IF;
    END IF;
  END IF;

  INSERT INTO notifications (member, type, title, body, activity_type, activity_id, team, read)
  SELECT mt.member, v_type, v_title, v_body, 'game', v_game_id::text, v_team_id, false
  FROM member_teams mt WHERE mt.team = v_team_id;

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;


--
-- Name: trg_halls_reject_vm_combo(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trg_halls_reject_vm_combo() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE combo_label text;
BEGIN
  SELECT c.label INTO combo_label
    FROM (VALUES
      ('914',  '122655f3-806e-4415-8305-5f7f9d19dab0', 'VM gym 914 — Kantonsschule Wiedikon A-C (3 courts)'),
      ('4144', '5261363c-da18-40e4-ab87-9d6bbdb6240b', 'VM gym 4144 — Kantonsschule Wiedikon A+B (2 courts)')
    ) AS c(sv, vm, label)
   WHERE COALESCE(NEW.sv_hall_id, '') = c.sv
      OR COALESCE(NEW.vm_hall_id, '') = c.vm
   LIMIT 1;

  IF combo_label IS NOT NULL THEN
    RAISE EXCEPTION
      'Hall "%" may not map to a multi-court VM combo gym (%). A hall row is one physical court — every single-court game pushed through it would book the whole combo. Map it to a single-court gym instead (3231 = KWI A, 3232 = KWI B, 3989 = KWI C). A combo is a property of a game, not of a hall: to play across A+B, set the game''s hall to KWI A and add KWI B via games.additional_halls (see allGameHallIds).',
      NEW.name, combo_label;
  END IF;

  RETURN NEW;
END;
$$;


--
-- Name: trg_members_coach_approval_guard(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trg_members_coach_approval_guard() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NEW.coach_approved_team = true AND (OLD.coach_approved_team IS DISTINCT FROM true) THEN
    IF NOT EXISTS (SELECT 1 FROM member_teams WHERE member = NEW.id) THEN
      RAISE EXCEPTION 'Cannot approve team coaching without member_teams record';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: trg_members_shell_convert(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trg_members_shell_convert() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  IF OLD.shell = true AND NEW.shell = true
     AND NEW.wiedisync_active = true AND OLD.wiedisync_active = false THEN
    NEW.shell := false;
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: trg_participations_clear_auto_marker(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trg_participations_clear_auto_marker() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NEW.auto_declined_by IS NOT DISTINCT FROM OLD.auto_declined_by THEN
    NEW.auto_declined_by := NULL;
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NEW.auto_declined_by_game IS NOT DISTINCT FROM OLD.auto_declined_by_game THEN
    NEW.auto_declined_by_game := NULL;
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: trg_participations_guest_block(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trg_participations_guest_block() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $_$
DECLARE
  v_team integer;
BEGIN
  -- Block guests from confirming game participation (on insert or status
  -- change to confirmed), scoped to the team that owns the game.
  IF NEW.activity_type = 'game' AND NEW.status = 'confirmed' AND NEW.member IS NOT NULL THEN
    IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status) THEN
      -- Resolve the game's team. If the game row is missing (FK orphan)
      -- we fall back to allowing the write — the FK constraint will catch
      -- the real problem, not this trigger.
      --
      -- Guard the implicit varchar->int cast: only look up games when
      -- activity_id is a pure numeric string. A non-numeric activity_id would
      -- otherwise make the cast error or the lookup find nothing, silently
      -- skipping the guest block. A non-numeric game activity_id is itself
      -- invalid, so leaving v_team NULL (no block) is the safe fallback —
      -- the FK / app layer owns that error, not this guard.
      IF NEW.activity_id ~ '^[0-9]+$' THEN
        SELECT kscw_team INTO v_team FROM games WHERE id = NEW.activity_id::integer;
      END IF;
      IF v_team IS NOT NULL THEN
        IF EXISTS (
          SELECT 1 FROM member_teams
          WHERE member = NEW.member
            AND team = v_team
            AND guest_level > 0
          LIMIT 1
        ) THEN
          RAISE EXCEPTION 'Guests cannot directly confirm game participation';
        END IF;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$_$;


--
-- Name: trg_protect_hall_delete(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trg_protect_hall_delete() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM hall_slots hs
    JOIN hall_slots_teams hst ON hst.hall_slots_id = hs.id
    WHERE hs.hall = OLD.id
  ) THEN
    RAISE EXCEPTION 'Cannot delete hall with existing hall_slots. Remove slots first.';
  END IF;
  RETURN OLD;
END;
$$;


--
-- Name: trg_protect_team_delete(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trg_protect_team_delete() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM member_teams WHERE team = OLD.id
  ) THEN
    RAISE EXCEPTION 'Cannot delete team with active member_teams records. Remove members first.';
  END IF;
  RETURN OLD;
END;
$$;


--
-- Name: trg_scorer_delegation_freeze_identity(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trg_scorer_delegation_freeze_identity() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NEW.from_member IS DISTINCT FROM OLD.from_member
     OR NEW.to_member IS DISTINCT FROM OLD.to_member
     OR NEW.game        IS DISTINCT FROM OLD.game
     OR NEW.role        IS DISTINCT FROM OLD.role
     OR NEW.from_team   IS DISTINCT FROM OLD.from_team
     OR NEW.to_team     IS DISTINCT FROM OLD.to_team THEN
    RAISE EXCEPTION 'scorer_delegations: from_member/to_member/game/role/team are immutable after creation (issue a new delegation instead)'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: trg_scorer_delegation_validate(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trg_scorer_delegation_validate() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  -- Keep the same_team flag (UI grouping only).
  NEW.same_team := (NEW.from_team = NEW.to_team);
  -- Every delegation starts pending; only the recipient's accept may flip it.
  IF TG_OP = 'INSERT' THEN
    NEW.status := 'pending';
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: trg_slot_claims_validate(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trg_slot_claims_validate() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NEW.date IS NULL THEN
    RAISE EXCEPTION 'A slot claim requires a date';
  END IF;
  IF NEW.date < CURRENT_DATE THEN
    RAISE EXCEPTION 'Cannot claim slots in the past';
  END IF;
  IF NEW.status = 'active' AND EXISTS (
    SELECT 1 FROM slot_claims
    WHERE hall_slot = NEW.hall_slot AND date = NEW.date AND status = 'active'
      AND id IS DISTINCT FROM NEW.id
  ) THEN
    RAISE EXCEPTION 'This slot is already claimed for this date';
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: trg_teams_release_derby_host(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trg_teams_release_derby_host() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  -- The team being deleted hosts a leg of one or more derbies — un-confirm them
  -- and clear the host pointer (matching the FK's ON DELETE SET NULL). A derby
  -- that loses a team is no longer a valid Art. 27 anchor.
  UPDATE game_scheduling_derbies
  SET confirmed = false,
      leg1_home_team = CASE WHEN leg1_home_team = OLD.id THEN NULL ELSE leg1_home_team END,
      leg2_home_team = CASE WHEN leg2_home_team = OLD.id THEN NULL ELSE leg2_home_team END,
      date_updated = now()
  WHERE leg1_home_team = OLD.id OR leg2_home_team = OLD.id;

  RETURN OLD;
END;
$$;


--
-- Name: trg_trainings_clear_auto_cancel_marker(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trg_trainings_clear_auto_cancel_marker() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NEW.cancelled IS DISTINCT FROM OLD.cancelled THEN
    IF NEW.auto_cancelled_by_closure IS NOT DISTINCT FROM OLD.auto_cancelled_by_closure THEN
      NEW.auto_cancelled_by_closure := NULL;
    END IF;
    IF NEW.auto_cancelled_by_trial IS NOT DISTINCT FROM OLD.auto_cancelled_by_trial THEN
      NEW.auto_cancelled_by_trial := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: trg_trainings_notify(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trg_trainings_notify() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
DECLARE
  v_type text; v_title text; v_body text; v_team_id int; v_id int;
  v_hall text;
BEGIN
  -- Silencer for bulk auto-generation (slot-cascade hook). Second arg
  -- `true` means "return empty string if not set" instead of raising.
  IF current_setting('kscw.skip_trainings_notify', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_team_id := NEW.team; v_id := NEW.id;
    IF v_team_id IS NULL THEN RETURN NEW; END IF;
    SELECT COALESCE(h.name, '') INTO v_hall FROM halls h WHERE h.id = NEW.hall;
    v_hall := COALESCE(v_hall, '');
    v_type := 'activity_change';
    v_title := 'training_created';
    v_body := json_build_object(
      'date', COALESCE(to_char(NEW.date, 'DD.MM.YY'), ''),
      'time', COALESCE(to_char(NEW.start_time, 'HH24:MI'), ''),
      'hall', v_hall
    )::text;
  ELSIF TG_OP = 'UPDATE' THEN
    v_team_id := NEW.team; v_id := NEW.id;
    IF v_team_id IS NULL THEN RETURN NEW; END IF;
    SELECT COALESCE(h.name, '') INTO v_hall FROM halls h WHERE h.id = NEW.hall;
    v_hall := COALESCE(v_hall, '');
    IF NEW.cancelled = true AND OLD.cancelled IS DISTINCT FROM true THEN
      v_type := 'activity_change'; v_title := 'training_cancelled';
    ELSE
      v_type := 'activity_change'; v_title := 'training_updated';
    END IF;
    v_body := json_build_object(
      'date', COALESCE(to_char(NEW.date, 'DD.MM.YY'), ''),
      'hall', v_hall
    )::text;
  ELSIF TG_OP = 'DELETE' THEN
    v_team_id := OLD.team; v_id := OLD.id;
    IF v_team_id IS NULL THEN RETURN OLD; END IF;
    v_type := 'activity_change'; v_title := 'training_deleted';
    v_body := json_build_object(
      'date', COALESCE(to_char(OLD.date, 'DD.MM.YY'), '')
    )::text;
  END IF;

  -- Skip notifications for past trainings
  IF TG_OP = 'DELETE' THEN
    IF OLD.date < CURRENT_DATE THEN RETURN OLD; END IF;
  ELSE
    IF NEW.date < CURRENT_DATE THEN RETURN NEW; END IF;
  END IF;

  INSERT INTO notifications (member, type, title, body, activity_type, activity_id, team, read)
  SELECT mt.member, v_type, v_title, v_body, 'training', v_id::text, v_team_id, false
  FROM member_teams mt WHERE mt.team = v_team_id;

  RETURN COALESCE(NEW, OLD);
END;
$$;


--
-- Name: trg_trainings_revoke_claims(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trg_trainings_revoke_claims() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  IF OLD.cancelled = true AND NEW.cancelled = false AND NEW.hall_slot IS NOT NULL THEN
    UPDATE slot_claims SET status = 'revoked'
    WHERE hall_slot = NEW.hall_slot AND date = NEW.date
      AND freed_reason = 'cancelled_training' AND status = 'active';
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: trg_trainings_trial_transform(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trg_trainings_trial_transform() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
DECLARE
  v_existing_id integer;
BEGIN
  IF NEW.cancelled = true OR NEW.team IS NULL OR NEW.date IS NULL THEN
    RETURN NULL;
  END IF;

  IF NEW.is_trial = true THEN
    -- Look for ANY existing active same-date sibling (regular OR trial).
    -- Migration 056 restricted this with `AND is_trial = false`; that
    -- restriction is removed here so trial-onto-trial also collapses.
    -- ORDER BY id makes the target deterministic if >1 exists pre-backfill.
    SELECT id INTO v_existing_id
    FROM trainings
    WHERE team = NEW.team
      AND date = NEW.date
      AND id <> NEW.id
      AND cancelled = false
    ORDER BY id
    LIMIT 1;

    IF v_existing_id IS NOT NULL THEN
      INSERT INTO participations (member, activity_type, activity_id, status, note, guest_count, is_staff, auto_declined_by)
      SELECT src.member, 'training', v_existing_id::text, src.status, src.note, src.guest_count, src.is_staff, src.auto_declined_by
      FROM participations src
      WHERE src.activity_type = 'training' AND src.activity_id = NEW.id::text
        AND NOT EXISTS (
          SELECT 1 FROM participations dst
          WHERE dst.activity_type = 'training' AND dst.activity_id = v_existing_id::text
            AND dst.member = src.member
        );

      DELETE FROM participations
      WHERE activity_type = 'training' AND activity_id = NEW.id::text;

      UPDATE trainings
      SET is_trial = true,
          notes = CASE WHEN NEW.notes IS NOT NULL AND NEW.notes <> ''
                       THEN NEW.notes ELSE notes END,
          min_participants = COALESCE(NEW.min_participants, min_participants),
          max_participants = COALESCE(NEW.max_participants, max_participants),
          excluded_guest_levels = COALESCE(NEW.excluded_guest_levels, excluded_guest_levels),
          require_note_if_absent = NEW.require_note_if_absent,
          recruiting_positions = COALESCE(NEW.recruiting_positions, recruiting_positions)
      WHERE id = v_existing_id;

      DELETE FROM trainings WHERE id = NEW.id;
    END IF;

  ELSE
    -- New is a regular. If a trial already covers this date, discard the
    -- new regular so the trial stays the only row. (Unchanged from 056.)
    IF EXISTS (
      SELECT 1 FROM trainings
      WHERE team = NEW.team
        AND date = NEW.date
        AND id <> NEW.id
        AND is_trial = true
        AND cancelled = false
    ) THEN
      DELETE FROM participations
      WHERE activity_type = 'training' AND activity_id = NEW.id::text;
      DELETE FROM trainings WHERE id = NEW.id;
    END IF;
  END IF;

  RETURN NULL;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: absences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.absences (
    id integer NOT NULL,
    start_date date,
    end_date date,
    reason character varying(255) DEFAULT NULL::character varying,
    reason_detail text,
    affects json,
    type character varying(255) DEFAULT NULL::character varying,
    days_of_week json,
    indefinite boolean DEFAULT false NOT NULL,
    member integer,
    date_created timestamp with time zone,
    date_updated timestamp with time zone,
    last_edited_by uuid,
    last_edited_at timestamp with time zone,
    last_edited_name text,
    last_edited_role text,
    blocking boolean DEFAULT true NOT NULL
);


--
-- Name: COLUMN absences.last_edited_by; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.absences.last_edited_by IS 'directus_users.id of the writer on the most recent create/update — set by kscw-hooks filter, null for system-context writes.';


--
-- Name: COLUMN absences.last_edited_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.absences.last_edited_at IS 'Wall-clock of the most recent authenticated write. Null when never touched by an authenticated session.';


--
-- Name: COLUMN absences.last_edited_name; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.absences.last_edited_name IS 'Display name of the writer on the most recent create/update — first_name + last_name from directus_users. Stamped by kscw-hooks filter, null for system-context writes and pre-053 rows.';


--
-- Name: COLUMN absences.last_edited_role; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.absences.last_edited_role IS 'Role of the writer relative to the affected member: ''coach'', ''team_responsible'', ''admin'', or ''staff''. Resolved by checking teams_coaches / teams_responsibles for any overlap with the affected member''s teams. Stamped by kscw-hooks filter.';


--
-- Name: COLUMN absences.blocking; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.absences.blocking IS 'When true (default), this absence blocks game-scheduling availability (home slots offered + opponent away proposals) on its dates. Set false for absences that should not block scheduling (e.g. long-term injury, maternity leave) since the player won''t play regardless. Only standard absences affecting games/all are evaluated; weekly unavailabilities never block scheduling.';


--
-- Name: absences_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.absences_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: absences_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.absences_id_seq OWNED BY public.absences.id;


--
-- Name: announcement_recipients; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.announcement_recipients (
    id integer NOT NULL,
    announcement integer NOT NULL,
    member integer NOT NULL,
    bell_at timestamp with time zone,
    email_at timestamp with time zone,
    email_error text,
    date_created timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE announcement_recipients; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.announcement_recipients IS 'One row per (announcement, member) resolved at publish by the kscw-hooks fanout (migration 219). Read gate for teams/roles-targeted posts (members cannot read audience_teams/audience_roles, so the Member policy filter walks this junction instead), per-recipient delivery log, and a frozen as-of-publish audience snapshot. Written for every audience_type; load-bearing only for teams/roles.';


--
-- Name: COLUMN announcement_recipients.bell_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.announcement_recipients.bell_at IS 'In-app bell notification created. Always attempted — opt-outs suppress email/push only, never the bell.';


--
-- Name: COLUMN announcement_recipients.email_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.announcement_recipients.email_at IS 'Email accepted by SES. NULL when notify_email was off, the member has no address, or email_notify_announcements is false.';


--
-- Name: COLUMN announcement_recipients.email_error; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.announcement_recipients.email_error IS 'SES/transport error for this recipient, if the send threw. NULL on success or when no email was attempted.';


--
-- Name: announcement_recipients_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.announcement_recipients_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: announcement_recipients_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.announcement_recipients_id_seq OWNED BY public.announcement_recipients.id;


--
-- Name: announcements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.announcements (
    id integer NOT NULL,
    image uuid,
    link character varying(255),
    pinned boolean DEFAULT false NOT NULL,
    published_at timestamp with time zone,
    expires_at timestamp with time zone,
    audience_type character varying(255) DEFAULT 'all'::character varying,
    audience_sport character varying(255) DEFAULT NULL::character varying,
    audience_teams json,
    audience_roles json,
    notify_push boolean DEFAULT false NOT NULL,
    notify_email boolean DEFAULT false NOT NULL,
    translations json DEFAULT '{}'::json,
    created_by integer,
    fanout_sent_at timestamp with time zone,
    date_created timestamp with time zone,
    date_updated timestamp with time zone,
    email_layout character varying(20) DEFAULT 'standard'::character varying NOT NULL,
    reply_to character varying(255),
    CONSTRAINT announcements_email_layout_check CHECK (((email_layout)::text = ANY ((ARRAY['standard'::character varying, 'newsletter'::character varying])::text[])))
);


--
-- Name: COLUMN announcements.email_layout; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.announcements.email_layout IS 'Email template for the fanout: standard branded card or newsletter masthead layout (migration 204).';


--
-- Name: COLUMN announcements.reply_to; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.announcements.reply_to IS 'Optional Reply-To for announcement emails; NULL/empty = no-reply (migration 204).';


--
-- Name: announcements_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.announcements_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: announcements_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.announcements_id_seq OWNED BY public.announcements.id;


--
-- Name: app_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_settings (
    id integer NOT NULL,
    key character varying(255) DEFAULT NULL::character varying NOT NULL,
    enabled boolean DEFAULT false NOT NULL,
    date_created timestamp with time zone,
    date_updated timestamp with time zone
);


--
-- Name: app_settings_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.app_settings_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: app_settings_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.app_settings_id_seq OWNED BY public.app_settings.id;


--
-- Name: basketball_hall_availability; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.basketball_hall_availability (
    id integer NOT NULL,
    season integer NOT NULL,
    team integer NOT NULL,
    date date NOT NULL,
    unavailable boolean DEFAULT false NOT NULL,
    windows jsonb DEFAULT '[]'::jsonb NOT NULL,
    note text,
    created_by integer,
    date_created timestamp with time zone DEFAULT now() NOT NULL,
    date_updated timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE basketball_hall_availability; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.basketball_hall_availability IS 'Per basketball team, per candidate home date (Fri/Sat/Sun) KWI hall availability for ProBasket scheduling. unavailable = the ProBasket template "Nicht verfügbar" x; windows = jsonb array of {hall,from,to} (up to 3). One row per (season, team, date). Edited via the Basketball prep view (Directus items API → auto actor log); feeds the future 17-Aug ProBasket Excel export. Basketball has no opponent/token/booking flow — the association owns the schedule.';


--
-- Name: basketball_hall_availability_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.basketball_hall_availability_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: basketball_hall_availability_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.basketball_hall_availability_id_seq OWNED BY public.basketball_hall_availability.id;


--
-- Name: basketball_slot_plan; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.basketball_slot_plan (
    id integer NOT NULL,
    season integer NOT NULL,
    date date NOT NULL,
    "time" character varying(5) NOT NULL,
    hall character varying(16) NOT NULL,
    kscw_team integer,
    kscw_team_label text,
    opponent text,
    sex character varying(8),
    game_type character varying(8) DEFAULT 'home'::character varying NOT NULL,
    note text,
    created_by integer,
    date_created timestamp with time zone DEFAULT now() NOT NULL,
    date_updated timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE basketball_slot_plan; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.basketball_slot_plan IS 'A basketball game placed into a fixed KWI hall slot for the ProBasket Spielplansitzung. One row per (season, date, time, hall). kscw_team (or kscw_team_label free-text) vs opponent (from the ProBasket Gruppeneinteilung, or free-text). Free slots + blackout/closure defaults are computed at display time, not stored. Edited via the Basketball prep view (Directus items API → auto actor log).';


--
-- Name: basketball_slot_plan_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.basketball_slot_plan_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: basketball_slot_plan_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.basketball_slot_plan_id_seq OWNED BY public.basketball_slot_plan.id;


--
-- Name: basketplan_nations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.basketplan_nations (
    bp_id integer NOT NULL,
    iso character varying(2),
    label_fr text NOT NULL,
    ambiguous boolean DEFAULT false NOT NULL
);


--
-- Name: TABLE basketplan_nations; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.basketplan_nations IS 'Basketplan nationality picklist: internal numeric id -> ISO 3166-1 alpha-2. Labels are FRENCH and hardcoded regardless of UI locale. ambiguous = legacy abbreviation or an unsupported territory; those must never be auto-applied.';


--
-- Name: basketplan_people; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.basketplan_people (
    person_id integer NOT NULL,
    last_name text,
    first_name text,
    birthdate date,
    licence_nr text,
    nation1_id integer,
    nation2_id integer,
    nation_confirmed boolean,
    trained_in_ch boolean,
    otr1_since date,
    otr2_since date,
    otn1_since date,
    otn2_since date,
    referee_reg_since date,
    referee_nat_since date,
    referee_mini_since date,
    referee_youth_since date,
    last_scored_at date,
    scraped_at timestamp with time zone DEFAULT now() NOT NULL,
    licence_category text
);


--
-- Name: TABLE basketplan_people; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.basketplan_people IS 'Staging for the authenticated Basketplan person scrape (findPersonById.do). Holds only the fields we intend to consume — no address / AHV / IBAN, and birthdate is a cross-check aid only, never an overwrite source.';


--
-- Name: COLUMN basketplan_people.licence_category; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.basketplan_people.licence_category IS 'Licence category from the club licence list (Senior / U 6..U 20 / Offizielle/r). Harvested from showPrintLicences.do — the person page does not carry it. Applied to members.licence_category fill-or-BB-refresh only; Volleymanager codes (RLL/JLL/…) are never overwritten.';


--
-- Name: blocks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.blocks (
    id uuid NOT NULL,
    blocker integer NOT NULL,
    blocked integer NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT chk_blocks_not_self CHECK ((blocker <> blocked))
);


--
-- Name: broadcasts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.broadcasts (
    id integer NOT NULL,
    activity_type character varying(16) NOT NULL,
    activity_id integer NOT NULL,
    sender integer,
    channels_sent jsonb NOT NULL,
    audience_filter jsonb NOT NULL,
    recipient_count integer NOT NULL,
    recipient_ids jsonb NOT NULL,
    subject character varying(255),
    message text NOT NULL,
    delivery_results jsonb,
    sent_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT broadcasts_activity_type_check CHECK (((activity_type)::text = ANY (ARRAY[('event'::character varying)::text, ('game'::character varying)::text, ('training'::character varying)::text])))
);


--
-- Name: broadcasts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.broadcasts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: broadcasts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.broadcasts_id_seq OWNED BY public.broadcasts.id;


--
-- Name: bugfix_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bugfix_jobs (
    id integer NOT NULL,
    error_hash text NOT NULL,
    error_date text NOT NULL,
    status text DEFAULT 'fixing'::text NOT NULL,
    pr_number integer,
    pr_url text,
    pr_branch text,
    merge_sha text,
    fix_summary text,
    public_summary text,
    is_public boolean DEFAULT true NOT NULL,
    triggered_by uuid,
    date_created timestamp with time zone DEFAULT now() NOT NULL,
    date_updated timestamp with time zone DEFAULT now() NOT NULL,
    repo text DEFAULT 'wiedisync'::text NOT NULL,
    CONSTRAINT bugfix_jobs_status_check CHECK ((status = ANY (ARRAY['fixing'::text, 'pr_ready'::text, 'deployed_dev'::text, 'deployed_prod'::text, 'failed'::text, 'reverted'::text, 'dismissed'::text])))
);


--
-- Name: bugfix_jobs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.bugfix_jobs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: bugfix_jobs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.bugfix_jobs_id_seq OWNED BY public.bugfix_jobs.id;


--
-- Name: city_hall_availability; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.city_hall_availability (
    einrichtung_id integer NOT NULL,
    weekday smallint NOT NULL,
    season_start date NOT NULL,
    season_end date NOT NULL,
    scrape_window_from text NOT NULL,
    scrape_window_to text NOT NULL,
    scrape_min_minutes integer NOT NULL,
    dates jsonb DEFAULT '[]'::jsonb NOT NULL,
    scraped_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT city_hall_availability_weekday_check CHECK (((weekday >= 1) AND (weekday <= 7)))
);


--
-- Name: TABLE city_hall_availability; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.city_hall_availability IS 'Per (hall, weekday) cached free/holiday outcome per week for one season. Private — read via /kscw/hallenfinder/search only.';


--
-- Name: city_halls; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.city_halls (
    einrichtung_id integer NOT NULL,
    name text NOT NULL,
    hall_type text,
    address text,
    plz text,
    stadtkreis text,
    stadtquartier text,
    schulkreis text,
    first_seen timestamp with time zone DEFAULT now() NOT NULL,
    last_seen timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE city_halls; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.city_halls IS 'Roster of City of Zürich sport halls seen in the Hallenfinder scrape. Private — read via /kscw/hallenfinder/search only.';


--
-- Name: clubdesk_export; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.clubdesk_export (
    row_id bigint NOT NULL,
    imported_at timestamp with time zone DEFAULT now() NOT NULL,
    source_file text,
    gruppe text,
    funktion text,
    nachname text,
    vorname text,
    firma text,
    rolle text,
    rolle_2 text,
    anrede text,
    titel text,
    briefanrede text,
    benutzer_id text,
    adresse text,
    adress_zusatz text,
    plz text,
    ort text,
    land text,
    nationalitaet text,
    telefon_privat text,
    telefon_geschaeft text,
    telefon_mobil text,
    fax text,
    email text,
    email_alternativ text,
    gruppen text,
    status text,
    eintritt text,
    mitgliedsjahre text,
    austritt text,
    zivilstand text,
    geschlecht text,
    geburtsdatum text,
    alter_ text,
    jahrgang text,
    bemerkungen text,
    firmen_webseite text,
    rechnungsversand text,
    nie_mahnen text,
    iban text,
    bic text,
    kontoinhaber text,
    lizenznummer text,
    lizenzart text,
    lizenz_bestellt text,
    sektion text,
    beitragskategorie text,
    betrag_bezahlt text,
    clubnummer text,
    mittelschule_zh text,
    offiziellen_lizenz text,
    mitgliederbeitrag text,
    ahv_nummer text,
    passivmitglied text,
    offiziellen_100er text,
    gruppe_2 text,
    funktion_2 text,
    gruppen_2 text,
    jg text,
    clubdesk_id text,
    zuletzt_geaendert_am text,
    zuletzt_geaendert_von text,
    gruppen_bracketed text,
    rolle_bracketed text,
    wiedisync_id text,
    js_id text,
    federation_of_origin text,
    gast text
);


--
-- Name: COLUMN clubdesk_export.gast; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.clubdesk_export.gast IS 'ClubDesk "Gast" checkbox (Ja/Nein) as exported. Written ONLY by wiedisync''s sync-up push; staged here so computeClubdeskDrift can compare it against the current-season roster. Never flows back into members — member_teams.guest_level is the source of truth.';


--
-- Name: clubdesk_people; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.clubdesk_people AS
 SELECT DISTINCT ON (COALESCE(NULLIF(clubdesk_id, ''::text), lower(NULLIF(email, ''::text)))) clubdesk_id,
    nachname,
    vorname,
    email,
    email_alternativ,
    status,
    geschlecht,
    geburtsdatum,
    jahrgang,
    alter_,
    lizenznummer,
    lizenzart,
    sektion,
    beitragskategorie,
    offiziellen_lizenz,
    passivmitglied,
    telefon_mobil,
    gruppen,
    imported_at
   FROM public.clubdesk_export
  ORDER BY COALESCE(NULLIF(clubdesk_id, ''::text), lower(NULLIF(email, ''::text))), row_id;


--
-- Name: clubdesk_basketball; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.clubdesk_basketball AS
 SELECT clubdesk_id,
    nachname,
    vorname,
    email,
    email_alternativ,
    status,
    geschlecht,
    geburtsdatum,
    jahrgang,
    alter_,
    lizenznummer,
    lizenzart,
    sektion,
    beitragskategorie,
    offiziellen_lizenz,
    passivmitglied,
    telefon_mobil,
    gruppen,
    imported_at
   FROM public.clubdesk_people
  WHERE (sektion = 'Basketball'::text);


--
-- Name: clubdesk_export_meta; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.clubdesk_export_meta (
    id integer DEFAULT 1 NOT NULL,
    last_import_at timestamp with time zone,
    source_file text,
    row_count integer,
    CONSTRAINT clubdesk_export_meta_id_check CHECK ((id = 1))
);


--
-- Name: clubdesk_export_row_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.clubdesk_export_row_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: clubdesk_export_row_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.clubdesk_export_row_id_seq OWNED BY public.clubdesk_export.row_id;


--
-- Name: clubdesk_member_sync; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.clubdesk_member_sync (
    id smallint DEFAULT 1 NOT NULL,
    down_requested_at timestamp with time zone,
    down_state character varying(16) DEFAULT 'idle'::character varying NOT NULL,
    down_message text,
    down_finished_at timestamp with time zone,
    up_requested_at timestamp with time zone,
    up_state character varying(16) DEFAULT 'idle'::character varying NOT NULL,
    up_message text,
    up_finished_at timestamp with time zone,
    up_csv text,
    up_member_ids jsonb,
    up_result jsonb,
    up_csv_create text,
    up_member_ids_create jsonb,
    CONSTRAINT clubdesk_member_sync_singleton CHECK ((id = 1))
);


--
-- Name: clubdesk_volleyball; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.clubdesk_volleyball AS
 SELECT clubdesk_id,
    nachname,
    vorname,
    email,
    email_alternativ,
    status,
    geschlecht,
    geburtsdatum,
    jahrgang,
    alter_,
    lizenznummer,
    lizenzart,
    sektion,
    beitragskategorie,
    offiziellen_lizenz,
    passivmitglied,
    telefon_mobil,
    gruppen,
    imported_at
   FROM public.clubdesk_people
  WHERE (sektion = 'Volleyball'::text);


--
-- Name: conversation_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.conversation_members (
    id uuid NOT NULL,
    conversation uuid NOT NULL,
    member integer NOT NULL,
    role character varying(255) DEFAULT 'member'::character varying NOT NULL,
    joined_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    last_read_at timestamp with time zone,
    muted boolean DEFAULT false NOT NULL,
    archived boolean DEFAULT false NOT NULL
);


--
-- Name: conversations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.conversations (
    id uuid NOT NULL,
    type character varying(255) DEFAULT NULL::character varying NOT NULL,
    title character varying(120) DEFAULT NULL::character varying,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    last_message_at timestamp with time zone,
    last_message_preview character varying(120) DEFAULT NULL::character varying,
    team integer,
    created_by integer,
    activity_type character varying(16),
    activity_id integer,
    CONSTRAINT conversations_activity_type_check CHECK (((activity_type IS NULL) OR ((activity_type)::text = 'event'::text))),
    CONSTRAINT conversations_shape_check CHECK (((((type)::text = 'team'::text) AND (team IS NOT NULL) AND (activity_type IS NULL) AND (activity_id IS NULL)) OR (((type)::text = ANY (ARRAY[('dm'::character varying)::text, ('dm_request'::character varying)::text, ('group_dm'::character varying)::text])) AND (team IS NULL) AND (activity_type IS NULL) AND (activity_id IS NULL)) OR (((type)::text = 'activity_chat'::text) AND (team IS NULL) AND (activity_type IS NOT NULL) AND (activity_id IS NOT NULL))))
);


--
-- Name: country_codes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.country_codes (
    code character varying(2) NOT NULL,
    name_de text NOT NULL,
    name_en text NOT NULL,
    name_de_clubdesk text NOT NULL
);


--
-- Name: COLUMN country_codes.name_de_clubdesk; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.country_codes.name_de_clubdesk IS 'Exact value ClubDesk''s Nationalität / Federation of Origin picklists expect. Defaults to name_de; overridden only where ClubDesk''s spelling differs (verified against clubdesk_export).';


--
-- Name: country_name_aliases; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.country_name_aliases (
    alias text NOT NULL,
    code character varying(2) NOT NULL
);


--
-- Name: TABLE country_name_aliases; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.country_name_aliases IS 'Lowercased country-name spellings → ISO alpha-2. Parse direction only; never use for display or for the ClubDesk push (that is country_codes.name_de_clubdesk).';


--
-- Name: email_verifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_verifications (
    id integer NOT NULL,
    email character varying(255) DEFAULT NULL::character varying,
    token character varying(255) DEFAULT NULL::character varying,
    expires_at timestamp with time zone,
    used_at timestamp with time zone,
    date_created timestamp with time zone,
    date_updated timestamp with time zone,
    code character varying(8),
    verified boolean DEFAULT false
);


--
-- Name: email_verifications_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.email_verifications_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: email_verifications_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.email_verifications_id_seq OWNED BY public.email_verifications.id;


--
-- Name: error_annotations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.error_annotations (
    id integer NOT NULL,
    error_hash character varying(32) NOT NULL,
    error_date date NOT NULL,
    status character varying(20) DEFAULT 'open'::character varying NOT NULL,
    note text,
    resolved_commit character varying(100),
    date_created timestamp with time zone DEFAULT now() NOT NULL,
    date_updated timestamp with time zone DEFAULT now() NOT NULL,
    user_created uuid,
    CONSTRAINT error_annotations_status_check CHECK (((status)::text = ANY (ARRAY[('open'::character varying)::text, ('solved'::character varying)::text, ('important'::character varying)::text])))
);


--
-- Name: error_annotations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.error_annotations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: error_annotations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.error_annotations_id_seq OWNED BY public.error_annotations.id;


--
-- Name: error_mute_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.error_mute_rules (
    id integer NOT NULL,
    event character varying(64),
    error_match text NOT NULL,
    note text,
    enabled boolean DEFAULT true NOT NULL,
    date_created timestamp with time zone DEFAULT now() NOT NULL,
    user_created uuid
);


--
-- Name: error_mute_rules_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.error_mute_rules_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: error_mute_rules_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.error_mute_rules_id_seq OWNED BY public.error_mute_rules.id;


--
-- Name: event_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.event_sessions (
    id integer NOT NULL,
    date date,
    start_time time without time zone,
    end_time time without time zone,
    label character varying(255) DEFAULT NULL::character varying,
    sort_order integer,
    event integer,
    date_created timestamp with time zone,
    date_updated timestamp with time zone
);


--
-- Name: event_sessions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.event_sessions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: event_sessions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.event_sessions_id_seq OWNED BY public.event_sessions.id;


--
-- Name: event_signups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.event_signups (
    id integer NOT NULL,
    event integer,
    form_slug character varying(64) NOT NULL,
    name character varying(255) NOT NULL,
    email character varying(255) NOT NULL,
    sex character varying(16),
    language character varying(16),
    is_member boolean DEFAULT false NOT NULL,
    member integer,
    form_data jsonb,
    consent jsonb,
    date_created timestamp with time zone DEFAULT now() NOT NULL,
    date_updated timestamp with time zone
);


--
-- Name: event_signups_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.event_signups_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: event_signups_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.event_signups_id_seq OWNED BY public.event_signups.id;


--
-- Name: events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.events (
    id integer NOT NULL,
    title character varying(255) DEFAULT NULL::character varying NOT NULL,
    description text,
    event_type character varying(255) DEFAULT NULL::character varying,
    start_date timestamp with time zone,
    end_date timestamp with time zone,
    all_day boolean DEFAULT false NOT NULL,
    location character varying(255) DEFAULT NULL::character varying,
    respond_by timestamp with time zone,
    max_players integer,
    min_participants integer,
    participation_mode character varying(255) DEFAULT NULL::character varying,
    require_note_if_absent boolean DEFAULT false NOT NULL,
    features_enabled json,
    hall integer,
    created_by integer,
    date_created timestamp with time zone,
    date_updated timestamp with time zone,
    invited_roles json,
    send_email_invite boolean DEFAULT false,
    allow_maybe boolean DEFAULT true,
    signup_url character varying(500),
    cancelled boolean DEFAULT false NOT NULL,
    cancel_reason text,
    js_relevant boolean DEFAULT false NOT NULL,
    js_activity_type character varying(32)
);


--
-- Name: COLUMN events.js_relevant; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.events.js_relevant IS 'Coach opt-in: include this event in the J+S activity/attendance export.';


--
-- Name: COLUMN events.js_activity_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.events.js_activity_type IS 'NDS J+S activity type when js_relevant: Training | Wettkampf | Trainingstag | Lagertag.';


--
-- Name: events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.events_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.events_id_seq OWNED BY public.events.id;


--
-- Name: events_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.events_members (
    id integer NOT NULL,
    events_id integer NOT NULL,
    members_id integer NOT NULL
);


--
-- Name: events_members_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.events_members_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: events_members_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.events_members_id_seq OWNED BY public.events_members.id;


--
-- Name: events_teams; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.events_teams (
    id integer NOT NULL,
    events_id integer NOT NULL,
    teams_id integer NOT NULL
);


--
-- Name: events_teams_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.events_teams_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: events_teams_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.events_teams_id_seq OWNED BY public.events_teams.id;


--
-- Name: feedback; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.feedback (
    id integer NOT NULL,
    type character varying(255) DEFAULT 'feedback'::character varying,
    title character varying(255),
    description text,
    source character varying(255) DEFAULT 'wiedisync'::character varying,
    source_url character varying(255),
    status character varying(255) DEFAULT 'new'::character varying,
    github_issue character varying(255),
    name character varying(255),
    email character varying(255),
    screenshot uuid,
    date_created timestamp with time zone,
    date_updated timestamp with time zone,
    "user" integer,
    screenshots jsonb
);


--
-- Name: feedback_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.feedback_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: feedback_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.feedback_id_seq OWNED BY public.feedback.id;


--
-- Name: finance_accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.finance_accounts (
    id integer NOT NULL,
    number character varying(16) NOT NULL,
    name character varying(128) NOT NULL,
    type character varying(16),
    division character varying(8),
    active boolean DEFAULT true NOT NULL,
    source character varying(16) DEFAULT 'clubdesk'::character varying NOT NULL,
    date_created timestamp with time zone DEFAULT now() NOT NULL,
    date_updated timestamp with time zone DEFAULT now() NOT NULL,
    user_created uuid,
    user_updated uuid,
    CONSTRAINT finance_accounts_division_check CHECK (((division IS NULL) OR ((division)::text = ANY (ARRAY[('club'::character varying)::text, ('vb'::character varying)::text, ('bb'::character varying)::text])))),
    CONSTRAINT finance_accounts_source_check CHECK (((source)::text = ANY (ARRAY[('clubdesk'::character varying)::text, ('native'::character varying)::text]))),
    CONSTRAINT finance_accounts_type_check CHECK (((type IS NULL) OR ((type)::text = ANY (ARRAY[('asset'::character varying)::text, ('liability'::character varying)::text, ('equity'::character varying)::text, ('income'::character varying)::text, ('expense'::character varying)::text, ('close'::character varying)::text]))))
);


--
-- Name: TABLE finance_accounts; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.finance_accounts IS 'Chart of accounts (Kontenplan), derived from distinct Soll/Haben accounts in the ClubDesk bookings export. type inferred from number range (1xxx asset, 2xxx liability/equity, 3xxx income, 4xxx expense, 9xxx close); division (vb/bb/club) inferred from the account name.';


--
-- Name: finance_accounts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.finance_accounts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: finance_accounts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.finance_accounts_id_seq OWNED BY public.finance_accounts.id;


--
-- Name: finance_billing_contacts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.finance_billing_contacts (
    id integer NOT NULL,
    kind character varying(16) DEFAULT 'sponsor'::character varying NOT NULL,
    name character varying(255) NOT NULL,
    email character varying(255),
    address character varying(255),
    plz character varying(10),
    ort character varying(100),
    billing_iban character varying(34),
    notes character varying(255),
    active boolean DEFAULT true NOT NULL,
    source character varying(16) DEFAULT 'native'::character varying NOT NULL,
    created_by_name character varying(255),
    created_by_email character varying(255),
    date_created timestamp with time zone DEFAULT now() NOT NULL,
    date_updated timestamp with time zone,
    user_created uuid,
    CONSTRAINT finance_billing_contacts_kind_check CHECK (((kind)::text = ANY (ARRAY[('sponsor'::character varying)::text, ('parent'::character varying)::text, ('ex_member'::character varying)::text, ('company'::character varying)::text, ('other'::character varying)::text])))
);


--
-- Name: TABLE finance_billing_contacts; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.finance_billing_contacts IS 'Non-member billing recipients (sponsors/parents/companies/ex-members). A native invoice can be billed to one via finance_invoices.contact; recipient_name/email are snapshotted at create time.';


--
-- Name: finance_billing_contacts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.finance_billing_contacts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: finance_billing_contacts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.finance_billing_contacts_id_seq OWNED BY public.finance_billing_contacts.id;


--
-- Name: finance_budget_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.finance_budget_lines (
    id integer NOT NULL,
    fiscal_year integer NOT NULL,
    account integer NOT NULL,
    amount_budgeted numeric(12,2) DEFAULT 0 NOT NULL,
    notes text,
    source character varying(16) DEFAULT 'clubdesk'::character varying NOT NULL,
    date_created timestamp with time zone DEFAULT now() NOT NULL,
    date_updated timestamp with time zone DEFAULT now() NOT NULL,
    user_created uuid,
    user_updated uuid,
    CONSTRAINT finance_budget_lines_source_check CHECK (((source)::text = ANY (ARRAY[('clubdesk'::character varying)::text, ('native'::character varying)::text])))
);


--
-- Name: TABLE finance_budget_lines; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.finance_budget_lines IS 'Budgeted amount per (fiscal_year, account) for budget-vs-actual. Populated once a ClubDesk budget export is captured; until then the dashboard shows actuals only.';


--
-- Name: finance_budget_lines_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.finance_budget_lines_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: finance_budget_lines_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.finance_budget_lines_id_seq OWNED BY public.finance_budget_lines.id;


--
-- Name: finance_dues_rates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.finance_dues_rates (
    id integer NOT NULL,
    fiscal_year integer NOT NULL,
    category character varying(100) NOT NULL,
    sektion character varying(64),
    amount_chf numeric(12,2) NOT NULL,
    subject_template character varying(255),
    active boolean DEFAULT true NOT NULL,
    created_by_name character varying(255),
    created_by_email character varying(255),
    date_created timestamp with time zone DEFAULT now() NOT NULL,
    date_updated timestamp with time zone,
    user_created uuid,
    CONSTRAINT finance_dues_rates_amount_chf_check CHECK ((amount_chf >= (0)::numeric))
);


--
-- Name: TABLE finance_dues_rates; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.finance_dues_rates IS 'Per-(fiscal_year, beitragskategorie[, sektion]) membership-fee schedule. sektion NULL = category default; a sektion row overrides. Treasurer-entered (no dues amount is mirrored from ClubDesk).';


--
-- Name: finance_dues_rates_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.finance_dues_rates_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: finance_dues_rates_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.finance_dues_rates_id_seq OWNED BY public.finance_dues_rates.id;


--
-- Name: finance_dues_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.finance_dues_runs (
    id integer NOT NULL,
    fiscal_year integer NOT NULL,
    label character varying(64),
    filter_json jsonb,
    status character varying(16) DEFAULT 'issued'::character varying NOT NULL,
    total_count integer DEFAULT 0 NOT NULL,
    total_amount numeric(12,2) DEFAULT 0 NOT NULL,
    created_by_name character varying(255),
    created_by_email character varying(255),
    date_created timestamp with time zone DEFAULT now() NOT NULL,
    user_created uuid,
    CONSTRAINT finance_dues_runs_status_check CHECK (((status)::text = ANY (ARRAY[('issued'::character varying)::text, ('cancelled'::character varying)::text])))
);


--
-- Name: TABLE finance_dues_runs; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.finance_dues_runs IS 'One row per issued dues batch: the audit trail + the handle used to bulk-cancel a run (cancels its still-open invoices, leaves paid ones).';


--
-- Name: finance_dues_runs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.finance_dues_runs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: finance_dues_runs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.finance_dues_runs_id_seq OWNED BY public.finance_dues_runs.id;


--
-- Name: finance_dunning_notices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.finance_dunning_notices (
    id integer NOT NULL,
    invoice integer NOT NULL,
    level smallint NOT NULL,
    reminder_fee numeric(12,2) DEFAULT 0 NOT NULL,
    channel character varying(16) DEFAULT 'manual'::character varying NOT NULL,
    recipient_email character varying(255),
    sent_at timestamp with time zone,
    created_by_name character varying(255),
    created_by_email character varying(255),
    date_created timestamp with time zone DEFAULT now() NOT NULL,
    user_created uuid,
    CONSTRAINT finance_dunning_notices_channel_check CHECK (((channel)::text = ANY (ARRAY[('email'::character varying)::text, ('manual'::character varying)::text]))),
    CONSTRAINT finance_dunning_notices_level_check CHECK (((level >= 1) AND (level <= 3)))
);


--
-- Name: finance_dunning_notices_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.finance_dunning_notices_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: finance_dunning_notices_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.finance_dunning_notices_id_seq OWNED BY public.finance_dunning_notices.id;


--
-- Name: finance_email_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.finance_email_jobs (
    id integer NOT NULL,
    dues_run integer,
    status character varying(16) DEFAULT 'running'::character varying NOT NULL,
    test_mode boolean DEFAULT true NOT NULL,
    total integer DEFAULT 0 NOT NULL,
    sent integer DEFAULT 0 NOT NULL,
    failed integer DEFAULT 0 NOT NULL,
    error text,
    created_by_name character varying(255),
    created_by_email character varying(255),
    date_created timestamp with time zone DEFAULT now() NOT NULL,
    date_updated timestamp with time zone,
    CONSTRAINT finance_email_jobs_status_check CHECK (((status)::text = ANY (ARRAY[('running'::character varying)::text, ('done'::character varying)::text, ('failed'::character varying)::text])))
);


--
-- Name: TABLE finance_email_jobs; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.finance_email_jobs IS 'Background dues-run email sends: one row per send, progressed (sent/failed) as the worker chunks through. The UI polls it; a recent running row blocks a duplicate send.';


--
-- Name: finance_email_jobs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.finance_email_jobs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: finance_email_jobs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.finance_email_jobs_id_seq OWNED BY public.finance_email_jobs.id;


--
-- Name: finance_email_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.finance_email_settings (
    id smallint DEFAULT 1 NOT NULL,
    test_mode boolean DEFAULT true NOT NULL,
    test_recipient character varying(255),
    updated_by_name character varying(255),
    updated_by_email character varying(255),
    date_updated timestamp with time zone,
    CONSTRAINT finance_email_settings_singleton CHECK ((id = 1))
);


--
-- Name: TABLE finance_email_settings; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.finance_email_settings IS 'Singleton (id=1) finance email switch. test_mode=true (default) redirects every dues-run email to test_recipient so members are never emailed until an admin turns it off.';


--
-- Name: finance_expenses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.finance_expenses (
    id integer NOT NULL,
    member integer NOT NULL,
    file uuid,
    amount numeric(12,2) NOT NULL,
    currency character varying(3) DEFAULT 'CHF'::character varying NOT NULL,
    expense_date date,
    vendor character varying(200),
    description character varying(300),
    reference character varying(140),
    pay_to_iban character varying(34),
    member_note character varying(1000),
    status character varying(16) DEFAULT 'pending'::character varying NOT NULL,
    finance_note character varying(1000),
    payout integer,
    status_changed_by_name character varying(255),
    status_changed_by_email character varying(255),
    status_changed_at timestamp with time zone,
    date_created timestamp with time zone DEFAULT now() NOT NULL,
    user_created uuid,
    section character varying(8),
    member_already_paid boolean DEFAULT false NOT NULL,
    tk_confirmed_at timestamp with time zone,
    tk_confirmed_by_name character varying(255),
    tk_confirmed_by_email character varying(255),
    tk_already_paid boolean DEFAULT false NOT NULL,
    tk_note character varying(1000),
    internal_note character varying(1000),
    CONSTRAINT finance_expenses_section_check CHECK (((section IS NULL) OR ((section)::text = ANY (ARRAY[('vb'::character varying)::text, ('bb'::character varying)::text, ('club'::character varying)::text])))),
    CONSTRAINT finance_expenses_status_check CHECK (((status)::text = ANY (ARRAY[('pending'::character varying)::text, ('paid'::character varying)::text, ('rejected'::character varying)::text])))
);


--
-- Name: TABLE finance_expenses; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.finance_expenses IS 'Expense reimbursement submissions from /finance/expense (member paid out of pocket, wants money back). pending → paid | rejected; on paid the endpoint auto-creates the linked finance_payouts row. Writes go through /kscw/expenses/* endpoints, not the items API.';


--
-- Name: finance_expenses_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.finance_expenses_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: finance_expenses_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.finance_expenses_id_seq OWNED BY public.finance_expenses.id;


--
-- Name: finance_fiscal_years; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.finance_fiscal_years (
    id integer NOT NULL,
    label character varying(16) NOT NULL,
    starts_on date NOT NULL,
    ends_on date NOT NULL,
    status character varying(16) DEFAULT 'open'::character varying NOT NULL,
    source character varying(16) DEFAULT 'clubdesk'::character varying NOT NULL,
    date_created timestamp with time zone DEFAULT now() NOT NULL,
    date_updated timestamp with time zone DEFAULT now() NOT NULL,
    user_created uuid,
    user_updated uuid,
    closed_on date,
    closed_by_name character varying(255),
    closed_by_email character varying(255),
    CONSTRAINT finance_fiscal_years_source_check CHECK (((source)::text = ANY (ARRAY[('clubdesk'::character varying)::text, ('native'::character varying)::text]))),
    CONSTRAINT finance_fiscal_years_status_check CHECK (((status)::text = ANY (ARRAY[('open'::character varying)::text, ('closed'::character varying)::text])))
);


--
-- Name: TABLE finance_fiscal_years; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.finance_fiscal_years IS 'Accounting periods. KSCW fiscal year runs June–May (e.g. 2025/26 = 01.06.2025–31.05.2026). Anchors budgets + reporting.';


--
-- Name: finance_fiscal_years_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.finance_fiscal_years_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: finance_fiscal_years_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.finance_fiscal_years_id_seq OWNED BY public.finance_fiscal_years.id;


--
-- Name: finance_imports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.finance_imports (
    id integer NOT NULL,
    import_type character varying(32) NOT NULL,
    filename character varying(255),
    imported_at timestamp with time zone DEFAULT now() NOT NULL,
    imported_by_name character varying(255),
    imported_by_email character varying(255),
    row_count integer,
    fiscal_year_label character varying(16),
    source_checksum character varying(64),
    notes text,
    date_created timestamp with time zone DEFAULT now() NOT NULL,
    user_created uuid,
    CONSTRAINT finance_imports_type_check CHECK (((import_type)::text = ANY (ARRAY[('invoices'::character varying)::text, ('bookings'::character varying)::text, ('accounts'::character varying)::text, ('budget'::character varying)::text, ('payments'::character varying)::text])))
);


--
-- Name: TABLE finance_imports; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.finance_imports IS 'One row per ClubDesk finance sync/import. Records WHO (imported_by_*), WHAT (import_type), and how many rows — the finance equivalent of the audit-log actor capture for the raw-knex import path.';


--
-- Name: COLUMN finance_imports.fiscal_year_label; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.finance_imports.fiscal_year_label IS 'DISPLAY-ONLY fiscal-year hint — a single label or a compact earliest–latest range (''2021/22–2026/27''); intentionally NOT a join key to finance_fiscal_years.';


--
-- Name: COLUMN finance_imports.source_checksum; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.finance_imports.source_checksum IS 'sha256 of the imported file. Importers warn (never abort) when the previous batch of the same import_type carries the same checksum — a double-import is idempotent for the mirrors but pollutes provenance.';


--
-- Name: finance_imports_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.finance_imports_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: finance_imports_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.finance_imports_id_seq OWNED BY public.finance_imports.id;


--
-- Name: finance_income_account_map; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.finance_income_account_map (
    fee_category character varying(128) NOT NULL,
    account integer,
    date_updated timestamp with time zone DEFAULT now() NOT NULL,
    updated_by_name character varying(255)
);


--
-- Name: finance_invoice_documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.finance_invoice_documents (
    id integer NOT NULL,
    file uuid NOT NULL,
    match_clubdesk_id character varying(32),
    invoice integer,
    label character varying(255),
    uploaded_by_name character varying(255),
    uploaded_by_email character varying(255),
    date_created timestamp with time zone DEFAULT now() NOT NULL,
    user_created uuid,
    CONSTRAINT finance_invoice_documents_key_check CHECK ((num_nonnulls(match_clubdesk_id, invoice) = 1))
);


--
-- Name: TABLE finance_invoice_documents; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.finance_invoice_documents IS 'Invoice PDF attachments. ClubDesk-mirror invoices key on match_clubdesk_id (survives the nightly sync, 1-1 with the ClubDesk invoice); native invoices key on the invoice FK. File lives in the private folder f1a0d0c5… — members cannot read it via /assets.';


--
-- Name: finance_invoice_documents_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.finance_invoice_documents_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: finance_invoice_documents_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.finance_invoice_documents_id_seq OWNED BY public.finance_invoice_documents.id;


--
-- Name: finance_invoice_member_overrides; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.finance_invoice_member_overrides (
    id integer NOT NULL,
    match_email character varying(255),
    match_clubdesk_id character varying(32),
    member integer NOT NULL,
    reason text,
    created_by_name character varying(255),
    created_by_email character varying(255),
    date_created timestamp with time zone DEFAULT now() NOT NULL,
    date_updated timestamp with time zone DEFAULT now() NOT NULL,
    user_created uuid,
    user_updated uuid,
    CONSTRAINT finance_invoice_member_overrides_key_check CHECK (((match_email IS NOT NULL) OR (match_clubdesk_id IS NOT NULL)))
);


--
-- Name: TABLE finance_invoice_member_overrides; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.finance_invoice_member_overrides IS 'Treasurer-set member links for ClubDesk-mirror invoices the email match missed. Re-applied by import-clubdesk-finance.mjs after every sync so manual links persist. match_email links all invoices to that recipient email; match_clubdesk_id links one invoice.';


--
-- Name: finance_invoice_member_overrides_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.finance_invoice_member_overrides_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: finance_invoice_member_overrides_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.finance_invoice_member_overrides_id_seq OWNED BY public.finance_invoice_member_overrides.id;


--
-- Name: finance_invoices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.finance_invoices (
    id integer NOT NULL,
    clubdesk_id character varying(32),
    number character varying(32),
    invoice_date date,
    subject character varying(255),
    amount numeric(12,2),
    status character varying(32),
    dunning_status character varying(32),
    due_date date,
    amount_paid numeric(12,2),
    open_amount numeric(12,2),
    overpaid_amount numeric(12,2),
    written_off_amount numeric(12,2),
    payment_method character varying(64),
    reference character varying(64),
    fee_category character varying(64),
    closed_on date,
    cd_created_at timestamp with time zone,
    cd_changed_at timestamp with time zone,
    recipient_name character varying(255),
    recipient_email character varying(255),
    cd_benutzer_id character varying(64),
    member integer,
    fiscal_year integer,
    source character varying(16) DEFAULT 'clubdesk'::character varying NOT NULL,
    import_batch integer,
    date_created timestamp with time zone DEFAULT now() NOT NULL,
    date_updated timestamp with time zone DEFAULT now() NOT NULL,
    user_created uuid,
    user_updated uuid,
    team integer,
    created_by_name character varying(255),
    created_by_email character varying(255),
    reported_paid_at timestamp with time zone,
    reported_paid_method character varying(32),
    reported_paid_by integer,
    confirmed_at timestamp with time zone,
    confirmed_by_name character varying(255),
    confirmed_by_email character varying(255),
    confirmed_via character varying(16),
    cancelled_at timestamp with time zone,
    reference_type character varying(8),
    dues_run integer,
    email_sent_at timestamp with time zone,
    dunning_level smallint DEFAULT 0 NOT NULL,
    contact integer,
    currency character varying(3) DEFAULT 'CHF'::character varying NOT NULL,
    CONSTRAINT finance_invoices_native_status_check CHECK ((((source)::text <> 'native'::text) OR ((status)::text = ANY ((ARRAY['open'::character varying, 'pending_confirmation'::character varying, 'partial'::character varying, 'paid'::character varying, 'cancelled'::character varying])::text[])))),
    CONSTRAINT finance_invoices_source_check CHECK (((source)::text = ANY (ARRAY[('clubdesk'::character varying)::text, ('native'::character varying)::text])))
);


--
-- Name: TABLE finance_invoices; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.finance_invoices IS 'Member invoices/dues mirrored from the ClubDesk Rechnungen export. Invoice fields + a member link ONLY — AHV/IBAN/home address present in the source CSV are deliberately NOT mirrored (keep the finance module low-PII). number is NULL for draft (Entwurf) invoices; clubdesk_id ([Id]) is the stable upsert key. member matched on recipient_email, fallback cd_benutzer_id.';


--
-- Name: COLUMN finance_invoices.team; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.finance_invoices.team IS 'Native team invoice: billed to this team, payable by its coach/captain/TR (resolved at read time by /finance/my-invoices). NULL for member invoices and all ClubDesk-mirror rows.';


--
-- Name: COLUMN finance_invoices.confirmed_via; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.finance_invoices.confirmed_via IS 'How a native invoice''s payment was confirmed: sync (matched in the next ClubDesk export) or manual (treasurer).';


--
-- Name: COLUMN finance_invoices.reference_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.finance_invoices.reference_type IS 'Native invoices: payment-reference scheme on the QR-bill — NON | SCOR (ISO-11649, regular IBAN) | QRR (needs QR-IBAN). NULL for ClubDesk-mirror rows.';


--
-- Name: COLUMN finance_invoices.dues_run; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.finance_invoices.dues_run IS 'Native dues invoice: the finance_dues_runs batch that minted it. NULL for ad-hoc and ClubDesk-mirror rows.';


--
-- Name: COLUMN finance_invoices.email_sent_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.finance_invoices.email_sent_at IS 'When this native dues invoice was emailed to the member (LIVE send only). NULL = not yet; used to skip already-emailed invoices on a resumed/retried run. Test-mode sends never set it.';


--
-- Name: COLUMN finance_invoices.dunning_level; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.finance_invoices.dunning_level IS 'Highest dunning level issued for this native invoice (0=none, 1/2/3). Denormalised from finance_dunning_notices.';


--
-- Name: finance_invoices_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.finance_invoices_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: finance_invoices_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.finance_invoices_id_seq OWNED BY public.finance_invoices.id;


--
-- Name: finance_ledger_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.finance_ledger_settings (
    id integer DEFAULT 1 NOT NULL,
    autopost_enabled boolean DEFAULT false NOT NULL,
    debitoren_account integer,
    bank_account integer,
    income_account integer,
    sponsoring_account integer,
    bad_debt_account integer,
    expense_account integer,
    date_updated timestamp with time zone DEFAULT now() NOT NULL,
    updated_by_name character varying(255),
    prepayment_account integer,
    sync_requested_at timestamp with time zone,
    sync_state character varying(16) DEFAULT 'idle'::character varying NOT NULL,
    sync_message text,
    sync_finished_at timestamp with time zone,
    CONSTRAINT finance_ledger_settings_singleton CHECK ((id = 1))
);


--
-- Name: finance_native_entry_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.finance_native_entry_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: finance_native_invoice_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.finance_native_invoice_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: finance_payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.finance_payments (
    id integer NOT NULL,
    invoice integer,
    payment_date date,
    amount numeric(12,2),
    method character varying(64),
    camt_reference character varying(128),
    source character varying(16) DEFAULT 'native'::character varying NOT NULL,
    import_batch integer,
    date_created timestamp with time zone DEFAULT now() NOT NULL,
    date_updated timestamp with time zone DEFAULT now() NOT NULL,
    user_created uuid,
    user_updated uuid,
    currency character varying(8),
    reference character varying(140),
    unstructured text,
    debtor_name character varying(255),
    match_status character varying(16),
    clubdesk_guess integer,
    entry_type character varying(16) DEFAULT 'payment'::character varying NOT NULL,
    note character varying(255),
    created_by_name character varying(255),
    created_by_email character varying(255),
    payout integer,
    match_clubdesk_id character varying(32),
    CONSTRAINT finance_payments_entry_type_check CHECK (((entry_type)::text = ANY (ARRAY[('payment'::character varying)::text, ('credit_note'::character varying)::text, ('refund'::character varying)::text, ('writeoff'::character varying)::text]))),
    CONSTRAINT finance_payments_match_status_check CHECK (((match_status IS NULL) OR ((match_status)::text = ANY ((ARRAY['native'::character varying, 'clubdesk_match'::character varying, 'clubdesk_guess'::character varying, 'unmatched'::character varying, 'link_lost'::character varying])::text[])))),
    CONSTRAINT finance_payments_source_check CHECK (((source)::text = ANY (ARRAY[('clubdesk'::character varying)::text, ('native'::character varying)::text])))
);


--
-- Name: TABLE finance_payments; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.finance_payments IS 'Individual payments against invoices. Created now for Scope C (camt.053/054 reconciliation); stays empty under Scope A, where paid/open amounts are read directly off finance_invoices.';


--
-- Name: COLUMN finance_payments.currency; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.finance_payments.currency IS 'Raw currency of the bank credit as reported by the camt entry — intentionally nullable with no default (a missing value must stay visibly missing, never masquerade as CHF; finance-camt.js skips non-CHF credits before matching).';


--
-- Name: COLUMN finance_payments.match_status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.finance_payments.match_status IS 'How the camt credit was reconciled: native (matched a native invoice by SCOR/QRR ref → auto-confirmed) | clubdesk_match (matched a ClubDesk invoice by number, cross-check only) | clubdesk_guess (fuzzy candidate flagged, NOT applied) | unmatched | link_lost (the matched ClubDesk invoice vanished from a later sync).';


--
-- Name: COLUMN finance_payments.entry_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.finance_payments.entry_type IS 'payment (money in: cash/twint/bank/camt) | credit_note (non-cash reduction) | writeoff (uncollectable) | refund (money returned). NULL legacy rows = payment.';


--
-- Name: COLUMN finance_payments.match_clubdesk_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.finance_payments.match_clubdesk_id IS 'Stable ClubDesk id of the matched/guessed mirror invoice. clubdesk_guess is an id FK and every ClubDesk finance sync re-keys the mirror (delete+reinsert → SET NULL), so the importer re-points clubdesk_guess from this snapshot; when the invoice vanished from ClubDesk it flips match_status to ''link_lost''.';


--
-- Name: finance_payments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.finance_payments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: finance_payments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.finance_payments_id_seq OWNED BY public.finance_payments.id;


--
-- Name: finance_payouts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.finance_payouts (
    id integer NOT NULL,
    member integer NOT NULL,
    amount numeric(12,2),
    currency character varying(3) DEFAULT 'CHF'::character varying NOT NULL,
    message character varying(140),
    iban character varying(34) NOT NULL,
    payee_name character varying(255),
    payee_address character varying(255),
    payee_zip character varying(10),
    payee_ort character varying(100),
    status character varying(16) DEFAULT 'open'::character varying NOT NULL,
    created_by_name character varying(255),
    created_by_email character varying(255),
    date_created timestamp with time zone DEFAULT now() NOT NULL,
    user_created uuid,
    CONSTRAINT finance_payouts_status_check CHECK (((status)::text = ANY ((ARRAY['open'::character varying, 'paid'::character varying, 'cancelled'::character varying])::text[])))
);


--
-- Name: TABLE finance_payouts; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.finance_payouts IS 'Reimbursements the club owes a member (club → member; opposite of finance_invoices). Saved by finance in the member explorer; visible to the member on My finances. payee_* snapshot the QR-bill creditor at save time.';


--
-- Name: finance_payouts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.finance_payouts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: finance_payouts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.finance_payouts_id_seq OWNED BY public.finance_payouts.id;


--
-- Name: finance_team_entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.finance_team_entries (
    id integer NOT NULL,
    team integer NOT NULL,
    fiscal_year integer,
    kind character varying(16) DEFAULT 'sponsoring'::character varying NOT NULL,
    amount numeric(12,2) NOT NULL,
    label character varying(255),
    sponsor character varying(255),
    entry_date date,
    note character varying(255),
    created_by_name character varying(255),
    created_by_email character varying(255),
    date_created timestamp with time zone DEFAULT now() NOT NULL,
    user_created uuid,
    currency character varying(3) DEFAULT 'CHF'::character varying NOT NULL,
    CONSTRAINT finance_team_entries_amount_check CHECK ((amount >= (0)::numeric)),
    CONSTRAINT finance_team_entries_kind_check CHECK (((kind)::text = ANY (ARRAY[('sponsoring'::character varying)::text, ('income'::character varying)::text, ('expense'::character varying)::text])))
);


--
-- Name: TABLE finance_team_entries; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.finance_team_entries IS 'Per-team finance ledger: sponsoring/other income (IN) and bills/costs (OUT), per team + fiscal year. The teams-summary endpoint nets these with team-tagged native invoices.';


--
-- Name: finance_team_entries_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.finance_team_entries_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: finance_team_entries_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.finance_team_entries_id_seq OWNED BY public.finance_team_entries.id;


--
-- Name: finance_transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.finance_transactions (
    id integer NOT NULL,
    clubdesk_id character varying(32),
    typ character varying(48),
    beleg character varying(64),
    booking_date date NOT NULL,
    text text,
    debit_account_number character varying(16),
    debit_account_name character varying(128),
    credit_account_number character varying(16),
    credit_account_name character varying(128),
    debit_account integer,
    credit_account integer,
    amount_chf numeric(12,2),
    fiscal_year integer,
    source character varying(16) DEFAULT 'clubdesk'::character varying NOT NULL,
    import_batch integer,
    date_created timestamp with time zone DEFAULT now() NOT NULL,
    date_updated timestamp with time zone DEFAULT now() NOT NULL,
    user_created uuid,
    user_updated uuid,
    created_by_name character varying(255),
    created_by_email character varying(255),
    reversal_of integer,
    ref_kind character varying(24),
    ref_id integer,
    auto boolean DEFAULT false NOT NULL,
    CONSTRAINT finance_transactions_ref_kind_check CHECK (((ref_kind IS NULL) OR ((ref_kind)::text = ANY ((ARRAY['issue'::character varying, 'settle'::character varying, 'settle_over'::character varying, 'round'::character varying, 'team'::character varying])::text[])))),
    CONSTRAINT finance_transactions_source_check CHECK (((source)::text = ANY (ARRAY[('clubdesk'::character varying)::text, ('native'::character varying)::text])))
);


--
-- Name: TABLE finance_transactions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.finance_transactions IS 'Double-entry ledger mirrored from the ClubDesk Buchhaltung export. debit_/credit_account_number+name are the raw Soll/Haben values; debit_account/credit_account are the resolved finance_accounts FKs. typ ∈ Eröffnung/Abschluss/Rechnung/Rechnung (Sammel)/Rechnung (Sammelposition)/Standard (free text — ClubDesk may add more).';


--
-- Name: COLUMN finance_transactions.amount_chf; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.finance_transactions.amount_chf IS 'Amount in CHF (nullable). ClubDesk exports Swiss-formatted (1''234.56) — the importer strips the apostrophe. NULL on collective-invoice header rows (Typ ''Rechnung (Sammel)''), which carry no amount; the postings are on the Sammelposition child rows.';


--
-- Name: COLUMN finance_transactions.reversal_of; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.finance_transactions.reversal_of IS 'For a native correction: the entry this one reverses (debit/credit swapped). NULL for normal postings.';


--
-- Name: COLUMN finance_transactions.ref_kind; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.finance_transactions.ref_kind IS 'Auto-post link: issue | settle | settle_over (overpayment/prepayment leg) | round (≤1-rappen residual forgiveness) | team (the A/R or team-ledger event that produced this journal entry). NULL on ClubDesk-mirror and manual rows.';


--
-- Name: COLUMN finance_transactions.ref_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.finance_transactions.ref_id IS 'Auto-post link: the finance_invoices.id (issue), finance_payments.id (settle), or finance_team_entries.id (team).';


--
-- Name: finance_transactions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.finance_transactions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: finance_transactions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.finance_transactions_id_seq OWNED BY public.finance_transactions.id;


--
-- Name: fine_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fine_rules (
    id integer NOT NULL,
    team integer NOT NULL,
    category character varying(32) NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    reset_window character varying(32) DEFAULT 'calendar_month'::character varying NOT NULL,
    tiers jsonb DEFAULT '[]'::jsonb NOT NULL,
    currency character varying(3) DEFAULT 'CHF'::character varying NOT NULL,
    notes text,
    date_created timestamp with time zone DEFAULT now() NOT NULL,
    date_updated timestamp with time zone DEFAULT now() NOT NULL,
    user_created uuid,
    user_updated uuid,
    updated_by integer,
    CONSTRAINT fine_rules_category_check CHECK (((category)::text = ANY (ARRAY[('late_signin'::character varying)::text, ('no_show'::character varying)::text, ('late_payment'::character varying)::text, ('custom'::character varying)::text]))),
    CONSTRAINT fine_rules_reset_window_check CHECK (((reset_window)::text = ANY (ARRAY[('calendar_month'::character varying)::text, ('rolling_30d'::character varying)::text, ('rolling_90d'::character varying)::text, ('season'::character varying)::text, ('never'::character varying)::text])))
);


--
-- Name: TABLE fine_rules; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.fine_rules IS 'Per-team×category fine config: escalation tiers + reset window. Read by useFineQuote on the frontend and by kscw_compute_fine_amount() in the backend hook. One row per (team,category) — UNIQUE enforced.';


--
-- Name: COLUMN fine_rules.reset_window; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.fine_rules.reset_window IS 'When the offense counter resets. calendar_month=first of current month; rolling_30d/90d=relative; season=Sep 1 of current season (matches getCurrentSeason in dateHelpers.ts); never=lifetime.';


--
-- Name: COLUMN fine_rules.tiers; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.fine_rules.tiers IS 'jsonb array of escalation tiers. Each entry: {offense:N, amount:X} for an exact match, or {offense_min:N, amount:X} for the last "Nth and beyond" entry. Lookup order in kscw_compute_fine_amount: exact offense match, then highest offense_min ≤ current offense, then last tier as fallback.';


--
-- Name: fine_rules_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.fine_rules_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: fine_rules_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.fine_rules_id_seq OWNED BY public.fine_rules.id;


--
-- Name: fines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fines (
    id integer NOT NULL,
    member integer NOT NULL,
    team integer NOT NULL,
    category character varying(32) NOT NULL,
    amount numeric(8,2) NOT NULL,
    currency character varying(3) DEFAULT 'CHF'::character varying NOT NULL,
    status character varying(16) DEFAULT 'open'::character varying NOT NULL,
    activity_type character varying(16),
    activity_id integer,
    activity_date date,
    tier_offense integer,
    reset_window_at_issue character varying(32),
    reason text,
    issued_by integer,
    issued_at timestamp with time zone DEFAULT now() NOT NULL,
    paid_at timestamp with time zone,
    paid_method character varying(16),
    paid_to character varying(16),
    paid_received_by integer,
    waived_at timestamp with time zone,
    waived_by integer,
    waived_reason text,
    auto_issued boolean DEFAULT false NOT NULL,
    notes text,
    date_created timestamp with time zone DEFAULT now() NOT NULL,
    date_updated timestamp with time zone DEFAULT now() NOT NULL,
    user_created uuid,
    user_updated uuid,
    CONSTRAINT fines_activity_type_check CHECK (((activity_type IS NULL) OR ((activity_type)::text = ANY (ARRAY[('training'::character varying)::text, ('game'::character varying)::text, ('event'::character varying)::text])))),
    CONSTRAINT fines_amount_nonneg CHECK ((amount >= (0)::numeric)),
    CONSTRAINT fines_category_check CHECK (((category)::text = ANY (ARRAY[('late_signin'::character varying)::text, ('no_show'::character varying)::text, ('late_payment'::character varying)::text, ('custom'::character varying)::text]))),
    CONSTRAINT fines_paid_method_check CHECK (((paid_method IS NULL) OR ((paid_method)::text = ANY (ARRAY[('cash'::character varying)::text, ('twint'::character varying)::text, ('transfer'::character varying)::text, ('other'::character varying)::text])))),
    CONSTRAINT fines_paid_to_check CHECK (((paid_to IS NULL) OR ((paid_to)::text = ANY (ARRAY[('team_kasse'::character varying)::text, ('club_kasse'::character varying)::text])))),
    CONSTRAINT fines_status_check CHECK (((status)::text = ANY (ARRAY[('open'::character varying)::text, ('paid'::character varying)::text, ('waived'::character varying)::text])))
);


--
-- Name: TABLE fines; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.fines IS 'Per-member fine ledger. amount + tier_offense + reset_window_at_issue are snapshotted at issue time and never re-derived. Edits to amount/category/reason are blocked by the kscw-hooks filter — leaders must waive + reissue to change a wrong fine, preserving audit trail.';


--
-- Name: fines_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.fines_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: fines_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.fines_id_seq OWNED BY public.fines.id;


--
-- Name: form_submissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.form_submissions (
    id integer NOT NULL,
    form integer NOT NULL,
    member integer,
    answers jsonb DEFAULT '{}'::jsonb NOT NULL,
    submitted_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE form_submissions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.form_submissions IS 'One row per form submission. `answers` is a JSON object keyed by form.fields[].id. `member` is NULL for anonymous forms.';


--
-- Name: form_submissions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.form_submissions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: form_submissions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.form_submissions_id_seq OWNED BY public.form_submissions.id;


--
-- Name: forms; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.forms (
    id integer NOT NULL,
    title text NOT NULL,
    description text,
    status text DEFAULT 'draft'::text NOT NULL,
    audience text DEFAULT 'club_wide'::text NOT NULL,
    fields jsonb DEFAULT '[]'::jsonb NOT NULL,
    anonymous boolean DEFAULT false NOT NULL,
    allow_multiple boolean DEFAULT false NOT NULL,
    opens_at timestamp with time zone,
    closes_at timestamp with time zone,
    created_by integer,
    date_created timestamp with time zone DEFAULT now() NOT NULL,
    date_updated timestamp with time zone DEFAULT now() NOT NULL,
    user_created uuid,
    user_updated uuid,
    success_message text,
    is_public boolean DEFAULT false NOT NULL,
    slug text,
    CONSTRAINT forms_audience_check CHECK ((audience = ANY (ARRAY['club_wide'::text, 'teams'::text]))),
    CONSTRAINT forms_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'open'::text, 'closed'::text])))
);


--
-- Name: TABLE forms; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.forms IS 'Internal form definitions. `fields` is the JSON form schema (array of {id,type,label,required,options?}); `answers` on form_submissions is keyed by those field ids. Scoped club-wide or to teams (via the forms_teams M2M, migration 087). Authored by Sport Admin (any) or coaches/TRs (own teams) per setup-permissions.mjs.';


--
-- Name: COLUMN forms.fields; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.forms.fields IS 'Form definition: array of field defs. Field types v1: short_text, long_text, single_choice, multi_choice, number, date, yes_no. Choice types carry options[].';


--
-- Name: COLUMN forms.anonymous; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.forms.anonymous IS 'When true, submissions store member=NULL — no "who responded" tracking and no per-member dedup.';


--
-- Name: COLUMN forms.allow_multiple; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.forms.allow_multiple IS 'When true, a member may submit more than once (ignored for anonymous forms).';


--
-- Name: COLUMN forms.closes_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.forms.closes_at IS 'Optional deadline. After this instant the submission guard rejects new submissions.';


--
-- Name: COLUMN forms.success_message; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.forms.success_message IS 'Optional custom confirmation text shown to the member after a successful submission (falls back to a generic "thank you" when null).';


--
-- Name: COLUMN forms.is_public; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.forms.is_public IS 'When true and status=open, the form is served on the public website via /kscw/public/forms/:slug and accepts anonymous submissions through the Turnstile-protected public endpoint.';


--
-- Name: COLUMN forms.slug; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.forms.slug IS 'URL-safe public identifier (unique). Required when is_public; powers /de/formular/<slug> on kscw-website.';


--
-- Name: forms_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.forms_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: forms_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.forms_id_seq OWNED BY public.forms.id;


--
-- Name: forms_teams; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.forms_teams (
    id integer NOT NULL,
    forms_id integer NOT NULL,
    teams_id integer NOT NULL
);


--
-- Name: TABLE forms_teams; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.forms_teams IS 'M2M junction: forms ⇄ teams. Scopes a form (audience=teams) to specific teams. Mirrors events_teams.';


--
-- Name: forms_teams_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.forms_teams_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: forms_teams_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.forms_teams_id_seq OWNED BY public.forms_teams.id;


--
-- Name: game_rosters; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.game_rosters (
    id integer NOT NULL,
    game integer NOT NULL,
    member integer,
    last_name character varying(100) DEFAULT ''::character varying NOT NULL,
    first_initial character varying(8) DEFAULT ''::character varying NOT NULL,
    birthdate date,
    licence character varying(16),
    eligible boolean DEFAULT true NOT NULL,
    number integer,
    is_captain boolean DEFAULT false NOT NULL,
    is_libero boolean DEFAULT false NOT NULL,
    added boolean DEFAULT false NOT NULL,
    dropped boolean DEFAULT false NOT NULL,
    source character varying(8) DEFAULT 'vm'::character varying NOT NULL,
    edited_by_name character varying(150),
    edited_by_email character varying(150),
    date_created timestamp with time zone DEFAULT now() NOT NULL,
    date_updated timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE game_rosters; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.game_rosters IS 'Per-game match sheet as the coach adjusted it. Snapshot written on first edit; empty means "derive from the Einsatzliste / RSVPs". Never pushed to Volleymanager.';


--
-- Name: COLUMN game_rosters.number; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.game_rosters.number IS 'Jersey for THIS game. Seeded from members.number (which is club-wide and therefore wrong for anyone playing in two teams); the coach corrects it here.';


--
-- Name: COLUMN game_rosters.is_libero; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.game_rosters.is_libero IS 'Libero for THIS match. Seeded from members.position containing "libero". A per-match designation in the rules — deliberately not a property of the person.';


--
-- Name: COLUMN game_rosters.added; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.game_rosters.added IS 'Not on the Einsatzliste. Diverges from Volleymanager — must be entered there by hand.';


--
-- Name: COLUMN game_rosters.dropped; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.game_rosters.dropped IS 'On the Einsatzliste but struck off. Diverges from Volleymanager — must be entered there by hand.';


--
-- Name: game_rosters_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.game_rosters_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: game_rosters_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.game_rosters_id_seq OWNED BY public.game_rosters.id;


--
-- Name: game_scheduling_bookings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.game_scheduling_bookings (
    id integer NOT NULL,
    season integer,
    type character varying(255) DEFAULT NULL::character varying,
    proposed_datetime_1 timestamp with time zone,
    proposed_place_1 character varying(255) DEFAULT NULL::character varying,
    proposed_datetime_2 timestamp with time zone,
    proposed_place_2 character varying(255) DEFAULT NULL::character varying,
    proposed_datetime_3 timestamp with time zone,
    proposed_place_3 character varying(255) DEFAULT NULL::character varying,
    confirmed_proposal integer,
    status character varying(255) DEFAULT NULL::character varying,
    admin_notes text,
    opponent integer,
    slot integer,
    date_created timestamp with time zone,
    date_updated timestamp with time zone,
    proposed_slot_1 integer,
    proposed_slot_2 integer,
    proposed_slot_3 integer,
    vm_game_id character varying(64),
    vm_pushed_at timestamp with time zone,
    vm_push_status character varying(24),
    vm_push_error text,
    svrz_game_id character varying(255),
    proposed_by_name text,
    proposed_by_email text,
    confirmed_by_name text,
    confirmed_by_email text,
    confirmed_at timestamp with time zone,
    CONSTRAINT game_scheduling_bookings_status_chk CHECK (((status IS NULL) OR ((status)::text = ANY ((ARRAY['pending'::character varying, 'confirmed'::character varying, 'rejected'::character varying])::text[]))))
);


--
-- Name: COLUMN game_scheduling_bookings.proposed_slot_1; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.game_scheduling_bookings.proposed_slot_1 IS 'Home-slot proposal 1 — game_scheduling_slots.id the opponent proposed (pending home_slot_pick). On confirm, the chosen one is copied into `slot`.';


--
-- Name: game_scheduling_bookings_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.game_scheduling_bookings_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: game_scheduling_bookings_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.game_scheduling_bookings_id_seq OWNED BY public.game_scheduling_bookings.id;


--
-- Name: game_scheduling_club_portals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.game_scheduling_club_portals (
    id integer NOT NULL,
    season integer NOT NULL,
    club_id character varying(32) NOT NULL,
    club_name character varying(255),
    token character varying(255) NOT NULL,
    status character varying(32) DEFAULT 'invited'::character varying NOT NULL,
    language character varying(5),
    contact_name text,
    contact_email text,
    club_note text,
    first_viewed_at timestamp with time zone,
    email_sent_at timestamp with time zone,
    reminder_sent_at timestamp with time zone,
    expires_at timestamp with time zone,
    created_by_admin boolean DEFAULT true NOT NULL,
    date_created timestamp with time zone DEFAULT now() NOT NULL,
    date_updated timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE game_scheduling_club_portals; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.game_scheduling_club_portals IS 'Per-club opponent scheduling portal. One row per (season, club_id) — the shared token behind /terminplanung/club/:token plus the club-level contact/language/status. Groups the club''s per-team game_scheduling_opponents rows (by season+club_id) so an opponent club gets ONE link covering all its teams vs KSCW. Only minted for seasons with game_scheduling_seasons.use_club_portals = true. Managed via the kscw game-scheduling endpoints (knex); public reads are token-gated in code.';


--
-- Name: game_scheduling_club_portals_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.game_scheduling_club_portals_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: game_scheduling_club_portals_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.game_scheduling_club_portals_id_seq OWNED BY public.game_scheduling_club_portals.id;


--
-- Name: game_scheduling_derbies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.game_scheduling_derbies (
    id integer NOT NULL,
    season integer NOT NULL,
    team_a integer NOT NULL,
    team_b integer NOT NULL,
    leg1_svrz_id character varying(255),
    leg1_home_team integer,
    leg1_date date,
    leg2_svrz_id character varying(255),
    leg2_home_team integer,
    leg2_date date,
    confirmed boolean DEFAULT false NOT NULL,
    date_created timestamp with time zone DEFAULT now() NOT NULL,
    date_updated timestamp with time zone DEFAULT now() NOT NULL,
    user_created uuid,
    user_updated uuid,
    CONSTRAINT game_scheduling_derbies_team_order_check CHECK ((team_a < team_b))
);


--
-- Name: TABLE game_scheduling_derbies; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.game_scheduling_derbies IS 'Intra-club derby anchors (Art. 27 SVRZ). One row per season + KSCW team pair sharing a league group. The spielplaner sets the two head-to-head game dates (one Vorrunde leg, one Rückrunde leg); once confirmed, the opponent home-slot + away-date flow for both teams is clamped to after the relevant derby date per half. Managed only via the kscw game-scheduling endpoints (knex, admin/spielplaner-gated).';


--
-- Name: COLUMN game_scheduling_derbies.leg1_svrz_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.game_scheduling_derbies.leg1_svrz_id IS 'svrz_games.svrz_persistence_id of the first head-to-head fixture this anchor maps to.';


--
-- Name: COLUMN game_scheduling_derbies.leg1_date; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.game_scheduling_derbies.leg1_date IS 'Date the spielplaner fixed for leg 1. Its Vor-/Rückrunde half is derived from this date vs the 01.01 boundary at read time.';


--
-- Name: COLUMN game_scheduling_derbies.confirmed; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.game_scheduling_derbies.confirmed IS 'true once both leg dates are set + the spielplaner confirms. Only confirmed rows clamp the external slot flow.';


--
-- Name: game_scheduling_derbies_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.game_scheduling_derbies_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: game_scheduling_derbies_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.game_scheduling_derbies_id_seq OWNED BY public.game_scheduling_derbies.id;


--
-- Name: game_scheduling_opponents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.game_scheduling_opponents (
    id integer NOT NULL,
    season integer,
    club_name character varying(255) DEFAULT NULL::character varying,
    contact_name text DEFAULT NULL::character varying,
    contact_email text DEFAULT NULL::character varying,
    token character varying(255) DEFAULT NULL::character varying,
    kscw_team integer,
    home_game integer,
    away_game integer,
    date_created timestamp with time zone,
    date_updated timestamp with time zone,
    status character varying(32) DEFAULT 'active'::character varying NOT NULL,
    created_by_admin boolean DEFAULT false NOT NULL,
    source character varying(32) DEFAULT 'self_registration'::character varying NOT NULL,
    first_viewed_at timestamp with time zone,
    expires_at timestamp with time zone,
    team_name character varying(255) DEFAULT NULL::character varying,
    language character varying(5),
    new_slots_requested_at timestamp with time zone,
    kscw_note text,
    opponent_note text,
    email_sent_at timestamp with time zone,
    reminder_sent_at timestamp with time zone,
    calendar_contact_name text,
    calendar_contact_email text,
    team_contact_name text,
    team_contact_email text,
    club_id character varying(32)
);


--
-- Name: COLUMN game_scheduling_opponents.language; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.game_scheduling_opponents.language IS 'Opponent UI language chosen on the public Terminplanung page (de/gsw/en/fr/it). Used for transactional emails. Null = not yet chosen (falls back to de).';


--
-- Name: COLUMN game_scheduling_opponents.reminder_sent_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.game_scheduling_opponents.reminder_sent_at IS 'When a scheduling reminder was last emailed to this opponent (NULL = never reminded).';


--
-- Name: game_scheduling_opponents_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.game_scheduling_opponents_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: game_scheduling_opponents_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.game_scheduling_opponents_id_seq OWNED BY public.game_scheduling_opponents.id;


--
-- Name: game_scheduling_seasons; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.game_scheduling_seasons (
    id integer NOT NULL,
    season character varying(255) DEFAULT NULL::character varying,
    status character varying(255) DEFAULT NULL::character varying,
    spielsamstage json,
    team_slot_config json,
    notes text,
    date_created timestamp with time zone,
    date_updated timestamp with time zone,
    svrz_season_uuid character varying(64) DEFAULT NULL::character varying,
    gap_config jsonb DEFAULT '{"home": 4, "proposal": 4, "proposal3": 2}'::jsonb NOT NULL,
    season_opens date,
    season_closes date,
    vm_authority_date date,
    use_club_portals boolean DEFAULT false NOT NULL
);


--
-- Name: COLUMN game_scheduling_seasons.gap_config; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.game_scheduling_seasons.gap_config IS 'Per-season game-spacing gaps in days {home, proposal, proposal3}: minimum days between games. proposal3 is the lenient gap for the 3rd away proposal.';


--
-- Name: COLUMN game_scheduling_seasons.season_opens; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.game_scheduling_seasons.season_opens IS 'First date the tool offers slots/away dates. NULL → Sep 1 of the season''s first year.';


--
-- Name: COLUMN game_scheduling_seasons.season_closes; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.game_scheduling_seasons.season_closes IS 'Last date the tool offers slots/away dates. NULL → Mar 31 of the season''s second year.';


--
-- Name: COLUMN game_scheduling_seasons.vm_authority_date; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.game_scheduling_seasons.vm_authority_date IS 'Date the Swiss Volley feed becomes authoritative for tool-scheduled games'' date/time/venue. Before it, the sync protects the agreed values against the feed placeholder; on/after it, the feed wins. NULL → protect indefinitely (until the game is completed).';


--
-- Name: game_scheduling_seasons_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.game_scheduling_seasons_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: game_scheduling_seasons_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.game_scheduling_seasons_id_seq OWNED BY public.game_scheduling_seasons.id;


--
-- Name: game_scheduling_slots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.game_scheduling_slots (
    id integer NOT NULL,
    season integer,
    date date,
    start_time time without time zone,
    end_time time without time zone,
    source character varying(255) DEFAULT NULL::character varying,
    status character varying(255) DEFAULT NULL::character varying,
    kscw_team integer,
    hall integer,
    date_created timestamp with time zone,
    date_updated timestamp with time zone,
    additional_halls json,
    CONSTRAINT game_scheduling_slots_status_chk CHECK (((status IS NULL) OR ((status)::text = ANY ((ARRAY['available'::character varying, 'booked'::character varying, 'blocked'::character varying])::text[]))))
);


--
-- Name: game_scheduling_slots_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.game_scheduling_slots_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: game_scheduling_slots_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.game_scheduling_slots_id_seq OWNED BY public.game_scheduling_slots.id;


--
-- Name: games; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.games (
    id integer NOT NULL,
    game_id character varying(255) DEFAULT NULL::character varying,
    home_team character varying(255) DEFAULT NULL::character varying,
    away_team character varying(255) DEFAULT NULL::character varying,
    away_hall_json json,
    date date,
    "time" time without time zone,
    league character varying(255) DEFAULT NULL::character varying,
    round character varying(255) DEFAULT NULL::character varying,
    season character varying(255) DEFAULT NULL::character varying,
    type character varying(255) DEFAULT NULL::character varying,
    status character varying(255) DEFAULT NULL::character varying,
    home_score integer DEFAULT 0,
    away_score integer DEFAULT 0,
    sets_json json,
    duty_confirmed boolean DEFAULT false NOT NULL,
    referees_json json,
    source character varying(255) DEFAULT NULL::character varying,
    respond_by timestamp with time zone,
    min_participants integer,
    kscw_team integer,
    hall integer,
    scorer_member integer,
    scoreboard_member integer,
    scorer_scoreboard_member integer,
    scorer_duty_team integer,
    scoreboard_duty_team integer,
    scorer_scoreboard_duty_team integer,
    bb_scorer_member integer,
    bb_timekeeper_member integer,
    bb_24s_official integer,
    bb_duty_team integer,
    bb_scorer_duty_team integer,
    bb_timekeeper_duty_team integer,
    bb_24s_duty_team integer,
    date_created timestamp with time zone,
    date_updated timestamp with time zone,
    send_email_invite boolean DEFAULT false,
    svrz_push_status public.svrz_push_status_enum,
    additional_halls json,
    auto_confirm_rsvp boolean,
    scorer_confirmed_by_name character varying(255),
    scorer_confirmed_at timestamp with time zone,
    scoreboard_confirmed_by_name character varying(255),
    scoreboard_confirmed_at timestamp with time zone,
    scorer_scoreboard_confirmed_by_name character varying(255),
    scorer_scoreboard_confirmed_at timestamp with time zone,
    bb_scorer_confirmed_by_name character varying(255),
    bb_scorer_confirmed_at timestamp with time zone,
    bb_timekeeper_confirmed_by_name character varying(255),
    bb_timekeeper_confirmed_at timestamp with time zone,
    bb_24s_confirmed_by_name character varying(255),
    bb_24s_confirmed_at timestamp with time zone,
    referee_duty_team integer,
    referee_member integer,
    referee_confirmed_by_name character varying(255),
    referee_confirmed_at timestamp with time zone,
    duty_late_json jsonb,
    duty_leader_alert_json jsonb,
    auto_nomination_list boolean,
    vm_nomination_status character varying(16),
    vm_nomination_list_id character varying(64),
    vm_nomination_count integer,
    vm_nomination_pushed_at timestamp with time zone,
    vm_nomination_error text,
    CONSTRAINT games_status_chk CHECK (((status IS NULL) OR ((status)::text = ANY ((ARRAY['scheduled'::character varying, 'completed'::character varying, 'cancelled'::character varying, 'postponed'::character varying])::text[]))))
);


--
-- Name: COLUMN games.auto_confirm_rsvp; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.games.auto_confirm_rsvp IS 'NULL = inherit teams.features_enabled.game_auto_confirm. true/false = per-activity override.';


--
-- Name: COLUMN games.duty_late_json; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.games.duty_late_json IS 'Per-role late-arrival reports { role: { at, by_name } } (migration 202). Written by the duty-late endpoint; no contact info stored.';


--
-- Name: COLUMN games.duty_leader_alert_json; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.games.duty_leader_alert_json IS 'Emergency "contact team leaders" reports { memberId: { at, by_name } } (migration 203). Written by the duty-leader-contact endpoint; no contact info stored.';


--
-- Name: COLUMN games.auto_nomination_list; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.games.auto_nomination_list IS 'Auto-file the Volleymanager Einsatzliste from confirmed RSVPs ~60 min before kickoff. NULL = inherit teams.features_enabled.auto_nomination_list; true/false = per-game override.';


--
-- Name: COLUMN games.vm_nomination_status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.games.vm_nomination_status IS 'filled = players written, list left OPEN (a fineable validation issue blocked the close, or the team asked us not to close). closed = filed AND closed, nothing left to do. skipped = nothing to file (no licensed confirmed players). failed = see vm_nomination_error. NULL = never attempted. The cron re-attempts anything not in (closed, skipped).';


--
-- Name: COLUMN games.vm_nomination_list_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.games.vm_nomination_list_id IS 'Volleymanager nominationList __identity (uuid). Set once created; lets a retry update the existing list instead of creating a second one.';


--
-- Name: COLUMN games.vm_nomination_count; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.games.vm_nomination_count IS 'Players actually filed on the last successful push.';


--
-- Name: COLUMN games.vm_nomination_error; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.games.vm_nomination_error IS 'Last push failure, surfaced to the coach in the game detail modal.';


--
-- Name: games_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.games_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: games_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.games_id_seq OWNED BY public.games.id;


--
-- Name: hall_closures; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hall_closures (
    id integer NOT NULL,
    start_date date,
    end_date date,
    reason character varying(255) DEFAULT NULL::character varying,
    source character varying(255) DEFAULT NULL::character varying,
    hall integer,
    date_created timestamp with time zone,
    date_updated timestamp with time zone,
    CONSTRAINT hall_closures_range_chk CHECK (((start_date IS NULL) OR (end_date IS NULL) OR (end_date >= start_date)))
);


--
-- Name: hall_closures_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.hall_closures_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: hall_closures_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.hall_closures_id_seq OWNED BY public.hall_closures.id;


--
-- Name: hall_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hall_events (
    id integer NOT NULL,
    uid character varying(255) DEFAULT NULL::character varying,
    title character varying(255) DEFAULT NULL::character varying,
    date date,
    start_time time without time zone,
    end_time time without time zone,
    location character varying(255) DEFAULT NULL::character varying,
    all_day boolean DEFAULT false NOT NULL,
    source character varying(255) DEFAULT NULL::character varying,
    date_created timestamp with time zone,
    date_updated timestamp with time zone
);


--
-- Name: hall_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.hall_events_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: hall_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.hall_events_id_seq OWNED BY public.hall_events.id;


--
-- Name: hall_slots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hall_slots (
    id integer NOT NULL,
    day_of_week integer,
    start_time time without time zone,
    end_time time without time zone,
    slot_type character varying(255) DEFAULT NULL::character varying,
    recurring boolean DEFAULT true NOT NULL,
    valid_from date,
    valid_until date,
    indefinite boolean DEFAULT false NOT NULL,
    label character varying(255) DEFAULT NULL::character varying,
    notes text,
    sport character varying(255) DEFAULT NULL::character varying,
    hall integer,
    date_created timestamp with time zone,
    date_updated timestamp with time zone
);


--
-- Name: hall_slots_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.hall_slots_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: hall_slots_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.hall_slots_id_seq OWNED BY public.hall_slots.id;


--
-- Name: hall_slots_teams; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hall_slots_teams (
    id integer NOT NULL,
    hall_slots_id integer NOT NULL,
    teams_id integer NOT NULL
);


--
-- Name: hall_slots_teams_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.hall_slots_teams_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: hall_slots_teams_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.hall_slots_teams_id_seq OWNED BY public.hall_slots_teams.id;


--
-- Name: halls; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.halls (
    id integer NOT NULL,
    name character varying(255) DEFAULT NULL::character varying NOT NULL,
    address character varying(255) DEFAULT NULL::character varying,
    city character varying(255) DEFAULT NULL::character varying,
    courts integer,
    notes text,
    maps_url character varying(255) DEFAULT NULL::character varying,
    homologation boolean DEFAULT false NOT NULL,
    sv_hall_id character varying(255) DEFAULT NULL::character varying,
    date_created timestamp with time zone,
    date_updated timestamp with time zone,
    vm_hall_id character varying(64)
);


--
-- Name: halls_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.halls_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: halls_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.halls_id_seq OWNED BY public.halls.id;


--
-- Name: identity_document_keys; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.identity_document_keys (
    id integer NOT NULL,
    document integer NOT NULL,
    recipient integer NOT NULL,
    eph_public_key text NOT NULL,
    wrap_iv text NOT NULL,
    wrapped_key text NOT NULL,
    recipient_key_created timestamp with time zone,
    date_created timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE identity_document_keys; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.identity_document_keys IS 'The per-document content key, wrapped to each authorised reader (the member + the coaches/TRs of their teams). We store these but hold no key that opens them.';


--
-- Name: COLUMN identity_document_keys.recipient_key_created; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.identity_document_keys.recipient_key_created IS 'The recipient''s e2ee_key_created at wrap time. If it no longer matches, the recipient has re-keyed and this envelope is dead — the owner must re-wrap.';


--
-- Name: identity_document_keys_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.identity_document_keys_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: identity_document_keys_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.identity_document_keys_id_seq OWNED BY public.identity_document_keys.id;


--
-- Name: identity_documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.identity_documents (
    id integer NOT NULL,
    member integer NOT NULL,
    file uuid NOT NULL,
    iv text NOT NULL,
    mime character varying(64),
    size integer,
    uploaded_by integer,
    uploaded_by_self boolean DEFAULT true NOT NULL,
    date_created timestamp with time zone DEFAULT now() NOT NULL,
    date_updated timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE identity_documents; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.identity_documents IS 'A member''s identity document, encrypted in the uploader''s browser. We hold ciphertext and no key. Normally self-uploaded; an admin may upload on a member''s behalf and is deliberately NOT given a wrapped key for it.';


--
-- Name: COLUMN identity_documents.file; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.identity_documents.file IS 'directus_files row holding the CIPHERTEXT. Lives in the private identity folder; served only through /kscw/identity/*, never via /assets.';


--
-- Name: COLUMN identity_documents.uploaded_by_self; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.identity_documents.uploaded_by_self IS 'false = an admin uploaded it for this member. They are not a recipient and cannot read it back.';


--
-- Name: identity_documents_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.identity_documents_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: identity_documents_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.identity_documents_id_seq OWNED BY public.identity_documents.id;


--
-- Name: kscw_migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.kscw_migrations (
    filename text NOT NULL,
    sha256 text NOT NULL,
    applied_at timestamp with time zone DEFAULT now() NOT NULL,
    applied_by text DEFAULT CURRENT_USER NOT NULL
);


--
-- Name: member_teams; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.member_teams (
    id integer NOT NULL,
    season character varying(255) DEFAULT NULL::character varying,
    guest_level integer DEFAULT 0,
    member integer NOT NULL,
    team integer NOT NULL,
    date_created timestamp with time zone,
    date_updated timestamp with time zone
);


--
-- Name: member_teams_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.member_teams_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: member_teams_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.member_teams_id_seq OWNED BY public.member_teams.id;


--
-- Name: members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.members (
    id integer NOT NULL,
    email character varying(255) DEFAULT NULL::character varying NOT NULL,
    first_name character varying(255) DEFAULT NULL::character varying,
    last_name character varying(255) DEFAULT NULL::character varying,
    phone character varying(255) DEFAULT NULL::character varying,
    license_nr character varying(255) DEFAULT NULL::character varying,
    number integer,
    "position" jsonb,
    photo uuid,
    role jsonb,
    kscw_membership_active boolean DEFAULT true NOT NULL,
    birthdate date,
    coach_approved_team boolean DEFAULT false NOT NULL,
    language character varying(255) DEFAULT 'german'::character varying,
    hide_phone boolean DEFAULT false NOT NULL,
    birthdate_visibility character varying(255) DEFAULT 'hidden'::character varying,
    website_visible boolean DEFAULT false NOT NULL,
    wiedisync_active boolean DEFAULT false NOT NULL,
    shell boolean DEFAULT false NOT NULL,
    shell_expires timestamp with time zone,
    shell_reminder_sent boolean DEFAULT false NOT NULL,
    requested_team integer,
    "user" uuid,
    date_created timestamp with time zone,
    date_updated timestamp with time zone,
    is_spielplaner boolean DEFAULT false NOT NULL,
    adresse character varying(255),
    plz character varying(10),
    ort character varying(100),
    nationalitaet character varying(100),
    anrede character varying(10),
    ahv_nummer character varying(20),
    beitragskategorie character varying(100),
    licence_category character varying(50),
    licence_activated boolean,
    licence_validated boolean,
    vm_email character varying(255),
    sex character varying(10),
    communications_team_chat_enabled boolean DEFAULT false NOT NULL,
    communications_dm_enabled boolean DEFAULT false NOT NULL,
    communications_banned boolean DEFAULT false NOT NULL,
    push_preview_content boolean DEFAULT false NOT NULL,
    last_online_at timestamp with time zone,
    consent_prompted_at timestamp with time zone,
    consent_decision character varying(255) DEFAULT 'pending'::character varying NOT NULL,
    last_export_at timestamp with time zone,
    hide_email boolean DEFAULT false NOT NULL,
    scorer_vb boolean DEFAULT false NOT NULL,
    referee_vb boolean DEFAULT false NOT NULL,
    otr1_bb boolean DEFAULT false NOT NULL,
    otr2_bb boolean DEFAULT false NOT NULL,
    otn_bb boolean DEFAULT false NOT NULL,
    referee_bb boolean DEFAULT false NOT NULL,
    auto_confirm_trainings boolean DEFAULT false NOT NULL,
    auto_confirm_games boolean DEFAULT false NOT NULL,
    auto_confirm_events boolean DEFAULT false NOT NULL,
    website_name_private boolean DEFAULT true NOT NULL,
    iban character varying(34),
    ical_token character varying(64),
    billing_different boolean DEFAULT false NOT NULL,
    billing_name character varying(255),
    billing_email character varying(255),
    billing_address character varying(255),
    billing_plz character varying(10),
    billing_ort character varying(100),
    billing_phone character varying(255),
    sektion character varying(32),
    billing_iban character varying(34),
    iban_confirmed boolean DEFAULT false NOT NULL,
    never_dun boolean DEFAULT false NOT NULL,
    email_notify_registrations boolean DEFAULT true NOT NULL,
    email_notify_join_requests boolean DEFAULT true NOT NULL,
    email_notify_form_submissions boolean DEFAULT true NOT NULL,
    email_notify_announcements boolean DEFAULT true NOT NULL,
    email_notify_events boolean DEFAULT true NOT NULL,
    clubdesk_id character varying(64),
    clubdesk_push_pending boolean DEFAULT false NOT NULL,
    clubdesk_push_changes jsonb,
    clubdesk_pushed_at timestamp with time zone,
    uuid uuid DEFAULT gen_random_uuid() NOT NULL,
    clubdesk_sync_exclude boolean DEFAULT false NOT NULL,
    js_id character varying(32),
    e2ee_public_key text,
    e2ee_private_key text,
    e2ee_kdf_salt text,
    e2ee_key_created timestamp with time zone,
    nickname text,
    nationalitaet_codes character varying(200),
    federation_of_origin character varying(8),
    otn1_bb boolean DEFAULT false NOT NULL,
    otn2_bb boolean DEFAULT false NOT NULL,
    transfer_status character varying(16),
    transfer_done_at timestamp with time zone,
    transfer_done_by_name text,
    transfer_note text,
    in_vis boolean,
    in_vis_checked_at timestamp with time zone,
    vis_player_no integer,
    CONSTRAINT members_federation_of_origin_fmt CHECK (((federation_of_origin IS NULL) OR ((federation_of_origin)::text = 'NONE'::text) OR ((federation_of_origin)::text ~ '^[A-Z]{2}$'::text))),
    CONSTRAINT members_license_nr_fmt CHECK (((license_nr IS NULL) OR (((license_nr)::text ~ '^[0-9]+$'::text) AND ((license_nr)::text <> '0'::text)))),
    CONSTRAINT members_nationalitaet_codes_fmt CHECK (((nationalitaet_codes IS NULL) OR ((nationalitaet_codes)::text ~ '^[A-Z]{2}(,[A-Z]{2})*$'::text))),
    CONSTRAINT members_role_values_valid CHECK ((role <@ '["user", "admin", "superuser", "vb_admin", "bb_admin", "vorstand", "website_admin", "finance"]'::jsonb)),
    CONSTRAINT members_transfer_status_chk CHECK (((transfer_status IS NULL) OR ((transfer_status)::text = ANY ((ARRAY['pending'::character varying, 'done'::character varying])::text[]))))
);


--
-- Name: COLUMN members.license_nr; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.members.license_nr IS 'Swiss Volley / Basketplan licence number as a STRING — leading zeros are significant (e.g. 038514). Exact join key for VM sync, scorer rosters and the Basketplan people join; partial-unique since migration 248. NOTE the spelling split, frozen by decision (DB review 2026-07-27): this column is US "license", the licence_* trio is UK — renaming either side would churn every sync and export for zero behavior.';


--
-- Name: COLUMN members.coach_approved_team; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.members.coach_approved_team IS 'Set once a coach approved the join request (requested_team flow).';


--
-- Name: COLUMN members.wiedisync_active; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.members.wiedisync_active IS 'Member has an activated wiedisync account (distinct from kscw_membership_active, the club-register status).';


--
-- Name: COLUMN members.shell; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.members.shell IS 'Shell member: pre-created by an invite, not yet self-registered. trg_members_shell_convert flips the lifecycle on first login.';


--
-- Name: COLUMN members.shell_expires; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.members.shell_expires IS 'When an unclaimed shell invite lapses (reminder handled by shell_reminder_sent).';


--
-- Name: COLUMN members.requested_team; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.members.requested_team IS 'Join-team picker choice awaiting coach approval; FK to teams since migration 248.';


--
-- Name: COLUMN members.nationalitaet; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.members.nationalitaet IS 'DERIVED — German display name of the first code in nationalitaet_codes. Kept because the ClubDesk push/drift/echo path reads it. Maintained by trigger members_sync_nationality_trg; do not write it directly.';


--
-- Name: COLUMN members.beitragskategorie; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.members.beitragskategorie IS 'ClubDesk fee category (German picklist value, ClubDesk-owned; synced down, never derived here).';


--
-- Name: COLUMN members.licence_category; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.members.licence_category IS 'VM-synced licence category (weekly vm-sync-check write-back). UK spelling — see license_nr for the frozen spelling split.';


--
-- Name: COLUMN members.licence_activated; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.members.licence_activated IS 'VM-synced flag (set-true-only since 2026-07-17 — VM is a subset of ClubDesk; nothing auto-clears).';


--
-- Name: COLUMN members.licence_validated; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.members.licence_validated IS 'VM-synced flag (set-true-only, like licence_activated).';


--
-- Name: COLUMN members.vm_email; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.members.vm_email IS 'Volleymanager account email — fallback VM join key when license_nr is absent. Partial-unique since migration 248.';


--
-- Name: COLUMN members.last_online_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.members.last_online_at IS 'Presence timestamp for the admin Explorer ("Last online"). Written by the auth.login hook on every login; coarse by design — refresh-token sessions only touch it at real logins.';


--
-- Name: COLUMN members.consent_decision; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.members.consent_decision IS 'Messaging consent state (pending/accepted/declined) — gates chat features, prompted at first login.';


--
-- Name: COLUMN members.last_export_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.members.last_export_at IS 'Messaging export rate-limit marker (1/day) — messaging-helpers, not a sync column.';


--
-- Name: COLUMN members.hide_email; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.members.hide_email IS 'When true, the member''s email is nulled in members.items.read for everyone except admins and the member themselves (mirrors hide_phone). Enforced by the kscw-hooks Member Privacy filter.';


--
-- Name: COLUMN members.scorer_vb; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.members.scorer_vb IS 'Has the volleyball scorer (Schreiber) licence. Sourced from sv_vm_check + ClubDesk Volleyball Lizenz.';


--
-- Name: COLUMN members.referee_vb; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.members.referee_vb IS 'Has the volleyball referee licence.';


--
-- Name: COLUMN members.otr1_bb; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.members.otr1_bb IS 'Basketball OTR1 (table official tier 1). Sourced from ClubDesk Offizielle Lizenz.';


--
-- Name: COLUMN members.otr2_bb; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.members.otr2_bb IS 'Basketball OTR2 (table official tier 2). Sourced from ClubDesk Offizielle Lizenz.';


--
-- Name: COLUMN members.otn_bb; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.members.otn_bb IS 'Basketball OTN, COARSE (holds some OTN level) — this is all ClubDesk''s Offizielle Lizenz string can express. Prefer otn1_bb / otn2_bb, which Basketplan fills precisely. Kept because scorer eligibility, deriveOffiziellenLizenz and the migration 066 view still read it.';


--
-- Name: COLUMN members.referee_bb; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.members.referee_bb IS 'Basketball referee licence.';


--
-- Name: COLUMN members.auto_confirm_trainings; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.members.auto_confirm_trainings IS 'When true, this member is auto-confirmed on every new training of their teams (OR-ed with teams.features_enabled.training_auto_confirm). Flipping on backfills existing upcoming trainings. Never overrides a manual answer or an absence-decline.';


--
-- Name: COLUMN members.auto_confirm_games; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.members.auto_confirm_games IS 'When true, this member is auto-confirmed on every new game of their teams (OR-ed with teams.features_enabled.game_auto_confirm). Guests (guest_level > 0) are still excluded by trg_participations_guest_block.';


--
-- Name: COLUMN members.auto_confirm_events; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.members.auto_confirm_events IS 'When true, this member is auto-confirmed on every new event they are eligible for (invited team / individual invite / club-wide), whole-event mode only. No team-level equivalent exists for events.';


--
-- Name: COLUMN members.website_name_private; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.members.website_name_private IS 'When true, the member''s public website roster entry shows the surname as an initial only ("Anna M.") and hides the year of birth. Website-scoped only — internal app shows full names. Enforced server-side in the /public/team/:id endpoint and the kscw-hooks Member Privacy filter (anonymous callers).';


--
-- Name: COLUMN members.iban; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.members.iban IS 'Member bank account IBAN (ISO 13616, max 34 chars), stored without spaces. Sensitive financial PII — scoped own-member + admin only in setup-permissions.mjs, like ahv_nummer; never exposed to other members or coaches. Used for expense reimbursements.';


--
-- Name: COLUMN members.ical_token; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.members.ical_token IS 'Per-member calendar-feed token (unique). Rotating it invalidates the member''s calendar subscription.';


--
-- Name: COLUMN members.billing_different; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.members.billing_different IS 'When true, the EXPENSE-PAYOUT QR snapshot pays out to the billing_* contact (IBAN/name/address) instead of the member''s own. NOT consulted by native invoices or dues runs — those stamp the member''s own name/email (see finance_billing_contacts + invoice recipient_* for that path).';


--
-- Name: COLUMN members.sektion; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.members.sektion IS 'ClubDesk Sektion (Volleyball / Basketball / KSCW) — the member''s sport division. Synced from clubdesk_export by import-clubdesk-csv.mjs; ClubDesk-authoritative (always updated).';


--
-- Name: COLUMN members.billing_iban; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.members.billing_iban IS 'IBAN of the alternate billing contact (guardian/company). Used for pay-outs when billing_different = true. Finance-editable.';


--
-- Name: COLUMN members.iban_confirmed; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.members.iban_confirmed IS 'Member has verified their own reimbursement IBAN (members.iban). False for ClubDesk-backfilled IBANs until the member confirms on the My-finances card.';


--
-- Name: COLUMN members.never_dun; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.members.never_dun IS 'Finance: exclude this member from dunning runs entirely.';


--
-- Name: COLUMN members.clubdesk_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.members.clubdesk_id IS 'ClubDesk [Id] — the CSV-import record identity for sync-up rows. NOT Filtern-searchable in the ClubDesk UI (use members.uuid there). Fill-only from sync-down.';


--
-- Name: COLUMN members.clubdesk_push_pending; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.members.clubdesk_push_pending IS 'ClubDesk sync-up dispatcher flag: member has un-pushed field changes.';


--
-- Name: COLUMN members.clubdesk_push_changes; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.members.clubdesk_push_changes IS 'Coded field diff awaiting ClubDesk sync-up (rendered per-locale at read time — values travel as codes).';


--
-- Name: COLUMN members.clubdesk_pushed_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.members.clubdesk_pushed_at IS 'Timestamp of the last ClubDesk sync-up covering this member.';


--
-- Name: COLUMN members.uuid; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.members.uuid IS 'Wiedisync ID — the stable round-trip key for ClubDesk contact matching (Filtern box) and exports. Never re-issued.';


--
-- Name: COLUMN members.clubdesk_sync_exclude; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.members.clubdesk_sync_exclude IS 'Opt this member out of the ClubDesk two-way sync entirely.';


--
-- Name: COLUMN members.js_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.members.js_id IS 'J+S / BASPO Personennummer (SALTO). ClubDesk-owned, down-sync fill-only. Surfaced only through the gated /kscw/js-export endpoint, never the items API.';


--
-- Name: COLUMN members.e2ee_public_key; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.members.e2ee_public_key IS 'ECDH P-256 public key (SPKI, base64). Public by design — others wrap content keys to it.';


--
-- Name: COLUMN members.e2ee_private_key; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.members.e2ee_private_key IS 'The member''s private key, encrypted under PBKDF2(login password). We CANNOT open this. Stored only so a new device can bootstrap with one password prompt.';


--
-- Name: COLUMN members.e2ee_kdf_salt; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.members.e2ee_kdf_salt IS 'PBKDF2 salt (base64) for the private-key wrapper. Not a secret.';


--
-- Name: COLUMN members.e2ee_key_created; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.members.e2ee_key_created IS 'When the current keypair was created. A new keypair orphans every document wrapped to the old one — that is why a password reset means "re-upload your ID".';


--
-- Name: COLUMN members.nickname; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.members.nickname IS 'Preferred display name shown instead of first_name across the app UI (e.g. "Honza" for Jan Cerny). NULL/empty = fall back to first_name. Legal/official surfaces (match sheets, VM, ClubDesk, invoices, public website) always use first_name.';


--
-- Name: COLUMN members.nationalitaet_codes; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.members.nationalitaet_codes IS 'Canonical nationality: ordered, comma-separated ISO 3166-1 alpha-2 codes ("CH,IT"). The FIRST code is primary and is what members.nationalitaet mirrors for ClubDesk (whose field is single-valued).';


--
-- Name: COLUMN members.federation_of_origin; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.members.federation_of_origin IS 'National federation that FIRST licensed the member (their federation of origin — NOT the most recent one). ISO 3166-1 alpha-2, or ''NONE'' = has never held a licence with any federation, or NULL = not answered.';


--
-- Name: COLUMN members.otn1_bb; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.members.otn1_bb IS 'Basketball OTN 1 (national table official, level 1). Authoritative source is Basketplan (nationalTableReferee1). ClubDesk cannot distinguish OTN levels, so its down-sync must never clear this.';


--
-- Name: COLUMN members.otn2_bb; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.members.otn2_bb IS 'Basketball OTN 2 (national table official, level 2). Authoritative source is Basketplan (nationalTableReferee2). ClubDesk cannot distinguish OTN levels, so its down-sync must never clear this.';


--
-- Name: COLUMN members.transfer_status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.members.transfer_status IS 'International-transfer WORK state: NULL = not reviewed, ''pending'' = being chased, ''done'' = cleared. Whether a transfer is needed at all is derived from federation_of_origin (''NONE'' or ''CH'' = not needed), never stored here.';


--
-- Name: COLUMN members.transfer_done_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.members.transfer_done_at IS 'When transfer_status last became ''done''. Cleared when the status moves away from done, so it can never describe a state the row is no longer in.';


--
-- Name: COLUMN members.transfer_done_by_name; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.members.transfer_done_by_name IS 'Display name of the staff member who marked the transfer done — the domain-level "who signed this off", alongside the automatic directus_activity trail.';


--
-- Name: COLUMN members.transfer_note; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.members.transfer_note IS 'Free-text staff note on the federation-transfer workflow (see transfer_status).';


--
-- Name: COLUMN members.in_vis; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.members.in_vis IS 'Found in the VIS player roster of their federation of origin — including CH, checked against Swiss Volley''s own index (VIS fed 189/SUI). NULL = not checked yet (guests and federation_of_origin = NONE are never checked). false = no evidence they were licensed there — treat as a lead, not a fact: name matching is fuzzy and federation_of_origin is often a seed from nationality. For a CH-origin member a false blocks nothing, since no international transfer applies to them.';


--
-- Name: COLUMN members.in_vis_checked_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.members.in_vis_checked_at IS 'When the monthly VIS player-check last touched this member (see in_vis for what the VIS index does and does not mean).';


--
-- Name: COLUMN members.vis_player_no; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.members.vis_player_no IS 'FIVB VIS player number, captured when a match is found. The key for a deep link into the VIS transfers app.';


--
-- Name: members_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.members_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: members_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.members_id_seq OWNED BY public.members.id;


--
-- Name: message_reactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.message_reactions (
    id uuid NOT NULL,
    message uuid NOT NULL,
    member integer NOT NULL,
    emoji character varying(8) DEFAULT NULL::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: message_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.message_requests (
    id uuid NOT NULL,
    conversation uuid NOT NULL,
    sender integer NOT NULL,
    recipient integer NOT NULL,
    status character varying(255) DEFAULT 'pending'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    resolved_at timestamp with time zone
);


--
-- Name: messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.messages (
    id uuid NOT NULL,
    conversation uuid NOT NULL,
    sender integer NOT NULL,
    type character varying(255) DEFAULT 'text'::character varying NOT NULL,
    body text,
    poll integer,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    edited_at timestamp with time zone,
    deleted_at timestamp with time zone,
    original_body text
);


--
-- Name: news; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.news (
    id integer NOT NULL,
    title character varying(255),
    title_en character varying(255),
    slug character varying(255),
    excerpt text,
    body text,
    category character varying(50),
    author character varying(255),
    published_at timestamp with time zone,
    is_published boolean DEFAULT false,
    image uuid,
    date_created timestamp with time zone,
    date_updated timestamp with time zone
);


--
-- Name: news_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.news_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: news_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.news_id_seq OWNED BY public.news.id;


--
-- Name: newsletter_subscribers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.newsletter_subscribers (
    id integer NOT NULL,
    email character varying(255) NOT NULL,
    locale character varying(2) DEFAULT 'de'::character varying,
    categories json DEFAULT '["volleyball","basketball","club"]'::json,
    verified boolean DEFAULT false,
    verify_token character varying(255),
    unsubscribe_token character varying(255)
);


--
-- Name: newsletter_subscribers_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.newsletter_subscribers_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: newsletter_subscribers_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.newsletter_subscribers_id_seq OWNED BY public.newsletter_subscribers.id;


--
-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notifications (
    id integer NOT NULL,
    type character varying(255) DEFAULT NULL::character varying,
    title character varying(255) DEFAULT NULL::character varying,
    body text,
    activity_type character varying(255) DEFAULT NULL::character varying,
    activity_id character varying(255) DEFAULT NULL::character varying,
    read boolean DEFAULT false NOT NULL,
    member integer,
    team integer,
    date_created timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    date_updated timestamp with time zone
);


--
-- Name: notifications_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.notifications_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: notifications_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.notifications_id_seq OWNED BY public.notifications.id;


--
-- Name: participations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.participations (
    id integer NOT NULL,
    activity_type character varying(255) DEFAULT NULL::character varying,
    activity_id character varying(255) DEFAULT NULL::character varying,
    status character varying(255) DEFAULT NULL::character varying,
    note text,
    session_id character varying(255) DEFAULT NULL::character varying,
    guest_count integer DEFAULT 0,
    is_staff boolean DEFAULT false NOT NULL,
    waitlisted_at timestamp with time zone,
    member integer,
    date_created timestamp with time zone,
    date_updated timestamp with time zone,
    position_1 character varying(255),
    position_2 character varying(255),
    position_3 character varying(255),
    auto_declined_by integer,
    last_status_edited_by uuid,
    last_status_edited_at timestamp with time zone,
    last_note_edited_by uuid,
    last_note_edited_at timestamp with time zone,
    auto_declined_by_game integer,
    CONSTRAINT participations_activity_type_chk CHECK (((activity_type)::text = ANY ((ARRAY['training'::character varying, 'game'::character varying, 'event'::character varying])::text[]))),
    CONSTRAINT participations_status_chk CHECK (((status)::text = ANY ((ARRAY['confirmed'::character varying, 'declined'::character varying, 'tentative'::character varying, 'waitlisted'::character varying])::text[])))
);


--
-- Name: COLUMN participations.last_status_edited_by; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.participations.last_status_edited_by IS 'directus_users.id of the writer who last set/changed `status` — set by kscw-hooks filter when `status` is in the create/update payload. Null for system-context writes.';


--
-- Name: COLUMN participations.last_status_edited_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.participations.last_status_edited_at IS 'Wall-clock of the last `status` write by an authenticated session.';


--
-- Name: COLUMN participations.last_note_edited_by; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.participations.last_note_edited_by IS 'directus_users.id of the writer who last set/changed `note` — set by kscw-hooks filter when `note` is in the create/update payload. Null for system-context writes.';


--
-- Name: COLUMN participations.last_note_edited_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.participations.last_note_edited_at IS 'Wall-clock of the last `note` write by an authenticated session.';


--
-- Name: participations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.participations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: participations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.participations_id_seq OWNED BY public.participations.id;


--
-- Name: password_reset_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.password_reset_tokens (
    id integer NOT NULL,
    "user" uuid NOT NULL,
    token_hash text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: password_reset_tokens_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.password_reset_tokens_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: password_reset_tokens_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.password_reset_tokens_id_seq OWNED BY public.password_reset_tokens.id;


--
-- Name: poll_votes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.poll_votes (
    id integer NOT NULL,
    selected_options json,
    poll integer,
    member integer,
    date_created timestamp with time zone,
    date_updated timestamp with time zone
);


--
-- Name: poll_votes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.poll_votes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: poll_votes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.poll_votes_id_seq OWNED BY public.poll_votes.id;


--
-- Name: polls; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.polls (
    id integer NOT NULL,
    question character varying(255) DEFAULT NULL::character varying,
    options json,
    mode character varying(255) DEFAULT NULL::character varying,
    deadline timestamp with time zone,
    status character varying(255) DEFAULT NULL::character varying,
    anonymous boolean DEFAULT false NOT NULL,
    team integer,
    created_by integer,
    date_created timestamp with time zone,
    date_updated timestamp with time zone,
    conversation uuid,
    results_visible boolean DEFAULT false NOT NULL,
    CONSTRAINT chk_polls_team_or_conversation CHECK (((team IS NOT NULL) OR (conversation IS NOT NULL)))
);


--
-- Name: polls_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.polls_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: polls_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.polls_id_seq OWNED BY public.polls.id;


--
-- Name: public_stats; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.public_stats (
    id character varying(255) NOT NULL,
    value integer,
    date_updated timestamp with time zone
);


--
-- Name: push_subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.push_subscriptions (
    id integer NOT NULL,
    endpoint text,
    keys_p256dh character varying(255) DEFAULT NULL::character varying,
    keys_auth character varying(255) DEFAULT NULL::character varying,
    member integer,
    date_created timestamp with time zone,
    date_updated timestamp with time zone
);


--
-- Name: push_subscriptions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.push_subscriptions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: push_subscriptions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.push_subscriptions_id_seq OWNED BY public.push_subscriptions.id;


--
-- Name: rankings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rankings (
    id integer NOT NULL,
    team_id character varying(255) DEFAULT NULL::character varying,
    team_name character varying(255) DEFAULT NULL::character varying,
    league character varying(255) DEFAULT NULL::character varying,
    rank integer,
    played integer,
    won integer,
    lost integer,
    wins_clear integer,
    wins_narrow integer,
    defeats_clear integer,
    defeats_narrow integer,
    sets_won integer,
    sets_lost integer,
    points_won integer,
    points_lost integer,
    points integer,
    season character varying(255) DEFAULT NULL::character varying,
    updated_at timestamp with time zone,
    team integer,
    date_created timestamp with time zone,
    date_updated timestamp with time zone
);


--
-- Name: rankings_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.rankings_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: rankings_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.rankings_id_seq OWNED BY public.rankings.id;


--
-- Name: referee_expenses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.referee_expenses (
    id integer NOT NULL,
    paid_by_other character varying(255) DEFAULT NULL::character varying,
    amount numeric(10,2),
    notes text,
    game integer,
    team integer,
    paid_by_member integer,
    recorded_by integer,
    date_created timestamp with time zone,
    date_updated timestamp with time zone,
    currency character varying(3) DEFAULT 'CHF'::character varying NOT NULL
);


--
-- Name: referee_expenses_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.referee_expenses_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: referee_expenses_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.referee_expenses_id_seq OWNED BY public.referee_expenses.id;


--
-- Name: registrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.registrations (
    id integer NOT NULL,
    status character varying(255) DEFAULT 'pending'::character varying,
    membership_type character varying(255),
    anrede character varying(255),
    vorname character varying(255),
    nachname character varying(255),
    email character varying(255),
    telefon_mobil character varying(255),
    adresse character varying(255),
    plz character varying(255),
    ort character varying(255),
    geburtsdatum date,
    nationalitaet character varying(255),
    geschlecht character varying(255),
    ahv_nummer character varying(255),
    team character varying(255),
    beitragskategorie character varying(255),
    kantonsschule character varying(255),
    rolle character varying(255),
    bemerkungen text,
    id_upload_front uuid,
    id_upload_back uuid,
    submitted_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    approved_at timestamp with time zone,
    approved_by character varying(255),
    reference_number character varying(255),
    lizenz character varying(255),
    schiedsrichter_stufe character varying(255),
    bb_doc_lizenz uuid,
    bb_doc_selfdecl uuid,
    bb_doc_natdecl uuid,
    locale character varying(5) DEFAULT 'de'::character varying,
    rejection_reason text,
    nationalitaet_code character varying(2),
    sektion_choice character varying(32),
    iban character varying(34),
    member integer,
    bb_situation character varying(32),
    bb_doc_freibrief uuid,
    bb_doc_u18parents uuid,
    bb_doc_schoolcert uuid,
    nationalitaet_codes character varying(200),
    federation_of_origin character varying(8),
    bb_recent_licence character varying(4),
    CONSTRAINT registrations_bb_recent_licence_check CHECK (((bb_recent_licence IS NULL) OR ((bb_recent_licence)::text = ANY ((ARRAY['ja'::character varying, 'nein'::character varying])::text[])))),
    CONSTRAINT registrations_federation_of_origin_fmt CHECK (((federation_of_origin IS NULL) OR ((federation_of_origin)::text = 'NONE'::text) OR ((federation_of_origin)::text ~ '^[A-Z]{2}$'::text))),
    CONSTRAINT registrations_nationalitaet_codes_fmt CHECK (((nationalitaet_codes IS NULL) OR ((nationalitaet_codes)::text ~ '^[A-Z]{2}(,[A-Z]{2})*$'::text)))
);


--
-- Name: COLUMN registrations.nationalitaet_codes; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.registrations.nationalitaet_codes IS 'Ordered, comma-separated ISO 3166-1 alpha-2 codes from the public form. nationalitaet_code (singular, migration 161) stays as the primary/first code so the BB required-document gate keeps working unchanged.';


--
-- Name: COLUMN registrations.federation_of_origin; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.registrations.federation_of_origin IS 'Federation of origin from the public form: the federation that FIRST licensed the applicant. ISO alpha-2, ''NONE'' (never licensed before), or NULL (not answered).';


--
-- Name: COLUMN registrations.bb_recent_licence; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.registrations.bb_recent_licence IS 'Basketball transfer_ch only: did the applicant hold a Swiss Basketball licence in the last two seasons? ja/nein, NULL = not asked. Only ''nein'' waives the Freibrief (see bb-docs.js bbFreibriefWaived).';


--
-- Name: registrations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.registrations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: registrations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.registrations_id_seq OWNED BY public.registrations.id;


--
-- Name: reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reports (
    id uuid NOT NULL,
    reporter integer,
    reported_member integer,
    message uuid,
    conversation uuid,
    reason character varying(255) DEFAULT NULL::character varying NOT NULL,
    note text,
    message_snapshot text,
    status character varying(255) DEFAULT 'open'::character varying NOT NULL,
    resolved_by integer,
    resolved_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: scheduling_blocks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.scheduling_blocks (
    id integer NOT NULL,
    team integer NOT NULL,
    start_date date NOT NULL,
    end_date date NOT NULL,
    reason text,
    created_by integer,
    date_created timestamp with time zone DEFAULT now() NOT NULL,
    date_updated timestamp with time zone DEFAULT now() NOT NULL,
    user_created uuid,
    user_updated uuid,
    CONSTRAINT scheduling_blocks_dates_check CHECK ((end_date >= start_date))
);


--
-- Name: TABLE scheduling_blocks; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.scheduling_blocks IS 'Team-level game-scheduling blackouts (Team blocking). A row hard-blocks game scheduling for `team` on every date in [start_date, end_date] — home-slot offering AND all three away proposals — exactly like a team event, but coach/TR-managed with no RSVP/chat. Created via the app by coaches/TRs (scoped in setup-permissions.mjs + enforced in the kscw-hooks create filter).';


--
-- Name: COLUMN scheduling_blocks.reason; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.scheduling_blocks.reason IS 'Optional free text shown to schedulers / on the team absence calendar (e.g. "Exam period", "League closure", "Tournament prep").';


--
-- Name: COLUMN scheduling_blocks.created_by; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.scheduling_blocks.created_by IS 'Member (coach/TR) who created the block. Stamped by the kscw-hooks create filter from accountability.user.';


--
-- Name: scheduling_blocks_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.scheduling_blocks_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: scheduling_blocks_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.scheduling_blocks_id_seq OWNED BY public.scheduling_blocks.id;


--
-- Name: scheduling_email_reads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.scheduling_email_reads (
    id integer NOT NULL,
    email integer NOT NULL,
    member integer NOT NULL,
    read_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE scheduling_email_reads; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.scheduling_email_reads IS 'Per-user read state (migration 222), for mailbox accounts where several people read independently — currently only the admin account. The Spielplanung accounts keep the global scheduling_emails.read_at marker instead (one shared desk, one shared read state). A row means "this member has opened this message".';


--
-- Name: scheduling_email_reads_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.scheduling_email_reads_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: scheduling_email_reads_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.scheduling_email_reads_id_seq OWNED BY public.scheduling_email_reads.id;


--
-- Name: scheduling_emails; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.scheduling_emails (
    id integer NOT NULL,
    message_id text NOT NULL,
    in_reply_to text,
    references_ids text,
    direction character varying(8) DEFAULT 'in'::character varying NOT NULL,
    folder character varying(64),
    imap_uid integer,
    from_address text,
    from_name text,
    to_addresses text,
    cc_addresses text,
    subject text,
    body_text text,
    body_html text,
    has_attachments boolean DEFAULT false NOT NULL,
    attachments jsonb,
    date_sent timestamp with time zone,
    read_at timestamp with time zone,
    date_created timestamp with time zone DEFAULT now() NOT NULL,
    assigned_opponent integer,
    account character varying(16) DEFAULT 'volleyball'::character varying NOT NULL,
    group_reposted_at timestamp with time zone,
    CONSTRAINT scheduling_emails_account_check CHECK (((account)::text = ANY ((ARRAY['volleyball'::character varying, 'basketball'::character varying, 'admin'::character varying, 'vis_transfers'::character varying])::text[]))),
    CONSTRAINT scheduling_emails_direction_check CHECK (((direction)::text = ANY (ARRAY[('in'::character varying)::text, ('out'::character varying)::text])))
);


--
-- Name: TABLE scheduling_emails; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.scheduling_emails IS 'Synced copy of the volleyball@spielplanung.kscw.ch Migadu mailbox (INBOX + Sent) plus dashboard-composed replies. Deduped by Message-ID. Opponent matching is computed at read time by address intersection with game_scheduling_opponents.contact_email. Managed only via the kscw scheduling-mailbox endpoints (knex, admin/spielplaner-gated).';


--
-- Name: COLUMN scheduling_emails.message_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.scheduling_emails.message_id IS 'RFC 5322 Message-ID without angle brackets; synthetic fallback when absent. Unique — the sync upserts ON CONFLICT DO NOTHING.';


--
-- Name: COLUMN scheduling_emails.imap_uid; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.scheduling_emails.imap_uid IS 'IMAP UID in `folder` at sync time. Used to stream attachment bytes on demand; can go stale after mailbox moves (the endpoint then returns 410 and a re-sync refreshes it).';


--
-- Name: COLUMN scheduling_emails.read_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.scheduling_emails.read_at IS 'Set when a spielplaner opens the message in the dashboard. Global marker (single shared mailbox), not per-user.';


--
-- Name: COLUMN scheduling_emails.assigned_opponent; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.scheduling_emails.assigned_opponent IS 'Manual override of the read-time opponent classification: the game_scheduling_opponents.id a spielplaner pinned this email chain to. Soft reference (no FK; opponents are recreated on resync). NULL = use auto-classification.';


--
-- Name: COLUMN scheduling_emails.account; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.scheduling_emails.account IS 'Mailbox partition (migrations 144/222/267): volleyball|basketball = the Spielplanung mailboxes at *@spielplanung.kscw.ch; admin = the club-admin mailbox at admin@wiedisync.kscw.ch; vis_transfers = the VIS transfer-letters mailbox at vis_transfers@mail.kscw.ch. Deduped per-account by UNIQUE (account, message_id). NB this is an account key, not a sport — the name predates the admin mailbox.';


--
-- Name: scheduling_emails_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.scheduling_emails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: scheduling_emails_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.scheduling_emails_id_seq OWNED BY public.scheduling_emails.id;


--
-- Name: scheduling_global_blocks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.scheduling_global_blocks (
    id integer NOT NULL,
    start_date date NOT NULL,
    end_date date NOT NULL,
    reason text,
    created_by integer,
    date_created timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT scheduling_global_blocks_dates_check CHECK ((end_date >= start_date))
);


--
-- Name: scheduling_global_blocks_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.scheduling_global_blocks_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: scheduling_global_blocks_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.scheduling_global_blocks_id_seq OWNED BY public.scheduling_global_blocks.id;


--
-- Name: scorer_course_attendance; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.scorer_course_attendance (
    id integer NOT NULL,
    sub_key character varying(255) NOT NULL,
    form_slug character varying(255) NOT NULL,
    submission_id character varying(255) NOT NULL,
    present boolean DEFAULT false NOT NULL,
    exam_sent boolean DEFAULT false NOT NULL,
    exam_passed boolean DEFAULT false NOT NULL,
    sv_license character varying(255),
    notes text,
    date_created timestamp with time zone,
    date_updated timestamp with time zone,
    exam_date date,
    exam_file uuid,
    exam_result character varying(255),
    exam_file_corrected uuid,
    exam_file_corrected_by character varying(255),
    exam_file_corrected_on timestamp with time zone
);


--
-- Name: scorer_course_attendance_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.scorer_course_attendance_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: scorer_course_attendance_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.scorer_course_attendance_id_seq OWNED BY public.scorer_course_attendance.id;


--
-- Name: scorer_courses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.scorer_courses (
    id integer NOT NULL,
    slug_id character varying(255) NOT NULL,
    active boolean DEFAULT true NOT NULL,
    title_de character varying(255) NOT NULL,
    title_en character varying(255) NOT NULL,
    date_iso date,
    "time" character varying(255),
    mode character varying(255) DEFAULT 'in_person'::character varying NOT NULL,
    sort integer DEFAULT 0,
    form_slug_de character varying(255),
    form_slug_en character varying(255),
    date_created timestamp with time zone,
    date_updated timestamp with time zone,
    location character varying(255),
    host_note character varying(255),
    duration_hours real,
    scorer_expert character varying(255),
    registration_closes timestamp with time zone
);


--
-- Name: scorer_courses_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.scorer_courses_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: scorer_courses_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.scorer_courses_id_seq OWNED BY public.scorer_courses.id;


--
-- Name: scorer_delegations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.scorer_delegations (
    id integer NOT NULL,
    role character varying(255) DEFAULT NULL::character varying,
    same_team boolean DEFAULT false NOT NULL,
    status character varying(255) DEFAULT NULL::character varying,
    game integer,
    from_member integer,
    to_member integer,
    from_team integer,
    to_team integer,
    date_created timestamp with time zone,
    date_updated timestamp with time zone
);


--
-- Name: scorer_delegations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.scorer_delegations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: scorer_delegations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.scorer_delegations_id_seq OWNED BY public.scorer_delegations.id;


--
-- Name: signup_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.signup_tokens (
    id integer NOT NULL,
    member integer NOT NULL,
    token_hash text NOT NULL,
    minted_by integer,
    minted_via character varying(20) DEFAULT 'staff'::character varying NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: signup_tokens_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.signup_tokens_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: signup_tokens_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.signup_tokens_id_seq OWNED BY public.signup_tokens.id;


--
-- Name: slot_claims; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.slot_claims (
    id integer NOT NULL,
    date date,
    start_time time without time zone,
    end_time time without time zone,
    freed_reason character varying(255) DEFAULT NULL::character varying,
    freed_source_id character varying(255) DEFAULT NULL::character varying,
    notes text,
    status character varying(255) DEFAULT NULL::character varying,
    hall_slot integer,
    hall integer,
    claimed_by_team integer,
    claimed_by_member integer,
    date_created timestamp with time zone,
    date_updated timestamp with time zone
);


--
-- Name: slot_claims_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.slot_claims_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: slot_claims_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.slot_claims_id_seq OWNED BY public.slot_claims.id;


--
-- Name: spielplaner_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.spielplaner_assignments (
    date_created timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_created uuid,
    member integer NOT NULL,
    kscw_team integer NOT NULL
);


--
-- Name: sponsors; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sponsors (
    id integer NOT NULL,
    name character varying(255) DEFAULT NULL::character varying NOT NULL,
    logo uuid,
    website_url character varying(255) DEFAULT NULL::character varying,
    sort_order integer DEFAULT 0,
    active boolean DEFAULT true NOT NULL,
    team_page_only boolean DEFAULT false NOT NULL,
    date_created timestamp with time zone,
    date_updated timestamp with time zone
);


--
-- Name: sponsors_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sponsors_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sponsors_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sponsors_id_seq OWNED BY public.sponsors.id;


--
-- Name: teams; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.teams (
    id integer NOT NULL,
    name character varying(255) DEFAULT NULL::character varying NOT NULL,
    full_name character varying(255) DEFAULT NULL::character varying,
    team_id character varying(255) DEFAULT NULL::character varying,
    sport character varying(255) DEFAULT NULL::character varying,
    league character varying(255) DEFAULT NULL::character varying,
    season character varying(255) DEFAULT NULL::character varying,
    color character varying(255) DEFAULT NULL::character varying,
    active boolean DEFAULT true NOT NULL,
    team_picture uuid,
    team_picture_pos character varying(255) DEFAULT NULL::character varying,
    social_url character varying(255) DEFAULT NULL::character varying,
    bb_source_id character varying(255) DEFAULT NULL::character varying,
    features_enabled json,
    date_created timestamp with time zone,
    date_updated timestamp with time zone,
    captain integer,
    open_for_players boolean DEFAULT false,
    facebook_url character varying(255) DEFAULT NULL::character varying,
    tiktok_url character varying(255) DEFAULT NULL::character varying,
    show_guests_on_website boolean DEFAULT true NOT NULL,
    dashboard_range_from date,
    dashboard_range_to date,
    dashboard_league_only boolean DEFAULT false NOT NULL,
    recruiting_positions jsonb,
    waitlist_url character varying(500),
    waitlist_label character varying(100),
    gender character varying(8),
    duty_credit integer DEFAULT 0 NOT NULL,
    clubdesk_group text,
    CONSTRAINT teams_gender_check CHECK (((gender IS NULL) OR ((gender)::text = ANY (ARRAY[('m'::character varying)::text, ('f'::character varying)::text, ('mixed'::character varying)::text])))),
    CONSTRAINT teams_season_format_check CHECK (((season IS NULL) OR ((season)::text ~ '^[0-9]{4}/[0-9]{2}$'::text)))
);


--
-- Name: COLUMN teams.dashboard_range_from; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.teams.dashboard_range_from IS 'Coach Dashboard "From" date (NULL = use rolling default of most recent 01-06 ≤ today)';


--
-- Name: COLUMN teams.dashboard_range_to; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.teams.dashboard_range_to IS 'Coach Dashboard "To" date (NULL = use today)';


--
-- Name: COLUMN teams.dashboard_league_only; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.teams.dashboard_league_only IS 'Coach Dashboard: exclude cup/tournament games from the games attendance count';


--
-- Name: COLUMN teams.recruiting_positions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.teams.recruiting_positions IS 'Positions the team is recruiting for (e.g. ["setter","middle"]). NULL/[] = open to all positions. Surfaced on the public team page when open_for_players=true.';


--
-- Name: COLUMN teams.duty_credit; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.teams.duty_credit IS 'Scorer-duty manual credit: duties this team is excused from (higher = fewer scorer/scoreboard assignments). Stacks on top of the automatic referee credit. Edited on the scorer-assignment page.';


--
-- Name: COLUMN teams.clubdesk_group; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.teams.clubdesk_group IS 'ClubDesk group token for this team (e.g. ''VB D1''). NULL = not configured yet (flagged by the ClubDesk group check); '''' = intentionally no ClubDesk group (league umbrella).';


--
-- Name: trainings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.trainings (
    id integer NOT NULL,
    date date,
    start_time time without time zone,
    end_time time without time zone,
    hall_name character varying(255) DEFAULT NULL::character varying,
    notes text,
    cancelled boolean DEFAULT false NOT NULL,
    cancel_reason text,
    respond_by timestamp with time zone,
    min_participants integer,
    max_participants integer,
    require_note_if_absent boolean DEFAULT false NOT NULL,
    auto_cancel_on_min boolean DEFAULT false NOT NULL,
    team integer,
    hall_slot integer,
    hall integer,
    date_created timestamp with time zone,
    date_updated timestamp with time zone,
    send_email_invite boolean DEFAULT false,
    auto_cancelled_by_closure integer,
    excluded_guest_levels jsonb DEFAULT '[]'::jsonb NOT NULL,
    auto_confirm_rsvp boolean,
    is_trial boolean DEFAULT false NOT NULL,
    auto_cancelled_by_trial integer,
    recruiting_positions jsonb,
    auto_shortened_by_game integer,
    original_end_time time without time zone
);


--
-- Name: COLUMN trainings.auto_confirm_rsvp; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.trainings.auto_confirm_rsvp IS 'NULL = inherit teams.features_enabled.training_auto_confirm. true/false = per-activity override.';


--
-- Name: COLUMN trainings.is_trial; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.trainings.is_trial IS 'When true, the training is a public trial training (Probetraining) — surfaced on the kscw-website team page next to the "Get in touch" CTA for teams with open_for_players=true.';


--
-- Name: COLUMN trainings.auto_cancelled_by_trial; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.trainings.auto_cancelled_by_trial IS 'When non-null, this training was auto-cancelled because trial training id=<this> exists for the same team+date. Cleared automatically by trg_trainings_clear_auto_cancel_marker when a user manually toggles `cancelled`.';


--
-- Name: COLUMN trainings.recruiting_positions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.trainings.recruiting_positions IS 'Trial trainings only: MemberPosition[] the team is recruiting for (e.g. ["setter","middle"]). NULL/[] = open to all positions. Surfaced on the public team page when open_for_players=true.';


--
-- Name: stats_club_overview; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.stats_club_overview WITH (security_invoker='true') AS
 SELECT ( SELECT count(*) AS count
           FROM public.members
          WHERE (members.wiedisync_active = true)) AS active_members,
    ( SELECT count(DISTINCT mt.member) AS count
           FROM ((public.member_teams mt
             JOIN public.teams t ON (((t.id = mt.team) AND (t.active = true) AND ((t.sport)::text = 'volleyball'::text))))
             JOIN public.members m ON (((m.id = mt.member) AND (m.wiedisync_active = true))))
          WHERE (mt.guest_level = 0)) AS vb_active_members,
    ( SELECT count(DISTINCT mt.member) AS count
           FROM ((public.member_teams mt
             JOIN public.teams t ON (((t.id = mt.team) AND (t.active = true) AND ((t.sport)::text = 'basketball'::text))))
             JOIN public.members m ON (((m.id = mt.member) AND (m.wiedisync_active = true))))
          WHERE (mt.guest_level = 0)) AS bb_active_members,
    ( SELECT count(DISTINCT mt.member) AS count
           FROM (public.member_teams mt
             JOIN public.teams t ON (((t.id = mt.team) AND (t.active = true) AND ((t.sport)::text = 'volleyball'::text))))
          WHERE (mt.guest_level = 0)) AS vb_total_members,
    ( SELECT count(DISTINCT mt.member) AS count
           FROM (public.member_teams mt
             JOIN public.teams t ON (((t.id = mt.team) AND (t.active = true) AND ((t.sport)::text = 'basketball'::text))))
          WHERE (mt.guest_level = 0)) AS bb_total_members,
    ( SELECT count(*) AS count
           FROM public.teams
          WHERE (teams.active = true)) AS active_teams,
    ( SELECT count(*) AS count
           FROM public.teams
          WHERE ((teams.active = true) AND ((teams.sport)::text = 'volleyball'::text))) AS vb_teams,
    ( SELECT count(*) AS count
           FROM public.teams
          WHERE ((teams.active = true) AND ((teams.sport)::text = 'basketball'::text))) AS bb_teams,
    ( SELECT count(*) AS count
           FROM public.games
          WHERE ((games.date >= CURRENT_DATE) AND ((games.status)::text = 'scheduled'::text))) AS upcoming_games,
    ( SELECT count(*) AS count
           FROM (public.games g
             JOIN public.teams t ON ((t.id = g.kscw_team)))
          WHERE ((g.date >= CURRENT_DATE) AND ((g.status)::text = 'scheduled'::text) AND ((t.sport)::text = 'volleyball'::text))) AS vb_upcoming_games,
    ( SELECT count(*) AS count
           FROM (public.games g
             JOIN public.teams t ON ((t.id = g.kscw_team)))
          WHERE ((g.date >= CURRENT_DATE) AND ((g.status)::text = 'scheduled'::text) AND ((t.sport)::text = 'basketball'::text))) AS bb_upcoming_games,
    ( SELECT count(*) AS count
           FROM public.games
          WHERE ((games.status)::text = 'completed'::text)) AS completed_games,
    ( SELECT count(*) AS count
           FROM (public.games g
             JOIN public.teams t ON ((t.id = g.kscw_team)))
          WHERE (((g.status)::text = 'completed'::text) AND ((t.sport)::text = 'volleyball'::text))) AS vb_completed_games,
    ( SELECT count(*) AS count
           FROM (public.games g
             JOIN public.teams t ON ((t.id = g.kscw_team)))
          WHERE (((g.status)::text = 'completed'::text) AND ((t.sport)::text = 'basketball'::text))) AS bb_completed_games,
    ( SELECT count(*) AS count
           FROM public.trainings
          WHERE ((trainings.date >= CURRENT_DATE) AND (trainings.cancelled = false))) AS upcoming_trainings,
    ( SELECT count(*) AS count
           FROM public.events
          WHERE (events.start_date >= now())) AS upcoming_events,
    ( SELECT count(DISTINCT m.id) AS count
           FROM ((public.member_teams mt
             JOIN public.teams t ON (((t.id = mt.team) AND (t.active = true) AND ((t.sport)::text = 'volleyball'::text))))
             JOIN public.members m ON ((m.id = mt.member)))
          WHERE ((mt.guest_level = 0) AND (m.shell = false) AND (m.wiedisync_active = true))) AS vb_registered,
    ( SELECT count(DISTINCT m.id) AS count
           FROM ((public.member_teams mt
             JOIN public.teams t ON (((t.id = mt.team) AND (t.active = true) AND ((t.sport)::text = 'basketball'::text))))
             JOIN public.members m ON ((m.id = mt.member)))
          WHERE ((mt.guest_level = 0) AND (m.shell = false) AND (m.wiedisync_active = true))) AS bb_registered,
    ( SELECT count(DISTINCT m.id) AS count
           FROM ((public.member_teams mt
             JOIN public.teams t ON (((t.id = mt.team) AND (t.active = true) AND ((t.sport)::text = 'volleyball'::text))))
             JOIN public.members m ON ((m.id = mt.member)))
          WHERE ((mt.guest_level = 0) AND (m.shell = true))) AS vb_shell,
    ( SELECT count(DISTINCT m.id) AS count
           FROM ((public.member_teams mt
             JOIN public.teams t ON (((t.id = mt.team) AND (t.active = true) AND ((t.sport)::text = 'basketball'::text))))
             JOIN public.members m ON ((m.id = mt.member)))
          WHERE ((mt.guest_level = 0) AND (m.shell = true))) AS bb_shell,
    ( SELECT count(DISTINCT m.id) AS count
           FROM ((public.member_teams mt
             JOIN public.teams t ON (((t.id = mt.team) AND (t.active = true) AND ((t.sport)::text = 'volleyball'::text))))
             JOIN public.members m ON ((m.id = mt.member)))
          WHERE ((mt.guest_level = 0) AND m.scorer_vb)) AS vb_lic_scorer,
    ( SELECT count(DISTINCT m.id) AS count
           FROM ((public.member_teams mt
             JOIN public.teams t ON (((t.id = mt.team) AND (t.active = true) AND ((t.sport)::text = 'volleyball'::text))))
             JOIN public.members m ON ((m.id = mt.member)))
          WHERE ((mt.guest_level = 0) AND m.referee_vb)) AS vb_lic_referee,
    ( SELECT count(DISTINCT m.id) AS count
           FROM ((public.member_teams mt
             JOIN public.teams t ON (((t.id = mt.team) AND (t.active = true) AND ((t.sport)::text = 'basketball'::text))))
             JOIN public.members m ON ((m.id = mt.member)))
          WHERE ((mt.guest_level = 0) AND m.otr1_bb)) AS bb_lic_otr1,
    ( SELECT count(DISTINCT m.id) AS count
           FROM ((public.member_teams mt
             JOIN public.teams t ON (((t.id = mt.team) AND (t.active = true) AND ((t.sport)::text = 'basketball'::text))))
             JOIN public.members m ON ((m.id = mt.member)))
          WHERE ((mt.guest_level = 0) AND m.otr2_bb)) AS bb_lic_otr2,
    ( SELECT count(DISTINCT m.id) AS count
           FROM ((public.member_teams mt
             JOIN public.teams t ON (((t.id = mt.team) AND (t.active = true) AND ((t.sport)::text = 'volleyball'::text))))
             JOIN public.members m ON ((m.id = mt.member)))
          WHERE ((mt.guest_level = 0) AND (m.role @> '"vorstand"'::jsonb))) AS vb_vorstand,
    ( SELECT count(DISTINCT m.id) AS count
           FROM ((public.member_teams mt
             JOIN public.teams t ON (((t.id = mt.team) AND (t.active = true) AND ((t.sport)::text = 'basketball'::text))))
             JOIN public.members m ON ((m.id = mt.member)))
          WHERE ((mt.guest_level = 0) AND (m.role @> '"vorstand"'::jsonb))) AS bb_vorstand,
    ( SELECT count(DISTINCT m.id) AS count
           FROM ((public.member_teams mt
             JOIN public.teams t ON (((t.id = mt.team) AND (t.active = true) AND ((t.sport)::text = 'volleyball'::text))))
             JOIN public.members m ON ((m.id = mt.member)))
          WHERE ((mt.guest_level = 0) AND ((m.role @> '"admin"'::jsonb) OR (m.role @> '"superuser"'::jsonb)))) AS vb_admins,
    ( SELECT count(DISTINCT m.id) AS count
           FROM ((public.member_teams mt
             JOIN public.teams t ON (((t.id = mt.team) AND (t.active = true) AND ((t.sport)::text = 'basketball'::text))))
             JOIN public.members m ON ((m.id = mt.member)))
          WHERE ((mt.guest_level = 0) AND ((m.role @> '"admin"'::jsonb) OR (m.role @> '"superuser"'::jsonb)))) AS bb_admins,
    ( SELECT count(*) AS count
           FROM public.games
          WHERE (((games.type)::text = 'home'::text) AND (games.date >= CURRENT_DATE) AND ((games.status)::text = 'scheduled'::text))) AS upcoming_home_games,
    ( SELECT count(*) AS count
           FROM (public.games g
             JOIN public.teams t ON ((t.id = g.kscw_team)))
          WHERE (((g.type)::text = 'home'::text) AND (g.date >= CURRENT_DATE) AND ((g.status)::text = 'scheduled'::text) AND ((((t.sport)::text = 'volleyball'::text) AND (g.scorer_member IS NULL) AND (g.scoreboard_member IS NULL) AND (g.scorer_scoreboard_member IS NULL)) OR (((t.sport)::text = 'basketball'::text) AND (g.bb_scorer_member IS NULL) AND (g.bb_timekeeper_member IS NULL) AND (g.bb_24s_official IS NULL))))) AS upcoming_home_games_no_schreiber;


--
-- Name: stats_delegations; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.stats_delegations WITH (security_invoker='true') AS
 SELECT t.id AS team_id,
    t.name AS team_name,
    t.sport,
    count(*) AS total_delegations,
    count(*) FILTER (WHERE ((sd.status)::text = 'accepted'::text)) AS accepted,
    count(*) FILTER (WHERE ((sd.status)::text = 'declined'::text)) AS declined_count,
    count(*) FILTER (WHERE ((sd.status)::text = 'pending'::text)) AS pending,
    count(*) FILTER (WHERE ((sd.status)::text = 'expired'::text)) AS expired,
    count(*) FILTER (WHERE (sd.same_team = true)) AS same_team_transfers,
    count(*) FILTER (WHERE (sd.same_team = false)) AS cross_team_transfers
   FROM (public.teams t
     JOIN public.scorer_delegations sd ON ((sd.from_team = t.id)))
  GROUP BY t.id, t.name, t.sport;


--
-- Name: stats_game_results; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.stats_game_results WITH (security_invoker='true') AS
 SELECT t.id AS team_id,
    t.name AS team_name,
    t.sport,
    g.season,
    count(*) AS games_played,
    count(*) FILTER (WHERE ((g.home_score > g.away_score) AND ((g.type)::text = 'home'::text))) AS home_wins,
    count(*) FILTER (WHERE ((g.home_score < g.away_score) AND ((g.type)::text = 'home'::text))) AS home_losses,
    count(*) FILTER (WHERE ((g.away_score > g.home_score) AND ((g.type)::text = 'away'::text))) AS away_wins,
    count(*) FILTER (WHERE ((g.away_score < g.home_score) AND ((g.type)::text = 'away'::text))) AS away_losses,
    count(*) FILTER (WHERE ((((g.type)::text = 'home'::text) AND (g.home_score > g.away_score)) OR (((g.type)::text = 'away'::text) AND (g.away_score > g.home_score)))) AS total_wins,
    count(*) FILTER (WHERE ((((g.type)::text = 'home'::text) AND (g.home_score < g.away_score)) OR (((g.type)::text = 'away'::text) AND (g.away_score < g.home_score)))) AS total_losses
   FROM (public.teams t
     JOIN public.games g ON ((g.kscw_team = t.id)))
  WHERE (((g.status)::text = 'completed'::text) AND (g.home_score IS NOT NULL) AND (g.away_score IS NOT NULL))
  GROUP BY t.id, t.name, t.sport, g.season;


--
-- Name: stats_games_missing_schreiber; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.stats_games_missing_schreiber WITH (security_invoker='true') AS
 SELECT g.id AS game_id,
    g.date AS game_date,
    g."time" AS game_time,
    g.home_team,
    g.away_team,
    g.league,
    t.id AS team_id,
    t.name AS team_name,
    t.sport,
        CASE
            WHEN (((t.sport)::text = 'volleyball'::text) AND ((t.name)::text = 'HU20'::text)) THEN 'Schiedsrichter'::text
            WHEN ((t.sport)::text = 'volleyball'::text) THEN concat_ws(', '::text,
            CASE
                WHEN ((g.scorer_member IS NULL) AND (g.scorer_scoreboard_member IS NULL)) THEN 'Schreiber'::text
                ELSE NULL::text
            END,
            CASE
                WHEN ((g.scoreboard_member IS NULL) AND (g.scorer_scoreboard_member IS NULL)) THEN 'Anzeiger'::text
                ELSE NULL::text
            END)
            WHEN ((t.sport)::text = 'basketball'::text) THEN concat_ws(', '::text,
            CASE
                WHEN (g.bb_scorer_member IS NULL) THEN 'Scorer'::text
                ELSE NULL::text
            END,
            CASE
                WHEN (g.bb_timekeeper_member IS NULL) THEN 'Zeitnehmer'::text
                ELSE NULL::text
            END,
            CASE
                WHEN (g.bb_24s_official IS NULL) THEN '24s'::text
                ELSE NULL::text
            END)
            ELSE NULL::text
        END AS missing_roles,
    COALESCE(g.scorer_duty_team, g.referee_duty_team, g.bb_duty_team) AS duty_team_id
   FROM (public.games g
     JOIN public.teams t ON ((t.id = g.kscw_team)))
  WHERE (((g.type)::text = 'home'::text) AND (g.date >= CURRENT_DATE) AND ((g.status)::text = ANY (ARRAY[('scheduled'::character varying)::text, ('live'::character varying)::text])) AND ((((t.sport)::text = 'volleyball'::text) AND ((t.name)::text = 'HU20'::text) AND (g.referee_member IS NULL)) OR (((t.sport)::text = 'volleyball'::text) AND ((t.name)::text <> 'HU20'::text) AND (g.scorer_member IS NULL) AND (g.scoreboard_member IS NULL) AND (g.scorer_scoreboard_member IS NULL)) OR (((t.sport)::text = 'basketball'::text) AND (g.bb_scorer_member IS NULL) AND (g.bb_timekeeper_member IS NULL) AND (g.bb_24s_official IS NULL))))
  ORDER BY g.date, g."time";


--
-- Name: stats_members; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.stats_members WITH (security_invoker='true') AS
 SELECT count(*) AS total_members,
    count(*) FILTER (WHERE (wiedisync_active = true)) AS active_wiedisync,
    count(*) FILTER (WHERE (shell = true)) AS shell_accounts,
    count(*) FILTER (WHERE ((shell = false) AND (wiedisync_active = true))) AS registered_users,
    count(*) FILTER (WHERE scorer_vb) AS licence_scorer_vb,
    count(*) FILTER (WHERE referee_vb) AS licence_referee_vb,
    count(*) FILTER (WHERE otr1_bb) AS licence_otr1_bb,
    count(*) FILTER (WHERE otr2_bb) AS licence_otr2_bb,
    count(*) FILTER (WHERE (role @> '"superuser"'::jsonb)) AS role_superuser,
    count(*) FILTER (WHERE (role @> '"admin"'::jsonb)) AS role_admin,
    count(*) FILTER (WHERE (role @> '"vb_admin"'::jsonb)) AS role_vb_admin,
    count(*) FILTER (WHERE (role @> '"bb_admin"'::jsonb)) AS role_bb_admin,
    count(*) FILTER (WHERE (role @> '"vorstand"'::jsonb)) AS role_vorstand
   FROM public.members;


--
-- Name: stats_participation; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.stats_participation WITH (security_invoker='true') AS
 WITH game_rsvp AS (
         SELECT g.kscw_team AS team_id,
            count(DISTINCT g.id) AS total_games,
            count(DISTINCT p.activity_id) AS total_responses,
            count(DISTINCT p.activity_id) FILTER (WHERE ((p.status)::text = 'confirmed'::text)) AS confirmed,
            count(DISTINCT p.activity_id) FILTER (WHERE ((p.status)::text = 'declined'::text)) AS declined,
            count(DISTINCT p.activity_id) FILTER (WHERE ((p.status)::text = 'tentative'::text)) AS tentative
           FROM (public.games g
             LEFT JOIN public.participations p ON ((((p.activity_type)::text = 'game'::text) AND ((p.activity_id)::text = (g.id)::text))))
          WHERE (g.date >= (CURRENT_DATE - '90 days'::interval))
          GROUP BY g.kscw_team
        ), training_rsvp AS (
         SELECT tr_1.team AS team_id,
            count(DISTINCT tr_1.id) AS total_trainings,
            count(DISTINCT p.activity_id) AS total_responses,
            count(DISTINCT p.activity_id) FILTER (WHERE ((p.status)::text = 'confirmed'::text)) AS confirmed,
            count(DISTINCT p.activity_id) FILTER (WHERE ((p.status)::text = 'declined'::text)) AS declined,
            count(DISTINCT p.activity_id) FILTER (WHERE ((p.status)::text = 'tentative'::text)) AS tentative
           FROM (public.trainings tr_1
             LEFT JOIN public.participations p ON ((((p.activity_type)::text = 'training'::text) AND ((p.activity_id)::text = (tr_1.id)::text))))
          WHERE ((tr_1.date >= (CURRENT_DATE - '90 days'::interval)) AND (tr_1.cancelled = false))
          GROUP BY tr_1.team
        )
 SELECT t.id AS team_id,
    t.name AS team_name,
    t.sport,
    COALESCE(gr.total_games, (0)::bigint) AS games_total,
    COALESCE(gr.total_responses, (0)::bigint) AS games_responses,
    COALESCE(gr.confirmed, (0)::bigint) AS games_confirmed,
    COALESCE(gr.declined, (0)::bigint) AS games_declined,
    COALESCE(gr.tentative, (0)::bigint) AS games_tentative,
    COALESCE(tr.total_trainings, (0)::bigint) AS trainings_total,
    COALESCE(tr.total_responses, (0)::bigint) AS trainings_responses,
    COALESCE(tr.confirmed, (0)::bigint) AS trainings_confirmed,
    COALESCE(tr.declined, (0)::bigint) AS trainings_declined,
    COALESCE(tr.tentative, (0)::bigint) AS trainings_tentative
   FROM ((public.teams t
     LEFT JOIN game_rsvp gr ON ((gr.team_id = t.id)))
     LEFT JOIN training_rsvp tr ON ((tr.team_id = t.id)))
  WHERE (t.active = true);


--
-- Name: stats_schreiber_coverage; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.stats_schreiber_coverage WITH (security_invoker='true') AS
 SELECT t.id AS team_id,
    t.name AS team_name,
    t.sport,
    g.season,
    count(DISTINCT g.id) AS total_home_games,
    count(DISTINCT g.id) FILTER (WHERE (((t.sport)::text = 'volleyball'::text) AND (g.scorer_member IS NOT NULL))) AS vb_scorer_assigned,
    count(DISTINCT g.id) FILTER (WHERE (((t.sport)::text = 'volleyball'::text) AND (g.scoreboard_member IS NOT NULL))) AS vb_scoreboard_assigned,
    count(DISTINCT g.id) FILTER (WHERE (((t.sport)::text = 'volleyball'::text) AND (g.scorer_scoreboard_member IS NOT NULL))) AS vb_scorer_scoreboard_assigned,
    count(DISTINCT g.id) FILTER (WHERE (((t.sport)::text = 'volleyball'::text) AND ((g.scorer_member IS NOT NULL) OR (g.scoreboard_member IS NOT NULL) OR (g.scorer_scoreboard_member IS NOT NULL)))) AS vb_any_duty_assigned,
    count(DISTINCT g.id) FILTER (WHERE (((t.sport)::text = 'volleyball'::text) AND (g.scorer_member IS NULL) AND (g.scoreboard_member IS NULL) AND (g.scorer_scoreboard_member IS NULL))) AS vb_no_duty_assigned,
    count(DISTINCT g.id) FILTER (WHERE (((t.sport)::text = 'basketball'::text) AND (g.bb_scorer_member IS NOT NULL))) AS bb_scorer_assigned,
    count(DISTINCT g.id) FILTER (WHERE (((t.sport)::text = 'basketball'::text) AND (g.bb_timekeeper_member IS NOT NULL))) AS bb_timekeeper_assigned,
    count(DISTINCT g.id) FILTER (WHERE (((t.sport)::text = 'basketball'::text) AND (g.bb_24s_official IS NOT NULL))) AS bb_24s_assigned,
    count(DISTINCT g.id) FILTER (WHERE (((t.sport)::text = 'basketball'::text) AND ((g.bb_scorer_member IS NOT NULL) OR (g.bb_timekeeper_member IS NOT NULL) OR (g.bb_24s_official IS NOT NULL)))) AS bb_any_duty_assigned,
    count(DISTINCT g.id) FILTER (WHERE (((t.sport)::text = 'basketball'::text) AND (g.bb_scorer_member IS NULL) AND (g.bb_timekeeper_member IS NULL) AND (g.bb_24s_official IS NULL))) AS bb_no_duty_assigned
   FROM (public.teams t
     LEFT JOIN public.games g ON (((g.kscw_team = t.id) AND ((g.type)::text = 'home'::text))))
  WHERE (t.active = true)
  GROUP BY t.id, t.name, t.sport, g.season;


--
-- Name: stats_team_roster; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.stats_team_roster AS
SELECT
    NULL::integer AS team_id,
    NULL::character varying(255) AS team_name,
    NULL::character varying(255) AS sport,
    NULL::character varying(255) AS league,
    NULL::boolean AS team_active,
    NULL::bigint AS roster_size,
    NULL::bigint AS active_roster_size,
    NULL::bigint AS guest_count,
    NULL::bigint AS lic_scorer_vb,
    NULL::bigint AS lic_referee_vb,
    NULL::bigint AS lic_otr1_bb,
    NULL::bigint AS lic_otr2_bb,
    NULL::bigint AS lic_referee_bb,
    NULL::bigint AS coach_count,
    NULL::integer AS captain_count,
    NULL::bigint AS team_responsible_count;


--
-- Name: sv_vm_check; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sv_vm_check (
    id integer NOT NULL,
    association_id integer NOT NULL,
    first_name character varying(255) DEFAULT NULL::character varying,
    last_name character varying(255) DEFAULT NULL::character varying,
    gender character varying(10) DEFAULT NULL::character varying,
    email character varying(255) DEFAULT NULL::character varying,
    licence_category character varying(50) DEFAULT NULL::character varying,
    licence_activated boolean,
    licence_validated boolean,
    is_writer boolean DEFAULT false NOT NULL,
    team_names text,
    team_ids character varying(255) DEFAULT NULL::character varying,
    synced_at timestamp with time zone NOT NULL,
    date_created timestamp with time zone,
    date_updated timestamp with time zone,
    birthday date,
    nationality character varying(255),
    nationality_code character varying(255),
    is_locally_educated boolean,
    is_foreigner boolean,
    licence_club_id character varying(255),
    licence_club_name character varying(255),
    double_licence_club_id character varying(255),
    double_licence_club_name character varying(255),
    double_licence_club_assoc character varying(255),
    double_licence_team_id character varying(255),
    double_licence_team_name character varying(255),
    licence_activation_date date,
    licence_validation_date date,
    federation character varying(255),
    licence_club_assoc character varying(255),
    is_referee boolean DEFAULT false NOT NULL,
    referee_assoc text
);


--
-- Name: COLUMN sv_vm_check.is_referee; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.sv_vm_check.is_referee IS 'Person holds a volleyball referee licence (appears in clubreferee for KSC Wiedikon). Drives members.referee_vb.';


--
-- Name: COLUMN sv_vm_check.referee_assoc; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.sv_vm_check.referee_assoc IS 'Managing association(s) the referee is licensed under, e.g. "SVRZ" or "SVRZ, SVRNO". VM exposes no referee grade.';


--
-- Name: sv_vm_check_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sv_vm_check_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sv_vm_check_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sv_vm_check_id_seq OWNED BY public.sv_vm_check.id;


--
-- Name: svrz_games; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.svrz_games (
    id uuid NOT NULL,
    svrz_persistence_id character varying(255) DEFAULT NULL::character varying NOT NULL,
    svrz_number integer NOT NULL,
    status character varying(255) DEFAULT NULL::character varying NOT NULL,
    display_name text,
    short_display_name text,
    starting_date_time timestamp with time zone,
    playing_weekday character varying(255) DEFAULT NULL::character varying,
    home_club_id character varying(255) DEFAULT NULL::character varying,
    home_club_name character varying(255) DEFAULT NULL::character varying,
    home_team_name character varying(255) DEFAULT NULL::character varying,
    away_club_id character varying(255) DEFAULT NULL::character varying,
    away_club_name character varying(255) DEFAULT NULL::character varying,
    away_team_name character varying(255) DEFAULT NULL::character varying,
    league_name character varying(255) DEFAULT NULL::character varying,
    league_short character varying(255) DEFAULT NULL::character varying,
    gender character varying(255) DEFAULT NULL::character varying,
    season_name character varying(255) DEFAULT NULL::character varying,
    raw json,
    last_synced_at timestamp with time zone
);


--
-- Name: svrz_spielplaner_contacts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.svrz_spielplaner_contacts (
    id uuid NOT NULL,
    svrz_persistence_id character varying(255) DEFAULT NULL::character varying NOT NULL,
    season_uuid character varying(255) DEFAULT NULL::character varying NOT NULL,
    season_name character varying(255) DEFAULT NULL::character varying,
    club_id character varying(255) DEFAULT NULL::character varying,
    club_name character varying(255) DEFAULT NULL::character varying,
    person_first_name character varying(255) DEFAULT NULL::character varying,
    person_last_name character varying(255) DEFAULT NULL::character varying,
    contact_name character varying(255) DEFAULT NULL::character varying,
    contact_email character varying(255) DEFAULT NULL::character varying,
    contact_phone character varying(255) DEFAULT NULL::character varying,
    club_league_categories json,
    club_team_genders json,
    raw json,
    last_synced_at timestamp with time zone,
    team_identifier character varying(255)
);


--
-- Name: sync_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sync_runs (
    source text NOT NULL,
    last_run_at timestamp with time zone DEFAULT now() NOT NULL,
    status text DEFAULT 'ok'::text NOT NULL,
    rows_changed integer DEFAULT 0 NOT NULL,
    duration_ms integer DEFAULT 0 NOT NULL,
    error_message text,
    CONSTRAINT sync_runs_status_check CHECK ((status = ANY (ARRAY['ok'::text, 'error'::text])))
);


--
-- Name: TABLE sync_runs; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.sync_runs IS 'Per-cron last-run tracker — populated by logCronRun() helper. Read by /status page.';


--
-- Name: team_invites; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.team_invites (
    id integer NOT NULL,
    token character varying(255) DEFAULT NULL::character varying NOT NULL,
    guest_level integer DEFAULT 0,
    status character varying(255) DEFAULT NULL::character varying,
    expires_at timestamp with time zone,
    team integer,
    invited_by integer,
    claimed_by integer,
    date_created timestamp with time zone,
    date_updated timestamp with time zone
);


--
-- Name: team_invites_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.team_invites_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: team_invites_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.team_invites_id_seq OWNED BY public.team_invites.id;


--
-- Name: team_links; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.team_links (
    id integer NOT NULL,
    season integer NOT NULL,
    team_a integer NOT NULL,
    team_b integer NOT NULL,
    link_type character varying(8) NOT NULL,
    created_by integer,
    date_created timestamp with time zone DEFAULT now() NOT NULL,
    date_updated timestamp with time zone DEFAULT now() NOT NULL,
    sport character varying(16) DEFAULT 'basketball'::character varying NOT NULL
);


--
-- Name: TABLE team_links; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.team_links IS 'Coach/player-sharing links between teams, per season + sport. link_type: diff = must not play the same time (shared person); same = keep the same time; adjacent = different time but back-to-back. Drives the scheduling planners'' slot/day highlights. Edited via Basketball → Settings and Terminplanung → Settings.';


--
-- Name: team_links_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.team_links_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: team_links_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.team_links_id_seq OWNED BY public.team_links.id;


--
-- Name: team_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.team_requests (
    id integer NOT NULL,
    member integer,
    team integer,
    status character varying(20) DEFAULT 'pending'::character varying,
    date_created timestamp with time zone DEFAULT now(),
    date_updated timestamp with time zone DEFAULT now()
);


--
-- Name: team_requests_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.team_requests_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: team_requests_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.team_requests_id_seq OWNED BY public.team_requests.id;


--
-- Name: teams_coaches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.teams_coaches (
    id integer NOT NULL,
    teams_id integer NOT NULL,
    members_id integer NOT NULL
);


--
-- Name: teams_coaches_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.teams_coaches_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: teams_coaches_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.teams_coaches_id_seq OWNED BY public.teams_coaches.id;


--
-- Name: teams_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.teams_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: teams_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.teams_id_seq OWNED BY public.teams.id;


--
-- Name: teams_responsibles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.teams_responsibles (
    id integer NOT NULL,
    teams_id integer NOT NULL,
    members_id integer NOT NULL
);


--
-- Name: teams_responsibles_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.teams_responsibles_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: teams_responsibles_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.teams_responsibles_id_seq OWNED BY public.teams_responsibles.id;


--
-- Name: teams_sponsors; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.teams_sponsors (
    id integer NOT NULL,
    teams_id integer NOT NULL,
    sponsors_id integer NOT NULL
);


--
-- Name: teams_sponsors_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.teams_sponsors_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: teams_sponsors_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.teams_sponsors_id_seq OWNED BY public.teams_sponsors.id;


--
-- Name: training_slot_skips; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.training_slot_skips (
    id integer NOT NULL,
    hall_slot integer NOT NULL,
    date date NOT NULL,
    created_by uuid,
    date_created timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: training_slot_skips_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.training_slot_skips_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: training_slot_skips_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.training_slot_skips_id_seq OWNED BY public.training_slot_skips.id;


--
-- Name: trainings_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.trainings_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trainings_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.trainings_id_seq OWNED BY public.trainings.id;


--
-- Name: user_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_logs (
    id integer NOT NULL,
    action character varying(255) DEFAULT NULL::character varying,
    collection_name character varying(255) DEFAULT NULL::character varying,
    record_id character varying(255) DEFAULT NULL::character varying,
    data json,
    "user" integer,
    date_created timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    date_updated timestamp with time zone
);


--
-- Name: user_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.user_logs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: user_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.user_logs_id_seq OWNED BY public.user_logs.id;


--
-- Name: vb_referee_duty; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vb_referee_duty (
    id integer NOT NULL,
    referee integer NOT NULL,
    team integer,
    external boolean DEFAULT false NOT NULL,
    external_label character varying(200),
    note character varying(500),
    date_created timestamp with time zone DEFAULT now() NOT NULL,
    user_created uuid,
    CONSTRAINT vb_referee_duty_team_or_external CHECK (((team IS NOT NULL) OR (external = true)))
);


--
-- Name: TABLE vb_referee_duty; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.vb_referee_duty IS 'Standing VB referee → team duty map. Set on /admin/vb-referees; many-to-many; external=true (team NULL) for duty outside Wiedikon. Coverage check now, scorer-assign input later.';


--
-- Name: vb_referee_duty_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.vb_referee_duty_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: vb_referee_duty_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.vb_referee_duty_id_seq OWNED BY public.vb_referee_duty.id;


--
-- Name: vis_federations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vis_federations (
    vis_no integer NOT NULL,
    iso character varying(2) NOT NULL,
    code character varying(3) NOT NULL,
    name text NOT NULL,
    email text,
    website text
);


--
-- Name: TABLE vis_federations; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.vis_federations IS 'National volleyball federations from VIS GetFederationList, keyed by VIS number, with the ISO alpha-2 of their country. email may hold several addresses separated by "; ".';


--
-- Name: vis_transfers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vis_transfers (
    vis_no integer NOT NULL,
    season_no integer NOT NULL,
    no_by_season integer,
    status_code integer,
    status_label text,
    percent_complete integer,
    is_player_minor boolean,
    is_player_blocked boolean,
    start_on date,
    end_on date,
    player_no integer,
    player_first_name text,
    player_last_name text,
    from_federation_no integer,
    to_club_no integer,
    to_club_name text,
    to_team_name text,
    to_division_name text,
    deleted_at timestamp with time zone,
    synced_at timestamp with time zone DEFAULT now() NOT NULL,
    from_federation_code text
);


--
-- Name: TABLE vis_transfers; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.vis_transfers IS 'FIVB VIS international transfers for KSC Wiedikon (club 13021), read-only mirror. status_code 200/210/215/220 = ended (ITC issued); 239/240 cancelled; 255 refused. Authoritative, unlike members.transfer_status which is the club''s own workflow marker.';


--
-- Name: COLUMN vis_transfers.from_federation_code; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.vis_transfers.from_federation_code IS 'FIVB 3-letter federation code of the releasing federation (BRA, SUI, …) — IOC-style, not ISO alpha-2.';


--
-- Name: vm_vb_spielplan_contact; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vm_vb_spielplan_contact (
    id integer NOT NULL,
    date_created timestamp with time zone,
    date_updated timestamp with time zone,
    "FirstName" text,
    "LastName" character varying(255),
    "Email" character varying(255),
    "Language" character varying(255)
);


--
-- Name: vm_vb_spielplan_contact_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.vm_vb_spielplan_contact_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: vm_vb_spielplan_contact_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.vm_vb_spielplan_contact_id_seq OWNED BY public.vm_vb_spielplan_contact.id;


--
-- Name: volley_feedback; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.volley_feedback (
    id uuid NOT NULL,
    date_created timestamp with time zone,
    season character varying(255) DEFAULT '2025/2026'::character varying,
    is_anonymous boolean DEFAULT false,
    locale character varying(2),
    name character varying(255),
    functions json,
    teams json,
    other_function character varying(255),
    other_team character varying(255),
    rating_verein integer,
    rating_vorstand integer,
    rating_tk_leitung integer,
    rating_training integer,
    rating_kommunikation integer,
    feedback_text text,
    ideas_text text,
    other_text text
);


--
-- Name: website_admin_access; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.website_admin_access (
    id integer NOT NULL,
    "user" uuid NOT NULL,
    sections jsonb DEFAULT '[]'::jsonb NOT NULL,
    date_created timestamp with time zone DEFAULT now() NOT NULL,
    date_updated timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE website_admin_access; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.website_admin_access IS 'kscw-website /admin per-user section grants. Internal — not a Directus collection; only reachable via /kscw/wadmin.';


--
-- Name: COLUMN website_admin_access.sections; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.website_admin_access.sections IS 'JSON array of section keys: news, events, registrations, sponsors, scorer_courses, mixed_turnier';


--
-- Name: website_admin_access_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.website_admin_access_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: website_admin_access_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.website_admin_access_id_seq OWNED BY public.website_admin_access.id;


--
-- Name: absences id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.absences ALTER COLUMN id SET DEFAULT nextval('public.absences_id_seq'::regclass);


--
-- Name: announcement_recipients id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.announcement_recipients ALTER COLUMN id SET DEFAULT nextval('public.announcement_recipients_id_seq'::regclass);


--
-- Name: announcements id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.announcements ALTER COLUMN id SET DEFAULT nextval('public.announcements_id_seq'::regclass);


--
-- Name: app_settings id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_settings ALTER COLUMN id SET DEFAULT nextval('public.app_settings_id_seq'::regclass);


--
-- Name: basketball_hall_availability id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.basketball_hall_availability ALTER COLUMN id SET DEFAULT nextval('public.basketball_hall_availability_id_seq'::regclass);


--
-- Name: basketball_slot_plan id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.basketball_slot_plan ALTER COLUMN id SET DEFAULT nextval('public.basketball_slot_plan_id_seq'::regclass);


--
-- Name: broadcasts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.broadcasts ALTER COLUMN id SET DEFAULT nextval('public.broadcasts_id_seq'::regclass);


--
-- Name: bugfix_jobs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bugfix_jobs ALTER COLUMN id SET DEFAULT nextval('public.bugfix_jobs_id_seq'::regclass);


--
-- Name: clubdesk_export row_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clubdesk_export ALTER COLUMN row_id SET DEFAULT nextval('public.clubdesk_export_row_id_seq'::regclass);


--
-- Name: email_verifications id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_verifications ALTER COLUMN id SET DEFAULT nextval('public.email_verifications_id_seq'::regclass);


--
-- Name: error_annotations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.error_annotations ALTER COLUMN id SET DEFAULT nextval('public.error_annotations_id_seq'::regclass);


--
-- Name: error_mute_rules id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.error_mute_rules ALTER COLUMN id SET DEFAULT nextval('public.error_mute_rules_id_seq'::regclass);


--
-- Name: event_sessions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_sessions ALTER COLUMN id SET DEFAULT nextval('public.event_sessions_id_seq'::regclass);


--
-- Name: event_signups id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_signups ALTER COLUMN id SET DEFAULT nextval('public.event_signups_id_seq'::regclass);


--
-- Name: events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.events ALTER COLUMN id SET DEFAULT nextval('public.events_id_seq'::regclass);


--
-- Name: events_members id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.events_members ALTER COLUMN id SET DEFAULT nextval('public.events_members_id_seq'::regclass);


--
-- Name: events_teams id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.events_teams ALTER COLUMN id SET DEFAULT nextval('public.events_teams_id_seq'::regclass);


--
-- Name: feedback id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feedback ALTER COLUMN id SET DEFAULT nextval('public.feedback_id_seq'::regclass);


--
-- Name: finance_accounts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_accounts ALTER COLUMN id SET DEFAULT nextval('public.finance_accounts_id_seq'::regclass);


--
-- Name: finance_billing_contacts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_billing_contacts ALTER COLUMN id SET DEFAULT nextval('public.finance_billing_contacts_id_seq'::regclass);


--
-- Name: finance_budget_lines id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_budget_lines ALTER COLUMN id SET DEFAULT nextval('public.finance_budget_lines_id_seq'::regclass);


--
-- Name: finance_dues_rates id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_dues_rates ALTER COLUMN id SET DEFAULT nextval('public.finance_dues_rates_id_seq'::regclass);


--
-- Name: finance_dues_runs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_dues_runs ALTER COLUMN id SET DEFAULT nextval('public.finance_dues_runs_id_seq'::regclass);


--
-- Name: finance_dunning_notices id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_dunning_notices ALTER COLUMN id SET DEFAULT nextval('public.finance_dunning_notices_id_seq'::regclass);


--
-- Name: finance_email_jobs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_email_jobs ALTER COLUMN id SET DEFAULT nextval('public.finance_email_jobs_id_seq'::regclass);


--
-- Name: finance_expenses id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_expenses ALTER COLUMN id SET DEFAULT nextval('public.finance_expenses_id_seq'::regclass);


--
-- Name: finance_fiscal_years id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_fiscal_years ALTER COLUMN id SET DEFAULT nextval('public.finance_fiscal_years_id_seq'::regclass);


--
-- Name: finance_imports id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_imports ALTER COLUMN id SET DEFAULT nextval('public.finance_imports_id_seq'::regclass);


--
-- Name: finance_invoice_documents id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_invoice_documents ALTER COLUMN id SET DEFAULT nextval('public.finance_invoice_documents_id_seq'::regclass);


--
-- Name: finance_invoice_member_overrides id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_invoice_member_overrides ALTER COLUMN id SET DEFAULT nextval('public.finance_invoice_member_overrides_id_seq'::regclass);


--
-- Name: finance_invoices id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_invoices ALTER COLUMN id SET DEFAULT nextval('public.finance_invoices_id_seq'::regclass);


--
-- Name: finance_payments id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_payments ALTER COLUMN id SET DEFAULT nextval('public.finance_payments_id_seq'::regclass);


--
-- Name: finance_payouts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_payouts ALTER COLUMN id SET DEFAULT nextval('public.finance_payouts_id_seq'::regclass);


--
-- Name: finance_team_entries id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_team_entries ALTER COLUMN id SET DEFAULT nextval('public.finance_team_entries_id_seq'::regclass);


--
-- Name: finance_transactions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_transactions ALTER COLUMN id SET DEFAULT nextval('public.finance_transactions_id_seq'::regclass);


--
-- Name: fine_rules id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fine_rules ALTER COLUMN id SET DEFAULT nextval('public.fine_rules_id_seq'::regclass);


--
-- Name: fines id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fines ALTER COLUMN id SET DEFAULT nextval('public.fines_id_seq'::regclass);


--
-- Name: form_submissions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.form_submissions ALTER COLUMN id SET DEFAULT nextval('public.form_submissions_id_seq'::regclass);


--
-- Name: forms id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.forms ALTER COLUMN id SET DEFAULT nextval('public.forms_id_seq'::regclass);


--
-- Name: forms_teams id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.forms_teams ALTER COLUMN id SET DEFAULT nextval('public.forms_teams_id_seq'::regclass);


--
-- Name: game_rosters id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_rosters ALTER COLUMN id SET DEFAULT nextval('public.game_rosters_id_seq'::regclass);


--
-- Name: game_scheduling_bookings id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_scheduling_bookings ALTER COLUMN id SET DEFAULT nextval('public.game_scheduling_bookings_id_seq'::regclass);


--
-- Name: game_scheduling_club_portals id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_scheduling_club_portals ALTER COLUMN id SET DEFAULT nextval('public.game_scheduling_club_portals_id_seq'::regclass);


--
-- Name: game_scheduling_derbies id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_scheduling_derbies ALTER COLUMN id SET DEFAULT nextval('public.game_scheduling_derbies_id_seq'::regclass);


--
-- Name: game_scheduling_opponents id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_scheduling_opponents ALTER COLUMN id SET DEFAULT nextval('public.game_scheduling_opponents_id_seq'::regclass);


--
-- Name: game_scheduling_seasons id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_scheduling_seasons ALTER COLUMN id SET DEFAULT nextval('public.game_scheduling_seasons_id_seq'::regclass);


--
-- Name: game_scheduling_slots id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_scheduling_slots ALTER COLUMN id SET DEFAULT nextval('public.game_scheduling_slots_id_seq'::regclass);


--
-- Name: games id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.games ALTER COLUMN id SET DEFAULT nextval('public.games_id_seq'::regclass);


--
-- Name: hall_closures id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hall_closures ALTER COLUMN id SET DEFAULT nextval('public.hall_closures_id_seq'::regclass);


--
-- Name: hall_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hall_events ALTER COLUMN id SET DEFAULT nextval('public.hall_events_id_seq'::regclass);


--
-- Name: hall_slots id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hall_slots ALTER COLUMN id SET DEFAULT nextval('public.hall_slots_id_seq'::regclass);


--
-- Name: hall_slots_teams id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hall_slots_teams ALTER COLUMN id SET DEFAULT nextval('public.hall_slots_teams_id_seq'::regclass);


--
-- Name: halls id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.halls ALTER COLUMN id SET DEFAULT nextval('public.halls_id_seq'::regclass);


--
-- Name: identity_document_keys id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.identity_document_keys ALTER COLUMN id SET DEFAULT nextval('public.identity_document_keys_id_seq'::regclass);


--
-- Name: identity_documents id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.identity_documents ALTER COLUMN id SET DEFAULT nextval('public.identity_documents_id_seq'::regclass);


--
-- Name: member_teams id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_teams ALTER COLUMN id SET DEFAULT nextval('public.member_teams_id_seq'::regclass);


--
-- Name: members id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.members ALTER COLUMN id SET DEFAULT nextval('public.members_id_seq'::regclass);


--
-- Name: news id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.news ALTER COLUMN id SET DEFAULT nextval('public.news_id_seq'::regclass);


--
-- Name: newsletter_subscribers id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.newsletter_subscribers ALTER COLUMN id SET DEFAULT nextval('public.newsletter_subscribers_id_seq'::regclass);


--
-- Name: notifications id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications ALTER COLUMN id SET DEFAULT nextval('public.notifications_id_seq'::regclass);


--
-- Name: participations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.participations ALTER COLUMN id SET DEFAULT nextval('public.participations_id_seq'::regclass);


--
-- Name: password_reset_tokens id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.password_reset_tokens ALTER COLUMN id SET DEFAULT nextval('public.password_reset_tokens_id_seq'::regclass);


--
-- Name: poll_votes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.poll_votes ALTER COLUMN id SET DEFAULT nextval('public.poll_votes_id_seq'::regclass);


--
-- Name: polls id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.polls ALTER COLUMN id SET DEFAULT nextval('public.polls_id_seq'::regclass);


--
-- Name: push_subscriptions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_subscriptions ALTER COLUMN id SET DEFAULT nextval('public.push_subscriptions_id_seq'::regclass);


--
-- Name: rankings id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rankings ALTER COLUMN id SET DEFAULT nextval('public.rankings_id_seq'::regclass);


--
-- Name: referee_expenses id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referee_expenses ALTER COLUMN id SET DEFAULT nextval('public.referee_expenses_id_seq'::regclass);


--
-- Name: registrations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.registrations ALTER COLUMN id SET DEFAULT nextval('public.registrations_id_seq'::regclass);


--
-- Name: scheduling_blocks id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scheduling_blocks ALTER COLUMN id SET DEFAULT nextval('public.scheduling_blocks_id_seq'::regclass);


--
-- Name: scheduling_email_reads id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scheduling_email_reads ALTER COLUMN id SET DEFAULT nextval('public.scheduling_email_reads_id_seq'::regclass);


--
-- Name: scheduling_emails id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scheduling_emails ALTER COLUMN id SET DEFAULT nextval('public.scheduling_emails_id_seq'::regclass);


--
-- Name: scheduling_global_blocks id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scheduling_global_blocks ALTER COLUMN id SET DEFAULT nextval('public.scheduling_global_blocks_id_seq'::regclass);


--
-- Name: scorer_course_attendance id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scorer_course_attendance ALTER COLUMN id SET DEFAULT nextval('public.scorer_course_attendance_id_seq'::regclass);


--
-- Name: scorer_courses id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scorer_courses ALTER COLUMN id SET DEFAULT nextval('public.scorer_courses_id_seq'::regclass);


--
-- Name: scorer_delegations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scorer_delegations ALTER COLUMN id SET DEFAULT nextval('public.scorer_delegations_id_seq'::regclass);


--
-- Name: signup_tokens id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.signup_tokens ALTER COLUMN id SET DEFAULT nextval('public.signup_tokens_id_seq'::regclass);


--
-- Name: slot_claims id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.slot_claims ALTER COLUMN id SET DEFAULT nextval('public.slot_claims_id_seq'::regclass);


--
-- Name: sponsors id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sponsors ALTER COLUMN id SET DEFAULT nextval('public.sponsors_id_seq'::regclass);


--
-- Name: sv_vm_check id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sv_vm_check ALTER COLUMN id SET DEFAULT nextval('public.sv_vm_check_id_seq'::regclass);


--
-- Name: team_invites id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_invites ALTER COLUMN id SET DEFAULT nextval('public.team_invites_id_seq'::regclass);


--
-- Name: team_links id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_links ALTER COLUMN id SET DEFAULT nextval('public.team_links_id_seq'::regclass);


--
-- Name: team_requests id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_requests ALTER COLUMN id SET DEFAULT nextval('public.team_requests_id_seq'::regclass);


--
-- Name: teams id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teams ALTER COLUMN id SET DEFAULT nextval('public.teams_id_seq'::regclass);


--
-- Name: teams_coaches id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teams_coaches ALTER COLUMN id SET DEFAULT nextval('public.teams_coaches_id_seq'::regclass);


--
-- Name: teams_responsibles id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teams_responsibles ALTER COLUMN id SET DEFAULT nextval('public.teams_responsibles_id_seq'::regclass);


--
-- Name: teams_sponsors id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teams_sponsors ALTER COLUMN id SET DEFAULT nextval('public.teams_sponsors_id_seq'::regclass);


--
-- Name: training_slot_skips id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.training_slot_skips ALTER COLUMN id SET DEFAULT nextval('public.training_slot_skips_id_seq'::regclass);


--
-- Name: trainings id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trainings ALTER COLUMN id SET DEFAULT nextval('public.trainings_id_seq'::regclass);


--
-- Name: user_logs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_logs ALTER COLUMN id SET DEFAULT nextval('public.user_logs_id_seq'::regclass);


--
-- Name: vb_referee_duty id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vb_referee_duty ALTER COLUMN id SET DEFAULT nextval('public.vb_referee_duty_id_seq'::regclass);


--
-- Name: vm_vb_spielplan_contact id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vm_vb_spielplan_contact ALTER COLUMN id SET DEFAULT nextval('public.vm_vb_spielplan_contact_id_seq'::regclass);


--
-- Name: website_admin_access id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.website_admin_access ALTER COLUMN id SET DEFAULT nextval('public.website_admin_access_id_seq'::regclass);


--
-- Name: absences absences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.absences
    ADD CONSTRAINT absences_pkey PRIMARY KEY (id);


--
-- Name: announcement_recipients announcement_recipients_announcement_member_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.announcement_recipients
    ADD CONSTRAINT announcement_recipients_announcement_member_unique UNIQUE (announcement, member);


--
-- Name: announcement_recipients announcement_recipients_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.announcement_recipients
    ADD CONSTRAINT announcement_recipients_pkey PRIMARY KEY (id);


--
-- Name: announcements announcements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.announcements
    ADD CONSTRAINT announcements_pkey PRIMARY KEY (id);


--
-- Name: app_settings app_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_settings
    ADD CONSTRAINT app_settings_pkey PRIMARY KEY (id);


--
-- Name: basketball_hall_availability basketball_hall_availability_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.basketball_hall_availability
    ADD CONSTRAINT basketball_hall_availability_pkey PRIMARY KEY (id);


--
-- Name: basketball_hall_availability basketball_hall_availability_season_team_date_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.basketball_hall_availability
    ADD CONSTRAINT basketball_hall_availability_season_team_date_unique UNIQUE (season, team, date);


--
-- Name: basketball_slot_plan basketball_slot_plan_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.basketball_slot_plan
    ADD CONSTRAINT basketball_slot_plan_pkey PRIMARY KEY (id);


--
-- Name: basketball_slot_plan basketball_slot_plan_season_date_time_hall_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.basketball_slot_plan
    ADD CONSTRAINT basketball_slot_plan_season_date_time_hall_unique UNIQUE (season, date, "time", hall);


--
-- Name: team_links basketball_team_links_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_links
    ADD CONSTRAINT basketball_team_links_pkey PRIMARY KEY (id);


--
-- Name: basketplan_nations basketplan_nations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.basketplan_nations
    ADD CONSTRAINT basketplan_nations_pkey PRIMARY KEY (bp_id);


--
-- Name: basketplan_people basketplan_people_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.basketplan_people
    ADD CONSTRAINT basketplan_people_pkey PRIMARY KEY (person_id);


--
-- Name: blocks blocks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.blocks
    ADD CONSTRAINT blocks_pkey PRIMARY KEY (id);


--
-- Name: broadcasts broadcasts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.broadcasts
    ADD CONSTRAINT broadcasts_pkey PRIMARY KEY (id);


--
-- Name: bugfix_jobs bugfix_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bugfix_jobs
    ADD CONSTRAINT bugfix_jobs_pkey PRIMARY KEY (id);


--
-- Name: city_hall_availability city_hall_availability_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.city_hall_availability
    ADD CONSTRAINT city_hall_availability_pkey PRIMARY KEY (einrichtung_id, weekday, season_start, season_end);


--
-- Name: city_halls city_halls_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.city_halls
    ADD CONSTRAINT city_halls_pkey PRIMARY KEY (einrichtung_id);


--
-- Name: clubdesk_export_meta clubdesk_export_meta_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clubdesk_export_meta
    ADD CONSTRAINT clubdesk_export_meta_pkey PRIMARY KEY (id);


--
-- Name: clubdesk_export clubdesk_export_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clubdesk_export
    ADD CONSTRAINT clubdesk_export_pkey PRIMARY KEY (row_id);


--
-- Name: clubdesk_member_sync clubdesk_member_sync_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clubdesk_member_sync
    ADD CONSTRAINT clubdesk_member_sync_pkey PRIMARY KEY (id);


--
-- Name: conversation_members conversation_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_members
    ADD CONSTRAINT conversation_members_pkey PRIMARY KEY (id);


--
-- Name: conversations conversations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_pkey PRIMARY KEY (id);


--
-- Name: country_codes country_codes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.country_codes
    ADD CONSTRAINT country_codes_pkey PRIMARY KEY (code);


--
-- Name: country_name_aliases country_name_aliases_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.country_name_aliases
    ADD CONSTRAINT country_name_aliases_pkey PRIMARY KEY (alias);


--
-- Name: email_verifications email_verifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_verifications
    ADD CONSTRAINT email_verifications_pkey PRIMARY KEY (id);


--
-- Name: error_annotations error_annotations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.error_annotations
    ADD CONSTRAINT error_annotations_pkey PRIMARY KEY (id);


--
-- Name: error_mute_rules error_mute_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.error_mute_rules
    ADD CONSTRAINT error_mute_rules_pkey PRIMARY KEY (id);


--
-- Name: event_sessions event_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_sessions
    ADD CONSTRAINT event_sessions_pkey PRIMARY KEY (id);


--
-- Name: event_signups event_signups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_signups
    ADD CONSTRAINT event_signups_pkey PRIMARY KEY (id);


--
-- Name: events_members events_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.events_members
    ADD CONSTRAINT events_members_pkey PRIMARY KEY (id);


--
-- Name: events events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_pkey PRIMARY KEY (id);


--
-- Name: events_teams events_teams_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.events_teams
    ADD CONSTRAINT events_teams_pkey PRIMARY KEY (id);


--
-- Name: feedback feedback_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feedback
    ADD CONSTRAINT feedback_pkey PRIMARY KEY (id);


--
-- Name: finance_accounts finance_accounts_number_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_accounts
    ADD CONSTRAINT finance_accounts_number_unique UNIQUE (number);


--
-- Name: finance_accounts finance_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_accounts
    ADD CONSTRAINT finance_accounts_pkey PRIMARY KEY (id);


--
-- Name: finance_billing_contacts finance_billing_contacts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_billing_contacts
    ADD CONSTRAINT finance_billing_contacts_pkey PRIMARY KEY (id);


--
-- Name: finance_budget_lines finance_budget_lines_fy_account_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_budget_lines
    ADD CONSTRAINT finance_budget_lines_fy_account_unique UNIQUE (fiscal_year, account);


--
-- Name: finance_budget_lines finance_budget_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_budget_lines
    ADD CONSTRAINT finance_budget_lines_pkey PRIMARY KEY (id);


--
-- Name: finance_dues_rates finance_dues_rates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_dues_rates
    ADD CONSTRAINT finance_dues_rates_pkey PRIMARY KEY (id);


--
-- Name: finance_dues_runs finance_dues_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_dues_runs
    ADD CONSTRAINT finance_dues_runs_pkey PRIMARY KEY (id);


--
-- Name: finance_dunning_notices finance_dunning_notices_invoice_level_uq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_dunning_notices
    ADD CONSTRAINT finance_dunning_notices_invoice_level_uq UNIQUE (invoice, level);


--
-- Name: finance_dunning_notices finance_dunning_notices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_dunning_notices
    ADD CONSTRAINT finance_dunning_notices_pkey PRIMARY KEY (id);


--
-- Name: finance_email_jobs finance_email_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_email_jobs
    ADD CONSTRAINT finance_email_jobs_pkey PRIMARY KEY (id);


--
-- Name: finance_email_settings finance_email_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_email_settings
    ADD CONSTRAINT finance_email_settings_pkey PRIMARY KEY (id);


--
-- Name: finance_expenses finance_expenses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_expenses
    ADD CONSTRAINT finance_expenses_pkey PRIMARY KEY (id);


--
-- Name: finance_fiscal_years finance_fiscal_years_label_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_fiscal_years
    ADD CONSTRAINT finance_fiscal_years_label_unique UNIQUE (label);


--
-- Name: finance_fiscal_years finance_fiscal_years_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_fiscal_years
    ADD CONSTRAINT finance_fiscal_years_pkey PRIMARY KEY (id);


--
-- Name: finance_imports finance_imports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_imports
    ADD CONSTRAINT finance_imports_pkey PRIMARY KEY (id);


--
-- Name: finance_income_account_map finance_income_account_map_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_income_account_map
    ADD CONSTRAINT finance_income_account_map_pkey PRIMARY KEY (fee_category);


--
-- Name: finance_invoice_documents finance_invoice_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_invoice_documents
    ADD CONSTRAINT finance_invoice_documents_pkey PRIMARY KEY (id);


--
-- Name: finance_invoice_member_overrides finance_invoice_member_overrides_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_invoice_member_overrides
    ADD CONSTRAINT finance_invoice_member_overrides_pkey PRIMARY KEY (id);


--
-- Name: finance_invoices finance_invoices_clubdesk_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_invoices
    ADD CONSTRAINT finance_invoices_clubdesk_id_unique UNIQUE (clubdesk_id);


--
-- Name: finance_invoices finance_invoices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_invoices
    ADD CONSTRAINT finance_invoices_pkey PRIMARY KEY (id);


--
-- Name: finance_ledger_settings finance_ledger_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_ledger_settings
    ADD CONSTRAINT finance_ledger_settings_pkey PRIMARY KEY (id);


--
-- Name: finance_payments finance_payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_payments
    ADD CONSTRAINT finance_payments_pkey PRIMARY KEY (id);


--
-- Name: finance_payouts finance_payouts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_payouts
    ADD CONSTRAINT finance_payouts_pkey PRIMARY KEY (id);


--
-- Name: finance_team_entries finance_team_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_team_entries
    ADD CONSTRAINT finance_team_entries_pkey PRIMARY KEY (id);


--
-- Name: finance_transactions finance_transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_transactions
    ADD CONSTRAINT finance_transactions_pkey PRIMARY KEY (id);


--
-- Name: fine_rules fine_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fine_rules
    ADD CONSTRAINT fine_rules_pkey PRIMARY KEY (id);


--
-- Name: fine_rules fine_rules_team_category_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fine_rules
    ADD CONSTRAINT fine_rules_team_category_unique UNIQUE (team, category);


--
-- Name: fines fines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fines
    ADD CONSTRAINT fines_pkey PRIMARY KEY (id);


--
-- Name: form_submissions form_submissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.form_submissions
    ADD CONSTRAINT form_submissions_pkey PRIMARY KEY (id);


--
-- Name: forms forms_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.forms
    ADD CONSTRAINT forms_pkey PRIMARY KEY (id);


--
-- Name: forms_teams forms_teams_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.forms_teams
    ADD CONSTRAINT forms_teams_pkey PRIMARY KEY (id);


--
-- Name: game_rosters game_rosters_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_rosters
    ADD CONSTRAINT game_rosters_pkey PRIMARY KEY (id);


--
-- Name: game_scheduling_bookings game_scheduling_bookings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_scheduling_bookings
    ADD CONSTRAINT game_scheduling_bookings_pkey PRIMARY KEY (id);


--
-- Name: game_scheduling_club_portals game_scheduling_club_portals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_scheduling_club_portals
    ADD CONSTRAINT game_scheduling_club_portals_pkey PRIMARY KEY (id);


--
-- Name: game_scheduling_club_portals game_scheduling_club_portals_season_club_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_scheduling_club_portals
    ADD CONSTRAINT game_scheduling_club_portals_season_club_unique UNIQUE (season, club_id);


--
-- Name: game_scheduling_derbies game_scheduling_derbies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_scheduling_derbies
    ADD CONSTRAINT game_scheduling_derbies_pkey PRIMARY KEY (id);


--
-- Name: game_scheduling_derbies game_scheduling_derbies_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_scheduling_derbies
    ADD CONSTRAINT game_scheduling_derbies_unique UNIQUE (season, team_a, team_b);


--
-- Name: game_scheduling_opponents game_scheduling_opponents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_scheduling_opponents
    ADD CONSTRAINT game_scheduling_opponents_pkey PRIMARY KEY (id);


--
-- Name: game_scheduling_seasons game_scheduling_seasons_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_scheduling_seasons
    ADD CONSTRAINT game_scheduling_seasons_pkey PRIMARY KEY (id);


--
-- Name: game_scheduling_slots game_scheduling_slots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_scheduling_slots
    ADD CONSTRAINT game_scheduling_slots_pkey PRIMARY KEY (id);


--
-- Name: games games_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.games
    ADD CONSTRAINT games_pkey PRIMARY KEY (id);


--
-- Name: hall_closures hall_closures_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hall_closures
    ADD CONSTRAINT hall_closures_pkey PRIMARY KEY (id);


--
-- Name: hall_events hall_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hall_events
    ADD CONSTRAINT hall_events_pkey PRIMARY KEY (id);


--
-- Name: hall_slots hall_slots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hall_slots
    ADD CONSTRAINT hall_slots_pkey PRIMARY KEY (id);


--
-- Name: hall_slots_teams hall_slots_teams_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hall_slots_teams
    ADD CONSTRAINT hall_slots_teams_pkey PRIMARY KEY (id);


--
-- Name: halls halls_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.halls
    ADD CONSTRAINT halls_pkey PRIMARY KEY (id);


--
-- Name: identity_document_keys identity_document_keys_document_recipient_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.identity_document_keys
    ADD CONSTRAINT identity_document_keys_document_recipient_key UNIQUE (document, recipient);


--
-- Name: identity_document_keys identity_document_keys_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.identity_document_keys
    ADD CONSTRAINT identity_document_keys_pkey PRIMARY KEY (id);


--
-- Name: identity_documents identity_documents_member_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.identity_documents
    ADD CONSTRAINT identity_documents_member_key UNIQUE (member);


--
-- Name: identity_documents identity_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.identity_documents
    ADD CONSTRAINT identity_documents_pkey PRIMARY KEY (id);


--
-- Name: kscw_migrations kscw_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kscw_migrations
    ADD CONSTRAINT kscw_migrations_pkey PRIMARY KEY (filename);


--
-- Name: member_teams member_teams_member_team_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_teams
    ADD CONSTRAINT member_teams_member_team_unique UNIQUE (member, team);


--
-- Name: member_teams member_teams_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_teams
    ADD CONSTRAINT member_teams_pkey PRIMARY KEY (id);


--
-- Name: members members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.members
    ADD CONSTRAINT members_pkey PRIMARY KEY (id);


--
-- Name: message_reactions message_reactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_reactions
    ADD CONSTRAINT message_reactions_pkey PRIMARY KEY (id);


--
-- Name: message_requests message_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_requests
    ADD CONSTRAINT message_requests_pkey PRIMARY KEY (id);


--
-- Name: messages messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_pkey PRIMARY KEY (id);


--
-- Name: news news_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.news
    ADD CONSTRAINT news_pkey PRIMARY KEY (id);


--
-- Name: news news_slug_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.news
    ADD CONSTRAINT news_slug_unique UNIQUE (slug);


--
-- Name: newsletter_subscribers newsletter_subscribers_email_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.newsletter_subscribers
    ADD CONSTRAINT newsletter_subscribers_email_unique UNIQUE (email);


--
-- Name: newsletter_subscribers newsletter_subscribers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.newsletter_subscribers
    ADD CONSTRAINT newsletter_subscribers_pkey PRIMARY KEY (id);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: participations participations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.participations
    ADD CONSTRAINT participations_pkey PRIMARY KEY (id);


--
-- Name: password_reset_tokens password_reset_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.password_reset_tokens
    ADD CONSTRAINT password_reset_tokens_pkey PRIMARY KEY (id);


--
-- Name: password_reset_tokens password_reset_tokens_user_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.password_reset_tokens
    ADD CONSTRAINT password_reset_tokens_user_unique UNIQUE ("user");


--
-- Name: poll_votes poll_votes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.poll_votes
    ADD CONSTRAINT poll_votes_pkey PRIMARY KEY (id);


--
-- Name: polls polls_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.polls
    ADD CONSTRAINT polls_pkey PRIMARY KEY (id);


--
-- Name: public_stats public_stats_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.public_stats
    ADD CONSTRAINT public_stats_pkey PRIMARY KEY (id);


--
-- Name: push_subscriptions push_subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_pkey PRIMARY KEY (id);


--
-- Name: rankings rankings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rankings
    ADD CONSTRAINT rankings_pkey PRIMARY KEY (id);


--
-- Name: referee_expenses referee_expenses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referee_expenses
    ADD CONSTRAINT referee_expenses_pkey PRIMARY KEY (id);


--
-- Name: registrations registrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.registrations
    ADD CONSTRAINT registrations_pkey PRIMARY KEY (id);


--
-- Name: reports reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reports
    ADD CONSTRAINT reports_pkey PRIMARY KEY (id);


--
-- Name: scheduling_blocks scheduling_blocks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scheduling_blocks
    ADD CONSTRAINT scheduling_blocks_pkey PRIMARY KEY (id);


--
-- Name: scheduling_email_reads scheduling_email_reads_email_member_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scheduling_email_reads
    ADD CONSTRAINT scheduling_email_reads_email_member_unique UNIQUE (email, member);


--
-- Name: scheduling_email_reads scheduling_email_reads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scheduling_email_reads
    ADD CONSTRAINT scheduling_email_reads_pkey PRIMARY KEY (id);


--
-- Name: scheduling_emails scheduling_emails_account_message_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scheduling_emails
    ADD CONSTRAINT scheduling_emails_account_message_id_unique UNIQUE (account, message_id);


--
-- Name: scheduling_emails scheduling_emails_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scheduling_emails
    ADD CONSTRAINT scheduling_emails_pkey PRIMARY KEY (id);


--
-- Name: scheduling_global_blocks scheduling_global_blocks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scheduling_global_blocks
    ADD CONSTRAINT scheduling_global_blocks_pkey PRIMARY KEY (id);


--
-- Name: scorer_course_attendance scorer_course_attendance_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scorer_course_attendance
    ADD CONSTRAINT scorer_course_attendance_pkey PRIMARY KEY (id);


--
-- Name: scorer_course_attendance scorer_course_attendance_sub_key_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scorer_course_attendance
    ADD CONSTRAINT scorer_course_attendance_sub_key_unique UNIQUE (sub_key);


--
-- Name: scorer_courses scorer_courses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scorer_courses
    ADD CONSTRAINT scorer_courses_pkey PRIMARY KEY (id);


--
-- Name: scorer_delegations scorer_delegations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scorer_delegations
    ADD CONSTRAINT scorer_delegations_pkey PRIMARY KEY (id);


--
-- Name: signup_tokens signup_tokens_member_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.signup_tokens
    ADD CONSTRAINT signup_tokens_member_unique UNIQUE (member);


--
-- Name: signup_tokens signup_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.signup_tokens
    ADD CONSTRAINT signup_tokens_pkey PRIMARY KEY (id);


--
-- Name: slot_claims slot_claims_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.slot_claims
    ADD CONSTRAINT slot_claims_pkey PRIMARY KEY (id);


--
-- Name: spielplaner_assignments spielplaner_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.spielplaner_assignments
    ADD CONSTRAINT spielplaner_assignments_pkey PRIMARY KEY (id);


--
-- Name: sponsors sponsors_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sponsors
    ADD CONSTRAINT sponsors_pkey PRIMARY KEY (id);


--
-- Name: sv_vm_check sv_vm_check_association_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sv_vm_check
    ADD CONSTRAINT sv_vm_check_association_id_unique UNIQUE (association_id);


--
-- Name: sv_vm_check sv_vm_check_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sv_vm_check
    ADD CONSTRAINT sv_vm_check_pkey PRIMARY KEY (id);


--
-- Name: svrz_games svrz_games_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.svrz_games
    ADD CONSTRAINT svrz_games_pkey PRIMARY KEY (id);


--
-- Name: svrz_games svrz_games_svrz_persistence_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.svrz_games
    ADD CONSTRAINT svrz_games_svrz_persistence_id_unique UNIQUE (svrz_persistence_id);


--
-- Name: svrz_spielplaner_contacts svrz_spielplaner_contacts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.svrz_spielplaner_contacts
    ADD CONSTRAINT svrz_spielplaner_contacts_pkey PRIMARY KEY (id);


--
-- Name: svrz_spielplaner_contacts svrz_spielplaner_contacts_svrz_persistence_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.svrz_spielplaner_contacts
    ADD CONSTRAINT svrz_spielplaner_contacts_svrz_persistence_id_unique UNIQUE (svrz_persistence_id);


--
-- Name: sync_runs sync_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sync_runs
    ADD CONSTRAINT sync_runs_pkey PRIMARY KEY (source);


--
-- Name: team_invites team_invites_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_invites
    ADD CONSTRAINT team_invites_pkey PRIMARY KEY (id);


--
-- Name: team_links team_links_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_links
    ADD CONSTRAINT team_links_unique UNIQUE (season, sport, team_a, team_b);


--
-- Name: team_requests team_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_requests
    ADD CONSTRAINT team_requests_pkey PRIMARY KEY (id);


--
-- Name: teams_coaches teams_coaches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teams_coaches
    ADD CONSTRAINT teams_coaches_pkey PRIMARY KEY (id);


--
-- Name: teams teams_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teams
    ADD CONSTRAINT teams_pkey PRIMARY KEY (id);


--
-- Name: teams_responsibles teams_responsibles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teams_responsibles
    ADD CONSTRAINT teams_responsibles_pkey PRIMARY KEY (id);


--
-- Name: teams_sponsors teams_sponsors_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teams_sponsors
    ADD CONSTRAINT teams_sponsors_pkey PRIMARY KEY (id);


--
-- Name: training_slot_skips training_slot_skips_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.training_slot_skips
    ADD CONSTRAINT training_slot_skips_pkey PRIMARY KEY (id);


--
-- Name: training_slot_skips training_slot_skips_uniq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.training_slot_skips
    ADD CONSTRAINT training_slot_skips_uniq UNIQUE (hall_slot, date);


--
-- Name: trainings trainings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trainings
    ADD CONSTRAINT trainings_pkey PRIMARY KEY (id);


--
-- Name: spielplaner_assignments uq_spielplaner_assignments_member_team; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.spielplaner_assignments
    ADD CONSTRAINT uq_spielplaner_assignments_member_team UNIQUE (member, kscw_team);


--
-- Name: user_logs user_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_logs
    ADD CONSTRAINT user_logs_pkey PRIMARY KEY (id);


--
-- Name: vb_referee_duty vb_referee_duty_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vb_referee_duty
    ADD CONSTRAINT vb_referee_duty_pkey PRIMARY KEY (id);


--
-- Name: vb_referee_duty vb_referee_duty_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vb_referee_duty
    ADD CONSTRAINT vb_referee_duty_unique UNIQUE (referee, team);


--
-- Name: vis_federations vis_federations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vis_federations
    ADD CONSTRAINT vis_federations_pkey PRIMARY KEY (vis_no);


--
-- Name: vis_transfers vis_transfers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vis_transfers
    ADD CONSTRAINT vis_transfers_pkey PRIMARY KEY (vis_no);


--
-- Name: vm_vb_spielplan_contact vm_vb_spielplan_contact_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vm_vb_spielplan_contact
    ADD CONSTRAINT vm_vb_spielplan_contact_pkey PRIMARY KEY (id);


--
-- Name: volley_feedback volley_feedback_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.volley_feedback
    ADD CONSTRAINT volley_feedback_pkey PRIMARY KEY (id);


--
-- Name: website_admin_access website_admin_access_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.website_admin_access
    ADD CONSTRAINT website_admin_access_pkey PRIMARY KEY (id);


--
-- Name: website_admin_access website_admin_access_user_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.website_admin_access
    ADD CONSTRAINT website_admin_access_user_key UNIQUE ("user");


--
-- Name: absences_member_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX absences_member_index ON public.absences USING btree (member);


--
-- Name: announcement_recipients_member_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX announcement_recipients_member_idx ON public.announcement_recipients USING btree (member);


--
-- Name: basketball_hall_availability_season_team_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX basketball_hall_availability_season_team_idx ON public.basketball_hall_availability USING btree (season, team);


--
-- Name: basketball_slot_plan_season_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX basketball_slot_plan_season_date_idx ON public.basketball_slot_plan USING btree (season, date);


--
-- Name: basketplan_people_licence_nr_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX basketplan_people_licence_nr_idx ON public.basketplan_people USING btree (licence_nr);


--
-- Name: blocks_blocker_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX blocks_blocker_index ON public.blocks USING btree (blocker);


--
-- Name: city_hall_availability_weekday_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX city_hall_availability_weekday_idx ON public.city_hall_availability USING btree (weekday, season_start, season_end);


--
-- Name: country_codes_name_de_lower_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX country_codes_name_de_lower_idx ON public.country_codes USING btree (lower(name_de));


--
-- Name: country_codes_name_en_lower_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX country_codes_name_en_lower_idx ON public.country_codes USING btree (lower(name_en));


--
-- Name: event_sessions_event_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX event_sessions_event_index ON public.event_sessions USING btree (event);


--
-- Name: events_created_by_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX events_created_by_index ON public.events USING btree (created_by);


--
-- Name: events_hall_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX events_hall_index ON public.events USING btree (hall);


--
-- Name: events_members_pair_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX events_members_pair_uq ON public.events_members USING btree (events_id, members_id);


--
-- Name: events_teams_pair_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX events_teams_pair_uq ON public.events_teams USING btree (events_id, teams_id);


--
-- Name: finance_budget_lines_fy_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX finance_budget_lines_fy_idx ON public.finance_budget_lines USING btree (fiscal_year);


--
-- Name: finance_dues_rates_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX finance_dues_rates_uq ON public.finance_dues_rates USING btree (fiscal_year, lower((category)::text), COALESCE(sektion, ''::character varying));


--
-- Name: finance_dues_runs_fy_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX finance_dues_runs_fy_idx ON public.finance_dues_runs USING btree (fiscal_year);


--
-- Name: finance_dunning_notices_invoice_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX finance_dunning_notices_invoice_idx ON public.finance_dunning_notices USING btree (invoice);


--
-- Name: finance_email_jobs_one_running; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX finance_email_jobs_one_running ON public.finance_email_jobs USING btree (dues_run) WHERE ((status)::text = 'running'::text);


--
-- Name: finance_email_jobs_run_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX finance_email_jobs_run_idx ON public.finance_email_jobs USING btree (dues_run, id);


--
-- Name: finance_expenses_member_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX finance_expenses_member_idx ON public.finance_expenses USING btree (member);


--
-- Name: finance_expenses_section_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX finance_expenses_section_idx ON public.finance_expenses USING btree (section);


--
-- Name: finance_expenses_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX finance_expenses_status_idx ON public.finance_expenses USING btree (status);


--
-- Name: finance_imports_type_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX finance_imports_type_at_idx ON public.finance_imports USING btree (import_type, imported_at DESC);


--
-- Name: finance_imports_type_checksum_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX finance_imports_type_checksum_idx ON public.finance_imports USING btree (import_type, source_checksum);


--
-- Name: finance_invoice_documents_clubdesk_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX finance_invoice_documents_clubdesk_idx ON public.finance_invoice_documents USING btree (match_clubdesk_id) WHERE (match_clubdesk_id IS NOT NULL);


--
-- Name: finance_invoice_documents_file_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX finance_invoice_documents_file_idx ON public.finance_invoice_documents USING btree (file);


--
-- Name: finance_invoice_documents_invoice_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX finance_invoice_documents_invoice_idx ON public.finance_invoice_documents USING btree (invoice) WHERE (invoice IS NOT NULL);


--
-- Name: finance_invoice_member_overrides_clubdesk_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX finance_invoice_member_overrides_clubdesk_uidx ON public.finance_invoice_member_overrides USING btree (match_clubdesk_id) WHERE (match_clubdesk_id IS NOT NULL);


--
-- Name: finance_invoice_member_overrides_email_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX finance_invoice_member_overrides_email_uidx ON public.finance_invoice_member_overrides USING btree (lower((match_email)::text)) WHERE (match_email IS NOT NULL);


--
-- Name: finance_invoice_member_overrides_member_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX finance_invoice_member_overrides_member_idx ON public.finance_invoice_member_overrides USING btree (member);


--
-- Name: finance_invoices_due_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX finance_invoices_due_idx ON public.finance_invoices USING btree (due_date);


--
-- Name: finance_invoices_dues_fy_member_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX finance_invoices_dues_fy_member_idx ON public.finance_invoices USING btree (fiscal_year, member) WHERE ((dues_run IS NOT NULL) AND (member IS NOT NULL));


--
-- Name: finance_invoices_dues_run_member_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX finance_invoices_dues_run_member_uq ON public.finance_invoices USING btree (dues_run, member) WHERE ((dues_run IS NOT NULL) AND (member IS NOT NULL));


--
-- Name: finance_invoices_member_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX finance_invoices_member_status_idx ON public.finance_invoices USING btree (member, status);


--
-- Name: finance_invoices_native_overdue_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX finance_invoices_native_overdue_idx ON public.finance_invoices USING btree (due_date) WHERE (((source)::text = 'native'::text) AND ((status)::text = ANY (ARRAY[('open'::character varying)::text, ('partial'::character varying)::text])));


--
-- Name: finance_invoices_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX finance_invoices_status_idx ON public.finance_invoices USING btree (status);


--
-- Name: finance_invoices_team_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX finance_invoices_team_status_idx ON public.finance_invoices USING btree (team, status);


--
-- Name: finance_payments_camt_reference_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX finance_payments_camt_reference_uidx ON public.finance_payments USING btree (camt_reference) WHERE (camt_reference IS NOT NULL);


--
-- Name: finance_payments_invoice_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX finance_payments_invoice_idx ON public.finance_payments USING btree (invoice);


--
-- Name: finance_payments_match_clubdesk_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX finance_payments_match_clubdesk_id_idx ON public.finance_payments USING btree (match_clubdesk_id) WHERE (match_clubdesk_id IS NOT NULL);


--
-- Name: finance_payments_match_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX finance_payments_match_status_idx ON public.finance_payments USING btree (match_status);


--
-- Name: finance_payouts_member_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX finance_payouts_member_idx ON public.finance_payouts USING btree (member);


--
-- Name: finance_team_entries_team_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX finance_team_entries_team_idx ON public.finance_team_entries USING btree (team, fiscal_year);


--
-- Name: finance_transactions_clubdesk_id_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX finance_transactions_clubdesk_id_uidx ON public.finance_transactions USING btree (clubdesk_id) WHERE (clubdesk_id IS NOT NULL);


--
-- Name: finance_transactions_credit_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX finance_transactions_credit_idx ON public.finance_transactions USING btree (credit_account);


--
-- Name: finance_transactions_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX finance_transactions_date_idx ON public.finance_transactions USING btree (booking_date);


--
-- Name: finance_transactions_debit_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX finance_transactions_debit_idx ON public.finance_transactions USING btree (debit_account);


--
-- Name: finance_transactions_fy_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX finance_transactions_fy_idx ON public.finance_transactions USING btree (fiscal_year);


--
-- Name: finance_transactions_native_fy_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX finance_transactions_native_fy_idx ON public.finance_transactions USING btree (fiscal_year) WHERE ((source)::text = 'native'::text);


--
-- Name: finance_transactions_reversal_of_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX finance_transactions_reversal_of_uq ON public.finance_transactions USING btree (reversal_of) WHERE ((reversal_of IS NOT NULL) AND ((source)::text = 'native'::text));


--
-- Name: finance_tx_autopost_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX finance_tx_autopost_uidx ON public.finance_transactions USING btree (ref_kind, ref_id) WHERE ((auto = true) AND ((source)::text = 'native'::text));


--
-- Name: fine_rules_team_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX fine_rules_team_idx ON public.fine_rules USING btree (team);


--
-- Name: fines_engine_count_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX fines_engine_count_idx ON public.fines USING btree (team, member, category, status, issued_at);


--
-- Name: fines_member_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX fines_member_status_idx ON public.fines USING btree (member, status);


--
-- Name: fines_team_status_issued_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX fines_team_status_issued_idx ON public.fines USING btree (team, status, issued_at DESC);


--
-- Name: form_submissions_form_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX form_submissions_form_idx ON public.form_submissions USING btree (form);


--
-- Name: form_submissions_member_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX form_submissions_member_idx ON public.form_submissions USING btree (member);


--
-- Name: forms_created_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX forms_created_by_idx ON public.forms USING btree (created_by);


--
-- Name: forms_slug_unique_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX forms_slug_unique_idx ON public.forms USING btree (slug) WHERE (slug IS NOT NULL);


--
-- Name: forms_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX forms_status_idx ON public.forms USING btree (status);


--
-- Name: forms_teams_forms_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX forms_teams_forms_id_idx ON public.forms_teams USING btree (forms_id);


--
-- Name: forms_teams_pair_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX forms_teams_pair_uq ON public.forms_teams USING btree (forms_id, teams_id);


--
-- Name: forms_teams_teams_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX forms_teams_teams_id_idx ON public.forms_teams USING btree (teams_id);


--
-- Name: game_scheduling_bookings_opp_type_fixture_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX game_scheduling_bookings_opp_type_fixture_unique ON public.game_scheduling_bookings USING btree (opponent, type, svrz_game_id) WHERE (svrz_game_id IS NOT NULL);


--
-- Name: game_scheduling_bookings_opponent_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX game_scheduling_bookings_opponent_index ON public.game_scheduling_bookings USING btree (opponent);


--
-- Name: game_scheduling_bookings_slot_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX game_scheduling_bookings_slot_index ON public.game_scheduling_bookings USING btree (slot);


--
-- Name: game_scheduling_bookings_svrz_game_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX game_scheduling_bookings_svrz_game_id_index ON public.game_scheduling_bookings USING btree (svrz_game_id);


--
-- Name: game_scheduling_club_portals_token_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX game_scheduling_club_portals_token_unique ON public.game_scheduling_club_portals USING btree (token);


--
-- Name: game_scheduling_derbies_season_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX game_scheduling_derbies_season_idx ON public.game_scheduling_derbies USING btree (season);


--
-- Name: game_scheduling_derbies_team_a_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX game_scheduling_derbies_team_a_idx ON public.game_scheduling_derbies USING btree (team_a) WHERE confirmed;


--
-- Name: game_scheduling_derbies_team_b_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX game_scheduling_derbies_team_b_idx ON public.game_scheduling_derbies USING btree (team_b) WHERE confirmed;


--
-- Name: game_scheduling_opponents_away_game_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX game_scheduling_opponents_away_game_index ON public.game_scheduling_opponents USING btree (away_game);


--
-- Name: game_scheduling_opponents_home_game_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX game_scheduling_opponents_home_game_index ON public.game_scheduling_opponents USING btree (home_game);


--
-- Name: game_scheduling_opponents_kscw_team_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX game_scheduling_opponents_kscw_team_index ON public.game_scheduling_opponents USING btree (kscw_team);


--
-- Name: game_scheduling_opponents_season_club_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX game_scheduling_opponents_season_club_idx ON public.game_scheduling_opponents USING btree (season, club_id);


--
-- Name: game_scheduling_slots_hall_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX game_scheduling_slots_hall_index ON public.game_scheduling_slots USING btree (hall);


--
-- Name: game_scheduling_slots_kscw_team_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX game_scheduling_slots_kscw_team_index ON public.game_scheduling_slots USING btree (kscw_team);


--
-- Name: games_bb_24s_duty_team_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX games_bb_24s_duty_team_index ON public.games USING btree (bb_24s_duty_team);


--
-- Name: games_bb_24s_official_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX games_bb_24s_official_index ON public.games USING btree (bb_24s_official);


--
-- Name: games_bb_duty_team_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX games_bb_duty_team_index ON public.games USING btree (bb_duty_team);


--
-- Name: games_bb_scorer_duty_team_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX games_bb_scorer_duty_team_index ON public.games USING btree (bb_scorer_duty_team);


--
-- Name: games_bb_scorer_member_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX games_bb_scorer_member_index ON public.games USING btree (bb_scorer_member);


--
-- Name: games_bb_timekeeper_duty_team_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX games_bb_timekeeper_duty_team_index ON public.games USING btree (bb_timekeeper_duty_team);


--
-- Name: games_bb_timekeeper_member_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX games_bb_timekeeper_member_index ON public.games USING btree (bb_timekeeper_member);


--
-- Name: games_gameid_team_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX games_gameid_team_uq ON public.games USING btree (game_id, kscw_team) WHERE ((game_id IS NOT NULL) AND (kscw_team IS NOT NULL));


--
-- Name: games_hall_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX games_hall_index ON public.games USING btree (hall);


--
-- Name: games_kscw_team_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX games_kscw_team_index ON public.games USING btree (kscw_team);


--
-- Name: games_scoreboard_duty_team_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX games_scoreboard_duty_team_index ON public.games USING btree (scoreboard_duty_team);


--
-- Name: games_scoreboard_member_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX games_scoreboard_member_index ON public.games USING btree (scoreboard_member);


--
-- Name: games_scorer_duty_team_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX games_scorer_duty_team_index ON public.games USING btree (scorer_duty_team);


--
-- Name: games_scorer_member_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX games_scorer_member_index ON public.games USING btree (scorer_member);


--
-- Name: games_scorer_scoreboard_duty_team_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX games_scorer_scoreboard_duty_team_index ON public.games USING btree (scorer_scoreboard_duty_team);


--
-- Name: games_scorer_scoreboard_member_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX games_scorer_scoreboard_member_index ON public.games USING btree (scorer_scoreboard_member);


--
-- Name: hall_closures_hall_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX hall_closures_hall_index ON public.hall_closures USING btree (hall);


--
-- Name: hall_events_uid_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX hall_events_uid_uq ON public.hall_events USING btree (uid) WHERE (uid IS NOT NULL);


--
-- Name: hall_slots_hall_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX hall_slots_hall_index ON public.hall_slots USING btree (hall);


--
-- Name: hall_slots_teams_pair_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX hall_slots_teams_pair_uq ON public.hall_slots_teams USING btree (hall_slots_id, teams_id);


--
-- Name: idx_absences_last_edited_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_absences_last_edited_by ON public.absences USING btree (last_edited_by) WHERE (last_edited_by IS NOT NULL);


--
-- Name: idx_blocks_blocked; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_blocks_blocked ON public.blocks USING btree (blocked);


--
-- Name: idx_broadcasts_activity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_broadcasts_activity ON public.broadcasts USING btree (activity_type, activity_id, sent_at DESC);


--
-- Name: idx_broadcasts_sender; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_broadcasts_sender ON public.broadcasts USING btree (sender, sent_at DESC);


--
-- Name: idx_bugfix_jobs_hash; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_bugfix_jobs_hash ON public.bugfix_jobs USING btree (error_hash);


--
-- Name: idx_bugfix_jobs_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bugfix_jobs_status ON public.bugfix_jobs USING btree (status);


--
-- Name: idx_clubdesk_export_clubdesk_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_clubdesk_export_clubdesk_id ON public.clubdesk_export USING btree (clubdesk_id);


--
-- Name: idx_clubdesk_export_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_clubdesk_export_email ON public.clubdesk_export USING btree (lower(email));


--
-- Name: idx_clubdesk_export_email_alt; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_clubdesk_export_email_alt ON public.clubdesk_export USING btree (lower(email_alternativ));


--
-- Name: idx_clubdesk_export_lic; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_clubdesk_export_lic ON public.clubdesk_export USING btree (lizenznummer);


--
-- Name: idx_clubdesk_export_sektion; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_clubdesk_export_sektion ON public.clubdesk_export USING btree (sektion);


--
-- Name: idx_conv_members_conv; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_conv_members_conv ON public.conversation_members USING btree (conversation) WHERE (archived = false);


--
-- Name: idx_conv_members_member; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_conv_members_member ON public.conversation_members USING btree (member);


--
-- Name: idx_conversations_last_msg; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_conversations_last_msg ON public.conversations USING btree (last_message_at DESC NULLS LAST);


--
-- Name: idx_conversations_team; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_conversations_team ON public.conversations USING btree (team) WHERE (team IS NOT NULL);


--
-- Name: idx_error_annotations_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_error_annotations_date ON public.error_annotations USING btree (error_date);


--
-- Name: idx_error_annotations_hash; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_error_annotations_hash ON public.error_annotations USING btree (error_hash);


--
-- Name: idx_error_annotations_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_error_annotations_status ON public.error_annotations USING btree (status);


--
-- Name: idx_error_mute_rules_enabled; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_error_mute_rules_enabled ON public.error_mute_rules USING btree (enabled);


--
-- Name: idx_event_signups_email_lower; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_event_signups_email_lower ON public.event_signups USING btree (lower((email)::text));


--
-- Name: idx_event_signups_event; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_event_signups_event ON public.event_signups USING btree (event);


--
-- Name: idx_event_signups_form_slug; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_event_signups_form_slug ON public.event_signups USING btree (form_slug);


--
-- Name: idx_game_rosters_game; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_game_rosters_game ON public.game_rosters USING btree (game);


--
-- Name: idx_game_rosters_game_member; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_game_rosters_game_member ON public.game_rosters USING btree (game, member) WHERE (member IS NOT NULL);


--
-- Name: idx_games_nomination_pending; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_games_nomination_pending ON public.games USING btree (date, "time") WHERE (((status)::text = 'scheduled'::text) AND ((COALESCE(vm_nomination_status, ''::character varying))::text <> ALL ((ARRAY['closed'::character varying, 'skipped'::character varying])::text[])));


--
-- Name: idx_identity_document_keys_recipient; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_identity_document_keys_recipient ON public.identity_document_keys USING btree (recipient);


--
-- Name: idx_messages_conv_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_messages_conv_created ON public.messages USING btree (conversation, created_at DESC);


--
-- Name: idx_messages_deleted; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_messages_deleted ON public.messages USING btree (deleted_at) WHERE (deleted_at IS NOT NULL);


--
-- Name: idx_messages_sender; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_messages_sender ON public.messages USING btree (sender);


--
-- Name: idx_msg_requests_recipient_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_msg_requests_recipient_status ON public.message_requests USING btree (recipient, status);


--
-- Name: idx_participations_auto_declined_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_participations_auto_declined_by ON public.participations USING btree (auto_declined_by) WHERE (auto_declined_by IS NOT NULL);


--
-- Name: idx_participations_auto_declined_by_game; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_participations_auto_declined_by_game ON public.participations USING btree (auto_declined_by_game) WHERE (auto_declined_by_game IS NOT NULL);


--
-- Name: idx_participations_last_note_edited_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_participations_last_note_edited_by ON public.participations USING btree (last_note_edited_by) WHERE (last_note_edited_by IS NOT NULL);


--
-- Name: idx_participations_last_status_edited_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_participations_last_status_edited_by ON public.participations USING btree (last_status_edited_by) WHERE (last_status_edited_by IS NOT NULL);


--
-- Name: idx_password_reset_tokens_expires; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_password_reset_tokens_expires ON public.password_reset_tokens USING btree (expires_at);


--
-- Name: idx_password_reset_tokens_hash; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_password_reset_tokens_hash ON public.password_reset_tokens USING btree (token_hash);


--
-- Name: idx_reports_reported_member; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reports_reported_member ON public.reports USING btree (reported_member);


--
-- Name: idx_reports_status_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reports_status_created ON public.reports USING btree (status, created_at DESC);


--
-- Name: idx_signup_tokens_expires; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_signup_tokens_expires ON public.signup_tokens USING btree (expires_at);


--
-- Name: idx_signup_tokens_hash; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_signup_tokens_hash ON public.signup_tokens USING btree (token_hash);


--
-- Name: idx_slot_claims_active_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_slot_claims_active_unique ON public.slot_claims USING btree (hall_slot, date) WHERE ((status)::text = 'active'::text);


--
-- Name: idx_spielplaner_assignments_kscw_team; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_spielplaner_assignments_kscw_team ON public.spielplaner_assignments USING btree (kscw_team);


--
-- Name: idx_trainings_auto_cancelled_by_closure; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trainings_auto_cancelled_by_closure ON public.trainings USING btree (auto_cancelled_by_closure) WHERE (auto_cancelled_by_closure IS NOT NULL);


--
-- Name: idx_trainings_auto_cancelled_by_trial; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trainings_auto_cancelled_by_trial ON public.trainings USING btree (auto_cancelled_by_trial) WHERE (auto_cancelled_by_trial IS NOT NULL);


--
-- Name: member_teams_member_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX member_teams_member_index ON public.member_teams USING btree (member);


--
-- Name: member_teams_team_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX member_teams_team_index ON public.member_teams USING btree (team);


--
-- Name: members_clubdesk_id_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX members_clubdesk_id_uq ON public.members USING btree (clubdesk_id) WHERE (clubdesk_id IS NOT NULL);


--
-- Name: members_clubdesk_push_pending_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX members_clubdesk_push_pending_idx ON public.members USING btree (clubdesk_push_pending) WHERE clubdesk_push_pending;


--
-- Name: members_ical_token_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX members_ical_token_key ON public.members USING btree (ical_token);


--
-- Name: members_in_vis_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX members_in_vis_idx ON public.members USING btree (in_vis) WHERE (in_vis IS NOT NULL);


--
-- Name: members_license_nr_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX members_license_nr_uq ON public.members USING btree (license_nr) WHERE (license_nr IS NOT NULL);


--
-- Name: members_requested_team_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX members_requested_team_index ON public.members USING btree (requested_team);


--
-- Name: members_transfer_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX members_transfer_status_idx ON public.members USING btree (transfer_status) WHERE (transfer_status IS NOT NULL);


--
-- Name: members_user_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX members_user_index ON public.members USING btree ("user");


--
-- Name: members_user_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX members_user_uq ON public.members USING btree ("user") WHERE ("user" IS NOT NULL);


--
-- Name: members_uuid_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX members_uuid_unique ON public.members USING btree (uuid);


--
-- Name: members_vm_email_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX members_vm_email_uq ON public.members USING btree (vm_email) WHERE (vm_email IS NOT NULL);


--
-- Name: message_reactions_member_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX message_reactions_member_index ON public.message_reactions USING btree (member);


--
-- Name: message_reactions_message_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX message_reactions_message_index ON public.message_reactions USING btree (message);


--
-- Name: message_requests_conversation_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX message_requests_conversation_index ON public.message_requests USING btree (conversation);


--
-- Name: message_requests_recipient_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX message_requests_recipient_index ON public.message_requests USING btree (recipient);


--
-- Name: message_requests_sender_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX message_requests_sender_index ON public.message_requests USING btree (sender);


--
-- Name: notifications_member_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notifications_member_index ON public.notifications USING btree (member);


--
-- Name: notifications_team_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notifications_team_index ON public.notifications USING btree (team);


--
-- Name: participations_activity_member_session_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX participations_activity_member_session_uq ON public.participations USING btree (activity_type, activity_id, member, session_id) WHERE (session_id IS NOT NULL);


--
-- Name: participations_activity_member_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX participations_activity_member_uq ON public.participations USING btree (activity_type, activity_id, member) WHERE (session_id IS NULL);


--
-- Name: participations_member_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX participations_member_index ON public.participations USING btree (member);


--
-- Name: poll_votes_member_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX poll_votes_member_index ON public.poll_votes USING btree (member);


--
-- Name: poll_votes_poll_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX poll_votes_poll_index ON public.poll_votes USING btree (poll);


--
-- Name: polls_created_by_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX polls_created_by_index ON public.polls USING btree (created_by);


--
-- Name: polls_team_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX polls_team_index ON public.polls USING btree (team);


--
-- Name: push_subscriptions_member_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX push_subscriptions_member_index ON public.push_subscriptions USING btree (member);


--
-- Name: rankings_team_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX rankings_team_index ON public.rankings USING btree (team);


--
-- Name: rankings_team_league_season_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX rankings_team_league_season_uniq ON public.rankings USING btree (team_id, league, season);


--
-- Name: referee_expenses_game_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX referee_expenses_game_index ON public.referee_expenses USING btree (game);


--
-- Name: referee_expenses_paid_by_member_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX referee_expenses_paid_by_member_index ON public.referee_expenses USING btree (paid_by_member);


--
-- Name: referee_expenses_recorded_by_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX referee_expenses_recorded_by_index ON public.referee_expenses USING btree (recorded_by);


--
-- Name: referee_expenses_team_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX referee_expenses_team_index ON public.referee_expenses USING btree (team);


--
-- Name: registrations_member_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX registrations_member_idx ON public.registrations USING btree (member);


--
-- Name: reports_conversation_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX reports_conversation_index ON public.reports USING btree (conversation);


--
-- Name: reports_message_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX reports_message_index ON public.reports USING btree (message);


--
-- Name: reports_reporter_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX reports_reporter_index ON public.reports USING btree (reporter);


--
-- Name: reports_resolved_by_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX reports_resolved_by_index ON public.reports USING btree (resolved_by);


--
-- Name: scheduling_blocks_team_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX scheduling_blocks_team_idx ON public.scheduling_blocks USING btree (team);


--
-- Name: scheduling_blocks_team_range_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX scheduling_blocks_team_range_idx ON public.scheduling_blocks USING btree (team, start_date, end_date);


--
-- Name: scheduling_email_reads_member_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX scheduling_email_reads_member_idx ON public.scheduling_email_reads USING btree (member, email);


--
-- Name: scheduling_emails_date_sent_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX scheduling_emails_date_sent_idx ON public.scheduling_emails USING btree (date_sent DESC NULLS LAST);


--
-- Name: scheduling_emails_group_repost_pending_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX scheduling_emails_group_repost_pending_idx ON public.scheduling_emails USING btree (account, date_sent) WHERE ((group_reposted_at IS NULL) AND ((direction)::text = 'in'::text));


--
-- Name: scheduling_emails_unread_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX scheduling_emails_unread_idx ON public.scheduling_emails USING btree (account, direction) WHERE (read_at IS NULL);


--
-- Name: scheduling_global_blocks_range_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX scheduling_global_blocks_range_idx ON public.scheduling_global_blocks USING btree (start_date, end_date);


--
-- Name: scorer_delegations_from_member_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX scorer_delegations_from_member_index ON public.scorer_delegations USING btree (from_member);


--
-- Name: scorer_delegations_from_team_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX scorer_delegations_from_team_index ON public.scorer_delegations USING btree (from_team);


--
-- Name: scorer_delegations_game_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX scorer_delegations_game_index ON public.scorer_delegations USING btree (game);


--
-- Name: scorer_delegations_to_member_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX scorer_delegations_to_member_index ON public.scorer_delegations USING btree (to_member);


--
-- Name: scorer_delegations_to_team_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX scorer_delegations_to_team_index ON public.scorer_delegations USING btree (to_team);


--
-- Name: slot_claims_claimed_by_member_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX slot_claims_claimed_by_member_index ON public.slot_claims USING btree (claimed_by_member);


--
-- Name: slot_claims_claimed_by_team_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX slot_claims_claimed_by_team_index ON public.slot_claims USING btree (claimed_by_team);


--
-- Name: slot_claims_hall_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX slot_claims_hall_index ON public.slot_claims USING btree (hall);


--
-- Name: slot_claims_hall_slot_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX slot_claims_hall_slot_index ON public.slot_claims USING btree (hall_slot);


--
-- Name: svrz_games_svrz_number_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX svrz_games_svrz_number_uq ON public.svrz_games USING btree (svrz_number) WHERE (svrz_number IS NOT NULL);


--
-- Name: team_invites_claimed_by_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX team_invites_claimed_by_index ON public.team_invites USING btree (claimed_by);


--
-- Name: team_invites_invited_by_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX team_invites_invited_by_index ON public.team_invites USING btree (invited_by);


--
-- Name: team_invites_team_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX team_invites_team_index ON public.team_invites USING btree (team);


--
-- Name: team_links_season_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX team_links_season_idx ON public.team_links USING btree (season);


--
-- Name: teams_coaches_pair_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX teams_coaches_pair_uq ON public.teams_coaches USING btree (teams_id, members_id);


--
-- Name: teams_responsibles_pair_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX teams_responsibles_pair_uq ON public.teams_responsibles USING btree (teams_id, members_id);


--
-- Name: teams_sponsors_pair_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX teams_sponsors_pair_uq ON public.teams_sponsors USING btree (teams_id, sponsors_id);


--
-- Name: training_slot_skips_slot_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX training_slot_skips_slot_idx ON public.training_slot_skips USING btree (hall_slot);


--
-- Name: trainings_hall_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX trainings_hall_index ON public.trainings USING btree (hall);


--
-- Name: trainings_hall_slot_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX trainings_hall_slot_index ON public.trainings USING btree (hall_slot);


--
-- Name: trainings_is_trial_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX trainings_is_trial_idx ON public.trainings USING btree (is_trial) WHERE (is_trial = true);


--
-- Name: trainings_team_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX trainings_team_index ON public.trainings USING btree (team);


--
-- Name: uq_blocks_blocker_blocked; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_blocks_blocker_blocked ON public.blocks USING btree (blocker, blocked);


--
-- Name: uq_conv_members_conv_member; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_conv_members_conv_member ON public.conversation_members USING btree (conversation, member);


--
-- Name: uq_conversations_one_per_activity; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_conversations_one_per_activity ON public.conversations USING btree (activity_type, activity_id) WHERE ((type)::text = 'activity_chat'::text);


--
-- Name: uq_conversations_one_per_team; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_conversations_one_per_team ON public.conversations USING btree (team) WHERE (((type)::text = 'team'::text) AND (team IS NOT NULL));


--
-- Name: uq_msg_requests_conv; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_msg_requests_conv ON public.message_requests USING btree (conversation);


--
-- Name: uq_reactions_msg_member_emoji; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_reactions_msg_member_emoji ON public.message_reactions USING btree (message, member, emoji);


--
-- Name: user_logs_collection_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_logs_collection_date_idx ON public.user_logs USING btree (collection_name, date_created DESC);


--
-- Name: user_logs_date_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_logs_date_created_idx ON public.user_logs USING btree (date_created DESC);


--
-- Name: user_logs_user_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_logs_user_index ON public.user_logs USING btree ("user");


--
-- Name: vb_referee_duty_referee_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX vb_referee_duty_referee_idx ON public.vb_referee_duty USING btree (referee);


--
-- Name: vb_referee_duty_team_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX vb_referee_duty_team_idx ON public.vb_referee_duty USING btree (team);


--
-- Name: vis_federations_iso_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX vis_federations_iso_idx ON public.vis_federations USING btree (iso);


--
-- Name: vis_transfers_name_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX vis_transfers_name_idx ON public.vis_transfers USING btree (lower(player_last_name), lower(player_first_name));


--
-- Name: vis_transfers_season_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX vis_transfers_season_idx ON public.vis_transfers USING btree (season_no);


--
-- Name: stats_team_roster _RETURN; Type: RULE; Schema: public; Owner: -
--

CREATE OR REPLACE VIEW public.stats_team_roster WITH (security_invoker='true') AS
 SELECT t.id AS team_id,
    t.name AS team_name,
    t.sport,
    t.league,
    t.active AS team_active,
    count(DISTINCT mt.member) FILTER (WHERE (mt.guest_level = 0)) AS roster_size,
    count(DISTINCT mt.member) FILTER (WHERE ((mt.guest_level = 0) AND (m.wiedisync_active = true))) AS active_roster_size,
    count(DISTINCT mt.member) FILTER (WHERE (mt.guest_level > 0)) AS guest_count,
    count(DISTINCT mt.member) FILTER (WHERE ((mt.guest_level = 0) AND m.scorer_vb)) AS lic_scorer_vb,
    count(DISTINCT mt.member) FILTER (WHERE ((mt.guest_level = 0) AND m.referee_vb)) AS lic_referee_vb,
    count(DISTINCT mt.member) FILTER (WHERE ((mt.guest_level = 0) AND m.otr1_bb)) AS lic_otr1_bb,
    count(DISTINCT mt.member) FILTER (WHERE ((mt.guest_level = 0) AND m.otr2_bb)) AS lic_otr2_bb,
    count(DISTINCT mt.member) FILTER (WHERE ((mt.guest_level = 0) AND m.referee_bb)) AS lic_referee_bb,
    ( SELECT count(*) AS count
           FROM public.teams_coaches tc
          WHERE (tc.teams_id = t.id)) AS coach_count,
        CASE
            WHEN (t.captain IS NOT NULL) THEN 1
            ELSE 0
        END AS captain_count,
    ( SELECT count(*) AS count
           FROM public.teams_responsibles tc
          WHERE (tc.teams_id = t.id)) AS team_responsible_count
   FROM ((public.teams t
     LEFT JOIN public.member_teams mt ON ((mt.team = t.id)))
     LEFT JOIN public.members m ON ((m.id = mt.member)))
  WHERE (t.active = true)
  GROUP BY t.id, t.name, t.sport, t.league, t.active;


--
-- Name: form_submissions form_submissions_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER form_submissions_guard BEFORE INSERT ON public.form_submissions FOR EACH ROW EXECUTE FUNCTION public.trg_form_submissions_guard();


--
-- Name: form_submissions form_submissions_update_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER form_submissions_update_guard BEFORE UPDATE ON public.form_submissions FOR EACH ROW EXECUTE FUNCTION public.trg_form_submissions_update_guard();


--
-- Name: members members_sync_nationality_trg; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER members_sync_nationality_trg BEFORE INSERT OR UPDATE OF nationalitaet, nationalitaet_codes ON public.members FOR EACH ROW EXECUTE FUNCTION public.members_sync_nationality();


--
-- Name: absences trg_absences_normalize_indefinite; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_absences_normalize_indefinite BEFORE INSERT OR UPDATE ON public.absences FOR EACH ROW EXECUTE FUNCTION public.trg_absences_normalize_indefinite();


--
-- Name: events trg_activity_chat_event_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_activity_chat_event_delete AFTER DELETE ON public.events FOR EACH ROW EXECUTE FUNCTION public.fn_activity_chat_event_delete();


--
-- Name: events trg_events_0_purge_polymorphic; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_events_0_purge_polymorphic AFTER DELETE ON public.events FOR EACH ROW EXECUTE FUNCTION public.trg_activity_purge_polymorphic('event');


--
-- Name: events trg_events_notify; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_events_notify AFTER INSERT OR DELETE OR UPDATE ON public.events FOR EACH ROW EXECUTE FUNCTION public.trg_events_notify();


--
-- Name: finance_transactions trg_finance_native_txn_lock; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_finance_native_txn_lock BEFORE INSERT OR DELETE OR UPDATE ON public.finance_transactions FOR EACH ROW EXECUTE FUNCTION public.finance_native_txn_lock();


--
-- Name: games trg_games_0_purge_polymorphic; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_games_0_purge_polymorphic AFTER DELETE ON public.games FOR EACH ROW EXECUTE FUNCTION public.trg_activity_purge_polymorphic('game');


--
-- Name: games trg_games_notify; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_games_notify AFTER INSERT OR DELETE OR UPDATE ON public.games FOR EACH ROW EXECUTE FUNCTION public.trg_games_notify();


--
-- Name: halls trg_halls_protect_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_halls_protect_delete BEFORE DELETE ON public.halls FOR EACH ROW EXECUTE FUNCTION public.trg_protect_hall_delete();


--
-- Name: halls trg_halls_reject_vm_combo; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_halls_reject_vm_combo BEFORE INSERT OR UPDATE ON public.halls FOR EACH ROW EXECUTE FUNCTION public.trg_halls_reject_vm_combo();


--
-- Name: members trg_members_coach_approval_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_members_coach_approval_guard BEFORE UPDATE ON public.members FOR EACH ROW EXECUTE FUNCTION public.trg_members_coach_approval_guard();


--
-- Name: members trg_members_prevent_email_blanking; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_members_prevent_email_blanking BEFORE UPDATE OF email ON public.members FOR EACH ROW WHEN (((old.email)::text IS DISTINCT FROM (new.email)::text)) EXECUTE FUNCTION public.members_prevent_email_blanking();


--
-- Name: members trg_members_shell_convert; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_members_shell_convert BEFORE UPDATE ON public.members FOR EACH ROW EXECUTE FUNCTION public.trg_members_shell_convert();


--
-- Name: member_teams trg_messaging_dm_autoaccept; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_messaging_dm_autoaccept AFTER INSERT ON public.member_teams FOR EACH ROW EXECUTE FUNCTION public.fn_messaging_dm_autoaccept();


--
-- Name: members trg_messaging_member_team_chat_enabled; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_messaging_member_team_chat_enabled AFTER UPDATE OF communications_team_chat_enabled ON public.members FOR EACH ROW EXECUTE FUNCTION public.fn_messaging_member_team_chat_enabled();


--
-- Name: members trg_messaging_protect_sentinel; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_messaging_protect_sentinel BEFORE DELETE ON public.members FOR EACH ROW EXECUTE FUNCTION public.messaging_protect_sentinel();


--
-- Name: teams trg_messaging_teams_insert; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_messaging_teams_insert AFTER INSERT ON public.teams FOR EACH ROW EXECUTE FUNCTION public.fn_messaging_teams_insert();


--
-- Name: member_teams trg_messaging_teams_members_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_messaging_teams_members_delete AFTER DELETE ON public.member_teams FOR EACH ROW EXECUTE FUNCTION public.fn_messaging_teams_members_delete();


--
-- Name: member_teams trg_messaging_teams_members_insert; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_messaging_teams_members_insert AFTER INSERT ON public.member_teams FOR EACH ROW EXECUTE FUNCTION public.fn_messaging_teams_members_insert();


--
-- Name: participations trg_participations_activity_chat_sync; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_participations_activity_chat_sync AFTER INSERT OR DELETE OR UPDATE ON public.participations FOR EACH ROW EXECUTE FUNCTION public.fn_participations_activity_chat_sync();


--
-- Name: participations trg_participations_clear_auto_marker; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_participations_clear_auto_marker BEFORE UPDATE ON public.participations FOR EACH ROW EXECUTE FUNCTION public.trg_participations_clear_auto_marker();


--
-- Name: participations trg_participations_guest_block; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_participations_guest_block BEFORE INSERT OR UPDATE ON public.participations FOR EACH ROW EXECUTE FUNCTION public.trg_participations_guest_block();


--
-- Name: scorer_delegations trg_scorer_delegation_freeze_identity; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_scorer_delegation_freeze_identity BEFORE UPDATE ON public.scorer_delegations FOR EACH ROW EXECUTE FUNCTION public.trg_scorer_delegation_freeze_identity();


--
-- Name: scorer_delegations trg_scorer_delegation_validate; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_scorer_delegation_validate BEFORE INSERT ON public.scorer_delegations FOR EACH ROW EXECUTE FUNCTION public.trg_scorer_delegation_validate();


--
-- Name: slot_claims trg_slot_claims_validate; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_slot_claims_validate BEFORE INSERT OR UPDATE ON public.slot_claims FOR EACH ROW EXECUTE FUNCTION public.trg_slot_claims_validate();


--
-- Name: teams_coaches trg_staff_gratis_coaches; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_staff_gratis_coaches AFTER INSERT ON public.teams_coaches FOR EACH ROW EXECUTE FUNCTION public.staff_gratis_fill();


--
-- Name: teams_responsibles trg_staff_gratis_responsibles; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_staff_gratis_responsibles AFTER INSERT ON public.teams_responsibles FOR EACH ROW EXECUTE FUNCTION public.staff_gratis_fill();


--
-- Name: teams trg_teams_protect_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_teams_protect_delete BEFORE DELETE ON public.teams FOR EACH ROW EXECUTE FUNCTION public.trg_protect_team_delete();


--
-- Name: teams trg_teams_release_derby_host; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_teams_release_derby_host BEFORE DELETE ON public.teams FOR EACH ROW EXECUTE FUNCTION public.trg_teams_release_derby_host();


--
-- Name: trainings trg_trainings_0_purge_polymorphic; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_trainings_0_purge_polymorphic AFTER DELETE ON public.trainings FOR EACH ROW EXECUTE FUNCTION public.trg_activity_purge_polymorphic('training');


--
-- Name: trainings trg_trainings_clear_auto_cancel_marker; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_trainings_clear_auto_cancel_marker BEFORE UPDATE ON public.trainings FOR EACH ROW EXECUTE FUNCTION public.trg_trainings_clear_auto_cancel_marker();


--
-- Name: trainings trg_trainings_notify; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_trainings_notify AFTER INSERT OR DELETE OR UPDATE ON public.trainings FOR EACH ROW EXECUTE FUNCTION public.trg_trainings_notify();


--
-- Name: trainings trg_trainings_revoke_claims; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_trainings_revoke_claims AFTER UPDATE ON public.trainings FOR EACH ROW EXECUTE FUNCTION public.trg_trainings_revoke_claims();


--
-- Name: trainings trg_trainings_trial_transform; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_trainings_trial_transform AFTER INSERT ON public.trainings FOR EACH ROW EXECUTE FUNCTION public.trg_trainings_trial_transform();


--
-- Name: absences absences_last_edited_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.absences
    ADD CONSTRAINT absences_last_edited_by_fkey FOREIGN KEY (last_edited_by) REFERENCES public.directus_users(id) ON DELETE SET NULL;


--
-- Name: absences absences_member_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.absences
    ADD CONSTRAINT absences_member_foreign FOREIGN KEY (member) REFERENCES public.members(id) ON DELETE CASCADE;


--
-- Name: announcement_recipients announcement_recipients_announcement_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.announcement_recipients
    ADD CONSTRAINT announcement_recipients_announcement_fkey FOREIGN KEY (announcement) REFERENCES public.announcements(id) ON DELETE CASCADE;


--
-- Name: announcement_recipients announcement_recipients_member_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.announcement_recipients
    ADD CONSTRAINT announcement_recipients_member_fkey FOREIGN KEY (member) REFERENCES public.members(id) ON DELETE CASCADE;


--
-- Name: announcements announcements_created_by_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.announcements
    ADD CONSTRAINT announcements_created_by_foreign FOREIGN KEY (created_by) REFERENCES public.members(id) ON DELETE SET NULL;


--
-- Name: announcements announcements_image_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.announcements
    ADD CONSTRAINT announcements_image_foreign FOREIGN KEY (image) REFERENCES public.directus_files(id) ON DELETE SET NULL;


--
-- Name: basketball_hall_availability basketball_hall_availability_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.basketball_hall_availability
    ADD CONSTRAINT basketball_hall_availability_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.members(id) ON DELETE SET NULL;


--
-- Name: basketball_hall_availability basketball_hall_availability_season_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.basketball_hall_availability
    ADD CONSTRAINT basketball_hall_availability_season_fkey FOREIGN KEY (season) REFERENCES public.game_scheduling_seasons(id) ON DELETE CASCADE;


--
-- Name: basketball_hall_availability basketball_hall_availability_team_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.basketball_hall_availability
    ADD CONSTRAINT basketball_hall_availability_team_fkey FOREIGN KEY (team) REFERENCES public.teams(id) ON DELETE CASCADE;


--
-- Name: basketball_slot_plan basketball_slot_plan_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.basketball_slot_plan
    ADD CONSTRAINT basketball_slot_plan_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.members(id) ON DELETE SET NULL;


--
-- Name: basketball_slot_plan basketball_slot_plan_kscw_team_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.basketball_slot_plan
    ADD CONSTRAINT basketball_slot_plan_kscw_team_fkey FOREIGN KEY (kscw_team) REFERENCES public.teams(id) ON DELETE SET NULL;


--
-- Name: basketball_slot_plan basketball_slot_plan_season_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.basketball_slot_plan
    ADD CONSTRAINT basketball_slot_plan_season_fkey FOREIGN KEY (season) REFERENCES public.game_scheduling_seasons(id) ON DELETE CASCADE;


--
-- Name: team_links basketball_team_links_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_links
    ADD CONSTRAINT basketball_team_links_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.members(id) ON DELETE SET NULL;


--
-- Name: team_links basketball_team_links_season_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_links
    ADD CONSTRAINT basketball_team_links_season_fkey FOREIGN KEY (season) REFERENCES public.game_scheduling_seasons(id) ON DELETE CASCADE;


--
-- Name: team_links basketball_team_links_team_a_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_links
    ADD CONSTRAINT basketball_team_links_team_a_fkey FOREIGN KEY (team_a) REFERENCES public.teams(id) ON DELETE CASCADE;


--
-- Name: team_links basketball_team_links_team_b_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_links
    ADD CONSTRAINT basketball_team_links_team_b_fkey FOREIGN KEY (team_b) REFERENCES public.teams(id) ON DELETE CASCADE;


--
-- Name: blocks blocks_blocked_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.blocks
    ADD CONSTRAINT blocks_blocked_foreign FOREIGN KEY (blocked) REFERENCES public.members(id) ON DELETE CASCADE;


--
-- Name: blocks blocks_blocker_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.blocks
    ADD CONSTRAINT blocks_blocker_foreign FOREIGN KEY (blocker) REFERENCES public.members(id) ON DELETE CASCADE;


--
-- Name: broadcasts broadcasts_sender_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.broadcasts
    ADD CONSTRAINT broadcasts_sender_fkey FOREIGN KEY (sender) REFERENCES public.members(id) ON DELETE SET NULL;


--
-- Name: city_hall_availability city_hall_availability_einrichtung_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.city_hall_availability
    ADD CONSTRAINT city_hall_availability_einrichtung_id_fkey FOREIGN KEY (einrichtung_id) REFERENCES public.city_halls(einrichtung_id) ON DELETE CASCADE;


--
-- Name: conversation_members conversation_members_conversation_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_members
    ADD CONSTRAINT conversation_members_conversation_foreign FOREIGN KEY (conversation) REFERENCES public.conversations(id) ON DELETE CASCADE;


--
-- Name: conversation_members conversation_members_member_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_members
    ADD CONSTRAINT conversation_members_member_foreign FOREIGN KEY (member) REFERENCES public.members(id) ON DELETE CASCADE;


--
-- Name: conversations conversations_created_by_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_created_by_foreign FOREIGN KEY (created_by) REFERENCES public.members(id) ON DELETE SET NULL;


--
-- Name: conversations conversations_team_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_team_foreign FOREIGN KEY (team) REFERENCES public.teams(id) ON DELETE CASCADE;


--
-- Name: country_name_aliases country_name_aliases_code_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.country_name_aliases
    ADD CONSTRAINT country_name_aliases_code_fkey FOREIGN KEY (code) REFERENCES public.country_codes(code) ON DELETE CASCADE;


--
-- Name: error_mute_rules error_mute_rules_user_created_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.error_mute_rules
    ADD CONSTRAINT error_mute_rules_user_created_fkey FOREIGN KEY (user_created) REFERENCES public.directus_users(id) ON DELETE SET NULL;


--
-- Name: event_sessions event_sessions_event_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_sessions
    ADD CONSTRAINT event_sessions_event_foreign FOREIGN KEY (event) REFERENCES public.events(id) ON DELETE CASCADE;


--
-- Name: event_signups event_signups_event_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_signups
    ADD CONSTRAINT event_signups_event_fkey FOREIGN KEY (event) REFERENCES public.events(id) ON DELETE CASCADE;


--
-- Name: event_signups event_signups_member_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_signups
    ADD CONSTRAINT event_signups_member_fkey FOREIGN KEY (member) REFERENCES public.members(id) ON DELETE SET NULL;


--
-- Name: events_members events_members_events_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.events_members
    ADD CONSTRAINT events_members_events_id_foreign FOREIGN KEY (events_id) REFERENCES public.events(id) ON DELETE CASCADE;


--
-- Name: events_members events_members_members_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.events_members
    ADD CONSTRAINT events_members_members_id_foreign FOREIGN KEY (members_id) REFERENCES public.members(id) ON DELETE CASCADE;


--
-- Name: events_teams events_teams_events_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.events_teams
    ADD CONSTRAINT events_teams_events_id_foreign FOREIGN KEY (events_id) REFERENCES public.events(id) ON DELETE CASCADE;


--
-- Name: events_teams events_teams_teams_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.events_teams
    ADD CONSTRAINT events_teams_teams_id_foreign FOREIGN KEY (teams_id) REFERENCES public.teams(id) ON DELETE CASCADE;


--
-- Name: finance_budget_lines finance_budget_lines_account_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_budget_lines
    ADD CONSTRAINT finance_budget_lines_account_fkey FOREIGN KEY (account) REFERENCES public.finance_accounts(id) ON DELETE CASCADE;


--
-- Name: finance_budget_lines finance_budget_lines_fiscal_year_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_budget_lines
    ADD CONSTRAINT finance_budget_lines_fiscal_year_fkey FOREIGN KEY (fiscal_year) REFERENCES public.finance_fiscal_years(id) ON DELETE CASCADE;


--
-- Name: finance_dues_rates finance_dues_rates_fiscal_year_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_dues_rates
    ADD CONSTRAINT finance_dues_rates_fiscal_year_fk FOREIGN KEY (fiscal_year) REFERENCES public.finance_fiscal_years(id) ON DELETE RESTRICT;


--
-- Name: finance_dues_runs finance_dues_runs_fiscal_year_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_dues_runs
    ADD CONSTRAINT finance_dues_runs_fiscal_year_fk FOREIGN KEY (fiscal_year) REFERENCES public.finance_fiscal_years(id) ON DELETE RESTRICT;


--
-- Name: finance_dunning_notices finance_dunning_notices_invoice_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_dunning_notices
    ADD CONSTRAINT finance_dunning_notices_invoice_fk FOREIGN KEY (invoice) REFERENCES public.finance_invoices(id) ON DELETE RESTRICT;


--
-- Name: finance_email_jobs finance_email_jobs_dues_run_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_email_jobs
    ADD CONSTRAINT finance_email_jobs_dues_run_fkey FOREIGN KEY (dues_run) REFERENCES public.finance_dues_runs(id) ON DELETE CASCADE;


--
-- Name: finance_expenses finance_expenses_file_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_expenses
    ADD CONSTRAINT finance_expenses_file_fkey FOREIGN KEY (file) REFERENCES public.directus_files(id) ON DELETE SET NULL;


--
-- Name: finance_expenses finance_expenses_member_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_expenses
    ADD CONSTRAINT finance_expenses_member_fkey FOREIGN KEY (member) REFERENCES public.members(id) ON DELETE RESTRICT;


--
-- Name: finance_expenses finance_expenses_payout_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_expenses
    ADD CONSTRAINT finance_expenses_payout_fkey FOREIGN KEY (payout) REFERENCES public.finance_payouts(id) ON DELETE SET NULL;


--
-- Name: finance_income_account_map finance_income_account_map_account_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_income_account_map
    ADD CONSTRAINT finance_income_account_map_account_fkey FOREIGN KEY (account) REFERENCES public.finance_accounts(id) ON DELETE SET NULL;


--
-- Name: finance_invoice_documents finance_invoice_documents_file_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_invoice_documents
    ADD CONSTRAINT finance_invoice_documents_file_fkey FOREIGN KEY (file) REFERENCES public.directus_files(id) ON DELETE CASCADE;


--
-- Name: finance_invoice_documents finance_invoice_documents_invoice_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_invoice_documents
    ADD CONSTRAINT finance_invoice_documents_invoice_fkey FOREIGN KEY (invoice) REFERENCES public.finance_invoices(id) ON DELETE CASCADE;


--
-- Name: finance_invoice_member_overrides finance_invoice_member_overrides_member_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_invoice_member_overrides
    ADD CONSTRAINT finance_invoice_member_overrides_member_fkey FOREIGN KEY (member) REFERENCES public.members(id) ON DELETE CASCADE;


--
-- Name: finance_invoices finance_invoices_contact_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_invoices
    ADD CONSTRAINT finance_invoices_contact_fkey FOREIGN KEY (contact) REFERENCES public.finance_billing_contacts(id) ON DELETE SET NULL;


--
-- Name: finance_invoices finance_invoices_dues_run_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_invoices
    ADD CONSTRAINT finance_invoices_dues_run_fkey FOREIGN KEY (dues_run) REFERENCES public.finance_dues_runs(id) ON DELETE SET NULL;


--
-- Name: finance_invoices finance_invoices_fiscal_year_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_invoices
    ADD CONSTRAINT finance_invoices_fiscal_year_fk FOREIGN KEY (fiscal_year) REFERENCES public.finance_fiscal_years(id) ON DELETE RESTRICT;


--
-- Name: finance_invoices finance_invoices_import_batch_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_invoices
    ADD CONSTRAINT finance_invoices_import_batch_fkey FOREIGN KEY (import_batch) REFERENCES public.finance_imports(id) ON DELETE SET NULL;


--
-- Name: finance_invoices finance_invoices_member_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_invoices
    ADD CONSTRAINT finance_invoices_member_fkey FOREIGN KEY (member) REFERENCES public.members(id) ON DELETE SET NULL;


--
-- Name: finance_invoices finance_invoices_reported_paid_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_invoices
    ADD CONSTRAINT finance_invoices_reported_paid_by_fkey FOREIGN KEY (reported_paid_by) REFERENCES public.members(id) ON DELETE SET NULL;


--
-- Name: finance_invoices finance_invoices_team_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_invoices
    ADD CONSTRAINT finance_invoices_team_fkey FOREIGN KEY (team) REFERENCES public.teams(id) ON DELETE SET NULL;


--
-- Name: finance_ledger_settings finance_ledger_settings_bad_debt_account_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_ledger_settings
    ADD CONSTRAINT finance_ledger_settings_bad_debt_account_fkey FOREIGN KEY (bad_debt_account) REFERENCES public.finance_accounts(id) ON DELETE SET NULL;


--
-- Name: finance_ledger_settings finance_ledger_settings_bank_account_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_ledger_settings
    ADD CONSTRAINT finance_ledger_settings_bank_account_fkey FOREIGN KEY (bank_account) REFERENCES public.finance_accounts(id) ON DELETE SET NULL;


--
-- Name: finance_ledger_settings finance_ledger_settings_debitoren_account_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_ledger_settings
    ADD CONSTRAINT finance_ledger_settings_debitoren_account_fkey FOREIGN KEY (debitoren_account) REFERENCES public.finance_accounts(id) ON DELETE SET NULL;


--
-- Name: finance_ledger_settings finance_ledger_settings_expense_account_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_ledger_settings
    ADD CONSTRAINT finance_ledger_settings_expense_account_fkey FOREIGN KEY (expense_account) REFERENCES public.finance_accounts(id) ON DELETE SET NULL;


--
-- Name: finance_ledger_settings finance_ledger_settings_income_account_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_ledger_settings
    ADD CONSTRAINT finance_ledger_settings_income_account_fkey FOREIGN KEY (income_account) REFERENCES public.finance_accounts(id) ON DELETE SET NULL;


--
-- Name: finance_ledger_settings finance_ledger_settings_prepayment_account_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_ledger_settings
    ADD CONSTRAINT finance_ledger_settings_prepayment_account_fkey FOREIGN KEY (prepayment_account) REFERENCES public.finance_accounts(id) ON DELETE SET NULL;


--
-- Name: finance_ledger_settings finance_ledger_settings_sponsoring_account_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_ledger_settings
    ADD CONSTRAINT finance_ledger_settings_sponsoring_account_fkey FOREIGN KEY (sponsoring_account) REFERENCES public.finance_accounts(id) ON DELETE SET NULL;


--
-- Name: finance_payments finance_payments_clubdesk_guess_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_payments
    ADD CONSTRAINT finance_payments_clubdesk_guess_fkey FOREIGN KEY (clubdesk_guess) REFERENCES public.finance_invoices(id) ON DELETE SET NULL;


--
-- Name: finance_payments finance_payments_import_batch_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_payments
    ADD CONSTRAINT finance_payments_import_batch_fkey FOREIGN KEY (import_batch) REFERENCES public.finance_imports(id) ON DELETE SET NULL;


--
-- Name: finance_payments finance_payments_invoice_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_payments
    ADD CONSTRAINT finance_payments_invoice_fk FOREIGN KEY (invoice) REFERENCES public.finance_invoices(id) ON DELETE RESTRICT;


--
-- Name: finance_payments finance_payments_payout_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_payments
    ADD CONSTRAINT finance_payments_payout_fkey FOREIGN KEY (payout) REFERENCES public.finance_payouts(id) ON DELETE SET NULL;


--
-- Name: finance_payouts finance_payouts_member_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_payouts
    ADD CONSTRAINT finance_payouts_member_fk FOREIGN KEY (member) REFERENCES public.members(id) ON DELETE RESTRICT;


--
-- Name: finance_team_entries finance_team_entries_fiscal_year_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_team_entries
    ADD CONSTRAINT finance_team_entries_fiscal_year_fkey FOREIGN KEY (fiscal_year) REFERENCES public.finance_fiscal_years(id) ON DELETE SET NULL;


--
-- Name: finance_team_entries finance_team_entries_team_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_team_entries
    ADD CONSTRAINT finance_team_entries_team_fkey FOREIGN KEY (team) REFERENCES public.teams(id) ON DELETE CASCADE;


--
-- Name: finance_transactions finance_transactions_credit_account_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_transactions
    ADD CONSTRAINT finance_transactions_credit_account_fkey FOREIGN KEY (credit_account) REFERENCES public.finance_accounts(id) ON DELETE SET NULL;


--
-- Name: finance_transactions finance_transactions_debit_account_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_transactions
    ADD CONSTRAINT finance_transactions_debit_account_fkey FOREIGN KEY (debit_account) REFERENCES public.finance_accounts(id) ON DELETE SET NULL;


--
-- Name: finance_transactions finance_transactions_fiscal_year_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_transactions
    ADD CONSTRAINT finance_transactions_fiscal_year_fk FOREIGN KEY (fiscal_year) REFERENCES public.finance_fiscal_years(id) ON DELETE RESTRICT;


--
-- Name: finance_transactions finance_transactions_import_batch_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_transactions
    ADD CONSTRAINT finance_transactions_import_batch_fkey FOREIGN KEY (import_batch) REFERENCES public.finance_imports(id) ON DELETE SET NULL;


--
-- Name: finance_transactions finance_transactions_reversal_of_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_transactions
    ADD CONSTRAINT finance_transactions_reversal_of_fkey FOREIGN KEY (reversal_of) REFERENCES public.finance_transactions(id) ON DELETE SET NULL;


--
-- Name: fine_rules fine_rules_team_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fine_rules
    ADD CONSTRAINT fine_rules_team_fkey FOREIGN KEY (team) REFERENCES public.teams(id) ON DELETE CASCADE;


--
-- Name: fine_rules fine_rules_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fine_rules
    ADD CONSTRAINT fine_rules_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.members(id) ON DELETE SET NULL;


--
-- Name: fines fines_issued_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fines
    ADD CONSTRAINT fines_issued_by_fkey FOREIGN KEY (issued_by) REFERENCES public.members(id) ON DELETE SET NULL;


--
-- Name: fines fines_member_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fines
    ADD CONSTRAINT fines_member_fkey FOREIGN KEY (member) REFERENCES public.members(id) ON DELETE RESTRICT;


--
-- Name: fines fines_paid_received_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fines
    ADD CONSTRAINT fines_paid_received_by_fkey FOREIGN KEY (paid_received_by) REFERENCES public.members(id) ON DELETE SET NULL;


--
-- Name: fines fines_team_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fines
    ADD CONSTRAINT fines_team_fkey FOREIGN KEY (team) REFERENCES public.teams(id) ON DELETE RESTRICT;


--
-- Name: fines fines_waived_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fines
    ADD CONSTRAINT fines_waived_by_fkey FOREIGN KEY (waived_by) REFERENCES public.members(id) ON DELETE SET NULL;


--
-- Name: form_submissions form_submissions_form_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.form_submissions
    ADD CONSTRAINT form_submissions_form_fkey FOREIGN KEY (form) REFERENCES public.forms(id) ON DELETE CASCADE;


--
-- Name: form_submissions form_submissions_member_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.form_submissions
    ADD CONSTRAINT form_submissions_member_fkey FOREIGN KEY (member) REFERENCES public.members(id) ON DELETE SET NULL;


--
-- Name: forms forms_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.forms
    ADD CONSTRAINT forms_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.members(id) ON DELETE SET NULL;


--
-- Name: forms_teams forms_teams_forms_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.forms_teams
    ADD CONSTRAINT forms_teams_forms_id_fkey FOREIGN KEY (forms_id) REFERENCES public.forms(id) ON DELETE CASCADE;


--
-- Name: forms_teams forms_teams_teams_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.forms_teams
    ADD CONSTRAINT forms_teams_teams_id_fkey FOREIGN KEY (teams_id) REFERENCES public.teams(id) ON DELETE CASCADE;


--
-- Name: game_rosters game_rosters_game_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_rosters
    ADD CONSTRAINT game_rosters_game_fkey FOREIGN KEY (game) REFERENCES public.games(id) ON DELETE CASCADE;


--
-- Name: game_rosters game_rosters_member_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_rosters
    ADD CONSTRAINT game_rosters_member_fkey FOREIGN KEY (member) REFERENCES public.members(id) ON DELETE SET NULL;


--
-- Name: game_scheduling_bookings game_scheduling_bookings_season_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_scheduling_bookings
    ADD CONSTRAINT game_scheduling_bookings_season_fkey FOREIGN KEY (season) REFERENCES public.game_scheduling_seasons(id) ON DELETE RESTRICT;


--
-- Name: game_scheduling_club_portals game_scheduling_club_portals_season_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_scheduling_club_portals
    ADD CONSTRAINT game_scheduling_club_portals_season_fkey FOREIGN KEY (season) REFERENCES public.game_scheduling_seasons(id) ON DELETE CASCADE;


--
-- Name: game_scheduling_derbies game_scheduling_derbies_leg1_home_team_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_scheduling_derbies
    ADD CONSTRAINT game_scheduling_derbies_leg1_home_team_fkey FOREIGN KEY (leg1_home_team) REFERENCES public.teams(id) ON DELETE SET NULL;


--
-- Name: game_scheduling_derbies game_scheduling_derbies_leg2_home_team_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_scheduling_derbies
    ADD CONSTRAINT game_scheduling_derbies_leg2_home_team_fkey FOREIGN KEY (leg2_home_team) REFERENCES public.teams(id) ON DELETE SET NULL;


--
-- Name: game_scheduling_derbies game_scheduling_derbies_season_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_scheduling_derbies
    ADD CONSTRAINT game_scheduling_derbies_season_fkey FOREIGN KEY (season) REFERENCES public.game_scheduling_seasons(id) ON DELETE CASCADE;


--
-- Name: game_scheduling_derbies game_scheduling_derbies_team_a_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_scheduling_derbies
    ADD CONSTRAINT game_scheduling_derbies_team_a_fkey FOREIGN KEY (team_a) REFERENCES public.teams(id) ON DELETE CASCADE;


--
-- Name: game_scheduling_derbies game_scheduling_derbies_team_b_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_scheduling_derbies
    ADD CONSTRAINT game_scheduling_derbies_team_b_fkey FOREIGN KEY (team_b) REFERENCES public.teams(id) ON DELETE CASCADE;


--
-- Name: game_scheduling_opponents game_scheduling_opponents_season_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_scheduling_opponents
    ADD CONSTRAINT game_scheduling_opponents_season_foreign FOREIGN KEY (season) REFERENCES public.game_scheduling_seasons(id) ON DELETE SET NULL;


--
-- Name: game_scheduling_slots game_scheduling_slots_season_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_scheduling_slots
    ADD CONSTRAINT game_scheduling_slots_season_fkey FOREIGN KEY (season) REFERENCES public.game_scheduling_seasons(id) ON DELETE RESTRICT;


--
-- Name: games games_bb_24s_duty_team_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.games
    ADD CONSTRAINT games_bb_24s_duty_team_foreign FOREIGN KEY (bb_24s_duty_team) REFERENCES public.teams(id) ON DELETE SET NULL;


--
-- Name: games games_bb_24s_official_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.games
    ADD CONSTRAINT games_bb_24s_official_foreign FOREIGN KEY (bb_24s_official) REFERENCES public.members(id) ON DELETE SET NULL;


--
-- Name: games games_bb_duty_team_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.games
    ADD CONSTRAINT games_bb_duty_team_foreign FOREIGN KEY (bb_duty_team) REFERENCES public.teams(id) ON DELETE SET NULL;


--
-- Name: games games_bb_scorer_duty_team_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.games
    ADD CONSTRAINT games_bb_scorer_duty_team_foreign FOREIGN KEY (bb_scorer_duty_team) REFERENCES public.teams(id) ON DELETE SET NULL;


--
-- Name: games games_bb_scorer_member_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.games
    ADD CONSTRAINT games_bb_scorer_member_foreign FOREIGN KEY (bb_scorer_member) REFERENCES public.members(id) ON DELETE SET NULL;


--
-- Name: games games_bb_timekeeper_duty_team_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.games
    ADD CONSTRAINT games_bb_timekeeper_duty_team_foreign FOREIGN KEY (bb_timekeeper_duty_team) REFERENCES public.teams(id) ON DELETE SET NULL;


--
-- Name: games games_bb_timekeeper_member_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.games
    ADD CONSTRAINT games_bb_timekeeper_member_foreign FOREIGN KEY (bb_timekeeper_member) REFERENCES public.members(id) ON DELETE SET NULL;


--
-- Name: games games_hall_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.games
    ADD CONSTRAINT games_hall_foreign FOREIGN KEY (hall) REFERENCES public.halls(id) ON DELETE SET NULL;


--
-- Name: games games_kscw_team_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.games
    ADD CONSTRAINT games_kscw_team_foreign FOREIGN KEY (kscw_team) REFERENCES public.teams(id) ON DELETE SET NULL;


--
-- Name: games games_referee_duty_team_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.games
    ADD CONSTRAINT games_referee_duty_team_foreign FOREIGN KEY (referee_duty_team) REFERENCES public.teams(id) ON DELETE SET NULL;


--
-- Name: games games_referee_member_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.games
    ADD CONSTRAINT games_referee_member_foreign FOREIGN KEY (referee_member) REFERENCES public.members(id) ON DELETE SET NULL;


--
-- Name: games games_scoreboard_duty_team_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.games
    ADD CONSTRAINT games_scoreboard_duty_team_foreign FOREIGN KEY (scoreboard_duty_team) REFERENCES public.teams(id) ON DELETE SET NULL;


--
-- Name: games games_scoreboard_member_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.games
    ADD CONSTRAINT games_scoreboard_member_foreign FOREIGN KEY (scoreboard_member) REFERENCES public.members(id) ON DELETE SET NULL;


--
-- Name: games games_scorer_duty_team_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.games
    ADD CONSTRAINT games_scorer_duty_team_foreign FOREIGN KEY (scorer_duty_team) REFERENCES public.teams(id) ON DELETE SET NULL;


--
-- Name: games games_scorer_member_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.games
    ADD CONSTRAINT games_scorer_member_foreign FOREIGN KEY (scorer_member) REFERENCES public.members(id) ON DELETE SET NULL;


--
-- Name: games games_scorer_scoreboard_duty_team_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.games
    ADD CONSTRAINT games_scorer_scoreboard_duty_team_foreign FOREIGN KEY (scorer_scoreboard_duty_team) REFERENCES public.teams(id) ON DELETE SET NULL;


--
-- Name: games games_scorer_scoreboard_member_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.games
    ADD CONSTRAINT games_scorer_scoreboard_member_foreign FOREIGN KEY (scorer_scoreboard_member) REFERENCES public.members(id) ON DELETE SET NULL;


--
-- Name: hall_closures hall_closures_hall_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hall_closures
    ADD CONSTRAINT hall_closures_hall_foreign FOREIGN KEY (hall) REFERENCES public.halls(id) ON DELETE SET NULL;


--
-- Name: hall_slots hall_slots_hall_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hall_slots
    ADD CONSTRAINT hall_slots_hall_foreign FOREIGN KEY (hall) REFERENCES public.halls(id) ON DELETE SET NULL;


--
-- Name: hall_slots_teams hall_slots_teams_hall_slots_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hall_slots_teams
    ADD CONSTRAINT hall_slots_teams_hall_slots_id_foreign FOREIGN KEY (hall_slots_id) REFERENCES public.hall_slots(id) ON DELETE CASCADE;


--
-- Name: hall_slots_teams hall_slots_teams_teams_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hall_slots_teams
    ADD CONSTRAINT hall_slots_teams_teams_id_foreign FOREIGN KEY (teams_id) REFERENCES public.teams(id) ON DELETE CASCADE;


--
-- Name: identity_document_keys identity_document_keys_document_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.identity_document_keys
    ADD CONSTRAINT identity_document_keys_document_fkey FOREIGN KEY (document) REFERENCES public.identity_documents(id) ON DELETE CASCADE;


--
-- Name: identity_document_keys identity_document_keys_recipient_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.identity_document_keys
    ADD CONSTRAINT identity_document_keys_recipient_fkey FOREIGN KEY (recipient) REFERENCES public.members(id) ON DELETE CASCADE;


--
-- Name: identity_documents identity_documents_file_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.identity_documents
    ADD CONSTRAINT identity_documents_file_fkey FOREIGN KEY (file) REFERENCES public.directus_files(id) ON DELETE CASCADE;


--
-- Name: identity_documents identity_documents_member_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.identity_documents
    ADD CONSTRAINT identity_documents_member_fkey FOREIGN KEY (member) REFERENCES public.members(id) ON DELETE CASCADE;


--
-- Name: identity_documents identity_documents_uploaded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.identity_documents
    ADD CONSTRAINT identity_documents_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES public.members(id) ON DELETE SET NULL;


--
-- Name: member_teams member_teams_member_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_teams
    ADD CONSTRAINT member_teams_member_foreign FOREIGN KEY (member) REFERENCES public.members(id) ON DELETE CASCADE;


--
-- Name: member_teams member_teams_team_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_teams
    ADD CONSTRAINT member_teams_team_foreign FOREIGN KEY (team) REFERENCES public.teams(id) ON DELETE CASCADE;


--
-- Name: members members_photo_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.members
    ADD CONSTRAINT members_photo_foreign FOREIGN KEY (photo) REFERENCES public.directus_files(id) ON DELETE SET NULL;


--
-- Name: members members_requested_team_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.members
    ADD CONSTRAINT members_requested_team_foreign FOREIGN KEY (requested_team) REFERENCES public.teams(id) ON DELETE SET NULL;


--
-- Name: members members_user_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.members
    ADD CONSTRAINT members_user_foreign FOREIGN KEY ("user") REFERENCES public.directus_users(id) ON DELETE SET NULL;


--
-- Name: message_reactions message_reactions_member_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_reactions
    ADD CONSTRAINT message_reactions_member_foreign FOREIGN KEY (member) REFERENCES public.members(id) ON DELETE CASCADE;


--
-- Name: message_reactions message_reactions_message_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_reactions
    ADD CONSTRAINT message_reactions_message_foreign FOREIGN KEY (message) REFERENCES public.messages(id) ON DELETE CASCADE;


--
-- Name: message_requests message_requests_conversation_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_requests
    ADD CONSTRAINT message_requests_conversation_foreign FOREIGN KEY (conversation) REFERENCES public.conversations(id) ON DELETE CASCADE;


--
-- Name: message_requests message_requests_recipient_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_requests
    ADD CONSTRAINT message_requests_recipient_foreign FOREIGN KEY (recipient) REFERENCES public.members(id) ON DELETE CASCADE;


--
-- Name: message_requests message_requests_sender_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_requests
    ADD CONSTRAINT message_requests_sender_foreign FOREIGN KEY (sender) REFERENCES public.members(id) ON DELETE CASCADE;


--
-- Name: messages messages_conversation_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_conversation_foreign FOREIGN KEY (conversation) REFERENCES public.conversations(id) ON DELETE CASCADE;


--
-- Name: messages messages_poll_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_poll_foreign FOREIGN KEY (poll) REFERENCES public.polls(id) ON DELETE SET NULL;


--
-- Name: messages messages_sender_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_sender_foreign FOREIGN KEY (sender) REFERENCES public.members(id) ON DELETE CASCADE;


--
-- Name: notifications notifications_member_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_member_foreign FOREIGN KEY (member) REFERENCES public.members(id) ON DELETE CASCADE;


--
-- Name: participations participations_last_note_edited_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.participations
    ADD CONSTRAINT participations_last_note_edited_by_fkey FOREIGN KEY (last_note_edited_by) REFERENCES public.directus_users(id) ON DELETE SET NULL;


--
-- Name: participations participations_last_status_edited_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.participations
    ADD CONSTRAINT participations_last_status_edited_by_fkey FOREIGN KEY (last_status_edited_by) REFERENCES public.directus_users(id) ON DELETE SET NULL;


--
-- Name: participations participations_member_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.participations
    ADD CONSTRAINT participations_member_foreign FOREIGN KEY (member) REFERENCES public.members(id) ON DELETE CASCADE;


--
-- Name: password_reset_tokens password_reset_tokens_user_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.password_reset_tokens
    ADD CONSTRAINT password_reset_tokens_user_fkey FOREIGN KEY ("user") REFERENCES public.directus_users(id) ON DELETE CASCADE;


--
-- Name: poll_votes poll_votes_member_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.poll_votes
    ADD CONSTRAINT poll_votes_member_foreign FOREIGN KEY (member) REFERENCES public.members(id) ON DELETE CASCADE;


--
-- Name: poll_votes poll_votes_poll_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.poll_votes
    ADD CONSTRAINT poll_votes_poll_foreign FOREIGN KEY (poll) REFERENCES public.polls(id) ON DELETE CASCADE;


--
-- Name: polls polls_conversation_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.polls
    ADD CONSTRAINT polls_conversation_foreign FOREIGN KEY (conversation) REFERENCES public.conversations(id) ON DELETE CASCADE;


--
-- Name: push_subscriptions push_subscriptions_member_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_member_foreign FOREIGN KEY (member) REFERENCES public.members(id) ON DELETE CASCADE;


--
-- Name: rankings rankings_team_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rankings
    ADD CONSTRAINT rankings_team_foreign FOREIGN KEY (team) REFERENCES public.teams(id) ON DELETE SET NULL;


--
-- Name: referee_expenses referee_expenses_game_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referee_expenses
    ADD CONSTRAINT referee_expenses_game_fk FOREIGN KEY (game) REFERENCES public.games(id) ON DELETE SET NULL;


--
-- Name: referee_expenses referee_expenses_paid_by_member_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referee_expenses
    ADD CONSTRAINT referee_expenses_paid_by_member_fk FOREIGN KEY (paid_by_member) REFERENCES public.members(id) ON DELETE RESTRICT;


--
-- Name: referee_expenses referee_expenses_recorded_by_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referee_expenses
    ADD CONSTRAINT referee_expenses_recorded_by_fk FOREIGN KEY (recorded_by) REFERENCES public.members(id) ON DELETE SET NULL;


--
-- Name: referee_expenses referee_expenses_team_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referee_expenses
    ADD CONSTRAINT referee_expenses_team_fk FOREIGN KEY (team) REFERENCES public.teams(id) ON DELETE SET NULL;


--
-- Name: registrations registrations_member_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.registrations
    ADD CONSTRAINT registrations_member_fkey FOREIGN KEY (member) REFERENCES public.members(id) ON DELETE SET NULL;


--
-- Name: reports reports_conversation_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reports
    ADD CONSTRAINT reports_conversation_foreign FOREIGN KEY (conversation) REFERENCES public.conversations(id) ON DELETE SET NULL;


--
-- Name: reports reports_message_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reports
    ADD CONSTRAINT reports_message_foreign FOREIGN KEY (message) REFERENCES public.messages(id) ON DELETE SET NULL;


--
-- Name: reports reports_reported_member_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reports
    ADD CONSTRAINT reports_reported_member_foreign FOREIGN KEY (reported_member) REFERENCES public.members(id) ON DELETE SET NULL;


--
-- Name: reports reports_reporter_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reports
    ADD CONSTRAINT reports_reporter_foreign FOREIGN KEY (reporter) REFERENCES public.members(id) ON DELETE SET NULL;


--
-- Name: reports reports_resolved_by_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reports
    ADD CONSTRAINT reports_resolved_by_foreign FOREIGN KEY (resolved_by) REFERENCES public.members(id) ON DELETE SET NULL;


--
-- Name: scheduling_blocks scheduling_blocks_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scheduling_blocks
    ADD CONSTRAINT scheduling_blocks_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.members(id) ON DELETE SET NULL;


--
-- Name: scheduling_blocks scheduling_blocks_team_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scheduling_blocks
    ADD CONSTRAINT scheduling_blocks_team_fkey FOREIGN KEY (team) REFERENCES public.teams(id) ON DELETE CASCADE;


--
-- Name: scheduling_email_reads scheduling_email_reads_email_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scheduling_email_reads
    ADD CONSTRAINT scheduling_email_reads_email_fkey FOREIGN KEY (email) REFERENCES public.scheduling_emails(id) ON DELETE CASCADE;


--
-- Name: scheduling_email_reads scheduling_email_reads_member_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scheduling_email_reads
    ADD CONSTRAINT scheduling_email_reads_member_fkey FOREIGN KEY (member) REFERENCES public.members(id) ON DELETE CASCADE;


--
-- Name: scheduling_global_blocks scheduling_global_blocks_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scheduling_global_blocks
    ADD CONSTRAINT scheduling_global_blocks_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.members(id) ON DELETE SET NULL;


--
-- Name: scorer_course_attendance scorer_course_attendance_exam_file_corrected_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scorer_course_attendance
    ADD CONSTRAINT scorer_course_attendance_exam_file_corrected_foreign FOREIGN KEY (exam_file_corrected) REFERENCES public.directus_files(id);


--
-- Name: scorer_course_attendance scorer_course_attendance_exam_file_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scorer_course_attendance
    ADD CONSTRAINT scorer_course_attendance_exam_file_foreign FOREIGN KEY (exam_file) REFERENCES public.directus_files(id);


--
-- Name: scorer_delegations scorer_delegations_from_member_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scorer_delegations
    ADD CONSTRAINT scorer_delegations_from_member_foreign FOREIGN KEY (from_member) REFERENCES public.members(id) ON DELETE CASCADE;


--
-- Name: scorer_delegations scorer_delegations_to_member_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scorer_delegations
    ADD CONSTRAINT scorer_delegations_to_member_foreign FOREIGN KEY (to_member) REFERENCES public.members(id) ON DELETE CASCADE;


--
-- Name: signup_tokens signup_tokens_member_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.signup_tokens
    ADD CONSTRAINT signup_tokens_member_fkey FOREIGN KEY (member) REFERENCES public.members(id) ON DELETE CASCADE;


--
-- Name: signup_tokens signup_tokens_minted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.signup_tokens
    ADD CONSTRAINT signup_tokens_minted_by_fkey FOREIGN KEY (minted_by) REFERENCES public.members(id) ON DELETE SET NULL;


--
-- Name: slot_claims slot_claims_claimed_by_member_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.slot_claims
    ADD CONSTRAINT slot_claims_claimed_by_member_foreign FOREIGN KEY (claimed_by_member) REFERENCES public.members(id) ON DELETE CASCADE;


--
-- Name: spielplaner_assignments spielplaner_assignments_kscw_team_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.spielplaner_assignments
    ADD CONSTRAINT spielplaner_assignments_kscw_team_foreign FOREIGN KEY (kscw_team) REFERENCES public.teams(id) ON DELETE CASCADE;


--
-- Name: spielplaner_assignments spielplaner_assignments_member_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.spielplaner_assignments
    ADD CONSTRAINT spielplaner_assignments_member_foreign FOREIGN KEY (member) REFERENCES public.members(id) ON DELETE CASCADE;


--
-- Name: spielplaner_assignments spielplaner_assignments_user_created_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.spielplaner_assignments
    ADD CONSTRAINT spielplaner_assignments_user_created_foreign FOREIGN KEY (user_created) REFERENCES public.directus_users(id) ON DELETE SET NULL;


--
-- Name: team_requests team_requests_member_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_requests
    ADD CONSTRAINT team_requests_member_fkey FOREIGN KEY (member) REFERENCES public.members(id) ON DELETE CASCADE;


--
-- Name: team_requests team_requests_team_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_requests
    ADD CONSTRAINT team_requests_team_fkey FOREIGN KEY (team) REFERENCES public.teams(id) ON DELETE CASCADE;


--
-- Name: teams teams_captain_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teams
    ADD CONSTRAINT teams_captain_foreign FOREIGN KEY (captain) REFERENCES public.members(id) ON DELETE SET NULL;


--
-- Name: teams_coaches teams_coaches_members_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teams_coaches
    ADD CONSTRAINT teams_coaches_members_id_foreign FOREIGN KEY (members_id) REFERENCES public.members(id) ON DELETE CASCADE;


--
-- Name: teams_coaches teams_coaches_teams_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teams_coaches
    ADD CONSTRAINT teams_coaches_teams_id_foreign FOREIGN KEY (teams_id) REFERENCES public.teams(id) ON DELETE CASCADE;


--
-- Name: teams_responsibles teams_responsibles_members_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teams_responsibles
    ADD CONSTRAINT teams_responsibles_members_id_foreign FOREIGN KEY (members_id) REFERENCES public.members(id) ON DELETE CASCADE;


--
-- Name: teams_responsibles teams_responsibles_teams_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teams_responsibles
    ADD CONSTRAINT teams_responsibles_teams_id_foreign FOREIGN KEY (teams_id) REFERENCES public.teams(id) ON DELETE CASCADE;


--
-- Name: teams_sponsors teams_sponsors_sponsors_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teams_sponsors
    ADD CONSTRAINT teams_sponsors_sponsors_id_foreign FOREIGN KEY (sponsors_id) REFERENCES public.sponsors(id) ON DELETE CASCADE;


--
-- Name: teams_sponsors teams_sponsors_teams_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teams_sponsors
    ADD CONSTRAINT teams_sponsors_teams_id_foreign FOREIGN KEY (teams_id) REFERENCES public.teams(id) ON DELETE CASCADE;


--
-- Name: training_slot_skips training_slot_skips_hall_slot_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.training_slot_skips
    ADD CONSTRAINT training_slot_skips_hall_slot_fkey FOREIGN KEY (hall_slot) REFERENCES public.hall_slots(id) ON DELETE CASCADE;


--
-- Name: trainings trainings_hall_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trainings
    ADD CONSTRAINT trainings_hall_foreign FOREIGN KEY (hall) REFERENCES public.halls(id) ON DELETE SET NULL;


--
-- Name: trainings trainings_hall_slot_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trainings
    ADD CONSTRAINT trainings_hall_slot_foreign FOREIGN KEY (hall_slot) REFERENCES public.hall_slots(id) ON DELETE SET NULL;


--
-- Name: trainings trainings_team_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trainings
    ADD CONSTRAINT trainings_team_foreign FOREIGN KEY (team) REFERENCES public.teams(id) ON DELETE CASCADE;


--
-- Name: user_logs user_logs_user_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_logs
    ADD CONSTRAINT user_logs_user_foreign FOREIGN KEY ("user") REFERENCES public.members(id) ON DELETE SET NULL;


--
-- Name: vb_referee_duty vb_referee_duty_referee_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vb_referee_duty
    ADD CONSTRAINT vb_referee_duty_referee_fkey FOREIGN KEY (referee) REFERENCES public.members(id) ON DELETE CASCADE;


--
-- Name: vb_referee_duty vb_referee_duty_team_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vb_referee_duty
    ADD CONSTRAINT vb_referee_duty_team_fkey FOREIGN KEY (team) REFERENCES public.teams(id) ON DELETE CASCADE;


--
-- Name: website_admin_access website_admin_access_user_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.website_admin_access
    ADD CONSTRAINT website_admin_access_user_fkey FOREIGN KEY ("user") REFERENCES public.directus_users(id) ON DELETE CASCADE;


--
-- Name: absences; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.absences ENABLE ROW LEVEL SECURITY;

--
-- Name: app_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: bugfix_jobs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.bugfix_jobs ENABLE ROW LEVEL SECURITY;

--
-- Name: bugfix_jobs directus_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY directus_full_access ON public.bugfix_jobs USING (true) WITH CHECK (true);


--
-- Name: volley_feedback directus_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY directus_full_access ON public.volley_feedback USING (true) WITH CHECK (true);


--
-- Name: email_verifications; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.email_verifications ENABLE ROW LEVEL SECURITY;

--
-- Name: error_annotations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.error_annotations ENABLE ROW LEVEL SECURITY;

--
-- Name: event_sessions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.event_sessions ENABLE ROW LEVEL SECURITY;

--
-- Name: events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;

--
-- Name: feedback; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.feedback ENABLE ROW LEVEL SECURITY;

--
-- Name: game_scheduling_bookings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.game_scheduling_bookings ENABLE ROW LEVEL SECURITY;

--
-- Name: game_scheduling_opponents; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.game_scheduling_opponents ENABLE ROW LEVEL SECURITY;

--
-- Name: game_scheduling_seasons; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.game_scheduling_seasons ENABLE ROW LEVEL SECURITY;

--
-- Name: game_scheduling_slots; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.game_scheduling_slots ENABLE ROW LEVEL SECURITY;

--
-- Name: games; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.games ENABLE ROW LEVEL SECURITY;

--
-- Name: hall_closures; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.hall_closures ENABLE ROW LEVEL SECURITY;

--
-- Name: hall_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.hall_events ENABLE ROW LEVEL SECURITY;

--
-- Name: hall_slots; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.hall_slots ENABLE ROW LEVEL SECURITY;

--
-- Name: hall_slots_teams; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.hall_slots_teams ENABLE ROW LEVEL SECURITY;

--
-- Name: halls; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.halls ENABLE ROW LEVEL SECURITY;

--
-- Name: member_teams; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.member_teams ENABLE ROW LEVEL SECURITY;

--
-- Name: members; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.members ENABLE ROW LEVEL SECURITY;

--
-- Name: news; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.news ENABLE ROW LEVEL SECURITY;

--
-- Name: newsletter_subscribers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.newsletter_subscribers ENABLE ROW LEVEL SECURITY;

--
-- Name: notifications; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

--
-- Name: participations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.participations ENABLE ROW LEVEL SECURITY;

--
-- Name: poll_votes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.poll_votes ENABLE ROW LEVEL SECURITY;

--
-- Name: polls; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.polls ENABLE ROW LEVEL SECURITY;

--
-- Name: push_subscriptions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

--
-- Name: rankings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.rankings ENABLE ROW LEVEL SECURITY;

--
-- Name: referee_expenses; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.referee_expenses ENABLE ROW LEVEL SECURITY;

--
-- Name: registrations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.registrations ENABLE ROW LEVEL SECURITY;

--
-- Name: scorer_delegations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.scorer_delegations ENABLE ROW LEVEL SECURITY;

--
-- Name: slot_claims; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.slot_claims ENABLE ROW LEVEL SECURITY;

--
-- Name: sponsors; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sponsors ENABLE ROW LEVEL SECURITY;

--
-- Name: sv_vm_check; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sv_vm_check ENABLE ROW LEVEL SECURITY;

--
-- Name: team_invites; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.team_invites ENABLE ROW LEVEL SECURITY;

--
-- Name: team_requests; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.team_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: teams; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;

--
-- Name: trainings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.trainings ENABLE ROW LEVEL SECURITY;

--
-- Name: user_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: vm_vb_spielplan_contact; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.vm_vb_spielplan_contact ENABLE ROW LEVEL SECURITY;

--
-- Name: volley_feedback; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.volley_feedback ENABLE ROW LEVEL SECURITY;

--
-- PostgreSQL database dump complete
--

\unrestrict Lf8DJ0dqzKlFEXiGngWiatht4HjqIY84jgr5nlhrDhCyVcMNKWJ9DHNV3hoLjhJ

