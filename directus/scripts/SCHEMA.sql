-- ============================================================================
-- KSCW SCHEMA baseline — GENERATED, DO NOT EDIT BY HAND
-- ============================================================================
--
-- Generated:   2026-06-18T15:49:38.362Z
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

-- Dumped from database version 15.8
-- Dumped by pg_dump version 15.8

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
-- Name: _realtime; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA _realtime;


--
-- Name: pg_cron; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;


--
-- Name: EXTENSION pg_cron; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pg_cron IS 'Job scheduler for PostgreSQL';


--
-- Name: extensions; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA extensions;


--
-- Name: graphql; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA graphql;


--
-- Name: graphql_public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA graphql_public;


--
-- Name: pg_net; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;


--
-- Name: EXTENSION pg_net; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pg_net IS 'Async HTTP';


--
-- Name: nocodb_meta; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA nocodb_meta;


--
-- Name: p6pi0hr30o0mop9; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA p6pi0hr30o0mop9;


--
-- Name: pgbouncer; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA pgbouncer;


--
-- Name: pgsodium; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgsodium WITH SCHEMA pgsodium;


--
-- Name: EXTENSION pgsodium; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pgsodium IS 'Pgsodium is a modern cryptography library for Postgres.';


--
-- Name: pg_graphql; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pg_graphql WITH SCHEMA graphql;


--
-- Name: EXTENSION pg_graphql; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pg_graphql IS 'pg_graphql: GraphQL support';


--
-- Name: pg_stat_statements; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pg_stat_statements WITH SCHEMA extensions;


--
-- Name: EXTENSION pg_stat_statements; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pg_stat_statements IS 'track planning and execution statistics of all SQL statements executed';


--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;


--
-- Name: EXTENSION pgcrypto; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';


--
-- Name: pgjwt; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgjwt WITH SCHEMA extensions;


--
-- Name: EXTENSION pgjwt; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pgjwt IS 'JSON Web Token API for Postgresql';


--
-- Name: supabase_vault; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault;


--
-- Name: EXTENSION supabase_vault; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION supabase_vault IS 'Supabase Vault Extension';


--
-- Name: unaccent; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA public;


--
-- Name: EXTENSION unaccent; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION unaccent IS 'text search dictionary that removes accents';


--
-- Name: uuid-ossp; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;


--
-- Name: EXTENSION "uuid-ossp"; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION "uuid-ossp" IS 'generate universally unique identifiers (UUIDs)';


--
-- Name: svrz_push_status_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.svrz_push_status_enum AS ENUM (
    'pending',
    'pushed',
    'failed'
);


--
-- Name: grant_pg_cron_access(); Type: FUNCTION; Schema: extensions; Owner: -
--

CREATE FUNCTION extensions.grant_pg_cron_access() RETURNS event_trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF EXISTS (
    SELECT
    FROM pg_event_trigger_ddl_commands() AS ev
    JOIN pg_extension AS ext
    ON ev.objid = ext.oid
    WHERE ext.extname = 'pg_cron'
  )
  THEN
    grant usage on schema cron to postgres with grant option;

    alter default privileges in schema cron grant all on tables to postgres with grant option;
    alter default privileges in schema cron grant all on functions to postgres with grant option;
    alter default privileges in schema cron grant all on sequences to postgres with grant option;

    alter default privileges for user supabase_admin in schema cron grant all
        on sequences to postgres with grant option;
    alter default privileges for user supabase_admin in schema cron grant all
        on tables to postgres with grant option;
    alter default privileges for user supabase_admin in schema cron grant all
        on functions to postgres with grant option;

    grant all privileges on all tables in schema cron to postgres with grant option;
    revoke all on table cron.job from postgres;
    grant select on table cron.job to postgres with grant option;
  END IF;
END;
$$;


--
-- Name: FUNCTION grant_pg_cron_access(); Type: COMMENT; Schema: extensions; Owner: -
--

COMMENT ON FUNCTION extensions.grant_pg_cron_access() IS 'Grants access to pg_cron';


--
-- Name: grant_pg_graphql_access(); Type: FUNCTION; Schema: extensions; Owner: -
--

CREATE FUNCTION extensions.grant_pg_graphql_access() RETURNS event_trigger
    LANGUAGE plpgsql
    AS $_$
DECLARE
    func_is_graphql_resolve bool;
BEGIN
    func_is_graphql_resolve = (
        SELECT n.proname = 'resolve'
        FROM pg_event_trigger_ddl_commands() AS ev
        LEFT JOIN pg_catalog.pg_proc AS n
        ON ev.objid = n.oid
    );

    IF func_is_graphql_resolve
    THEN
        -- Update public wrapper to pass all arguments through to the pg_graphql resolve func
        DROP FUNCTION IF EXISTS graphql_public.graphql;
        create or replace function graphql_public.graphql(
            "operationName" text default null,
            query text default null,
            variables jsonb default null,
            extensions jsonb default null
        )
            returns jsonb
            language sql
        as $$
            select graphql.resolve(
                query := query,
                variables := coalesce(variables, '{}'),
                "operationName" := "operationName",
                extensions := extensions
            );
        $$;

        -- This hook executes when `graphql.resolve` is created. That is not necessarily the last
        -- function in the extension so we need to grant permissions on existing entities AND
        -- update default permissions to any others that are created after `graphql.resolve`
        grant usage on schema graphql to postgres, anon, authenticated, service_role;
        grant select on all tables in schema graphql to postgres, anon, authenticated, service_role;
        grant execute on all functions in schema graphql to postgres, anon, authenticated, service_role;
        grant all on all sequences in schema graphql to postgres, anon, authenticated, service_role;
        alter default privileges in schema graphql grant all on tables to postgres, anon, authenticated, service_role;
        alter default privileges in schema graphql grant all on functions to postgres, anon, authenticated, service_role;
        alter default privileges in schema graphql grant all on sequences to postgres, anon, authenticated, service_role;

        -- Allow postgres role to allow granting usage on graphql and graphql_public schemas to custom roles
        grant usage on schema graphql_public to postgres with grant option;
        grant usage on schema graphql to postgres with grant option;
    END IF;

END;
$_$;


--
-- Name: FUNCTION grant_pg_graphql_access(); Type: COMMENT; Schema: extensions; Owner: -
--

COMMENT ON FUNCTION extensions.grant_pg_graphql_access() IS 'Grants access to pg_graphql';


--
-- Name: grant_pg_net_access(); Type: FUNCTION; Schema: extensions; Owner: -
--

CREATE FUNCTION extensions.grant_pg_net_access() RETURNS event_trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_event_trigger_ddl_commands() AS ev
    JOIN pg_extension AS ext
    ON ev.objid = ext.oid
    WHERE ext.extname = 'pg_net'
  )
  THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_roles
      WHERE rolname = 'supabase_functions_admin'
    )
    THEN
      CREATE USER supabase_functions_admin NOINHERIT CREATEROLE LOGIN NOREPLICATION;
    END IF;

    GRANT USAGE ON SCHEMA net TO supabase_functions_admin, postgres, anon, authenticated, service_role;

    IF EXISTS (
      SELECT FROM pg_extension
      WHERE extname = 'pg_net'
      -- all versions in use on existing projects as of 2025-02-20
      -- version 0.12.0 onwards don't need these applied
      AND extversion IN ('0.2', '0.6', '0.7', '0.7.1', '0.8', '0.10.0', '0.11.0')
    ) THEN
      ALTER function net.http_get(url text, params jsonb, headers jsonb, timeout_milliseconds integer) SECURITY DEFINER;
      ALTER function net.http_post(url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds integer) SECURITY DEFINER;

      ALTER function net.http_get(url text, params jsonb, headers jsonb, timeout_milliseconds integer) SET search_path = net;
      ALTER function net.http_post(url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds integer) SET search_path = net;

      REVOKE ALL ON FUNCTION net.http_get(url text, params jsonb, headers jsonb, timeout_milliseconds integer) FROM PUBLIC;
      REVOKE ALL ON FUNCTION net.http_post(url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds integer) FROM PUBLIC;

      GRANT EXECUTE ON FUNCTION net.http_get(url text, params jsonb, headers jsonb, timeout_milliseconds integer) TO supabase_functions_admin, postgres, anon, authenticated, service_role;
      GRANT EXECUTE ON FUNCTION net.http_post(url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds integer) TO supabase_functions_admin, postgres, anon, authenticated, service_role;
    END IF;
  END IF;
END;
$$;


--
-- Name: FUNCTION grant_pg_net_access(); Type: COMMENT; Schema: extensions; Owner: -
--

COMMENT ON FUNCTION extensions.grant_pg_net_access() IS 'Grants access to pg_net';


--
-- Name: pgrst_ddl_watch(); Type: FUNCTION; Schema: extensions; Owner: -
--

CREATE FUNCTION extensions.pgrst_ddl_watch() RETURNS event_trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN SELECT * FROM pg_event_trigger_ddl_commands()
  LOOP
    IF cmd.command_tag IN (
      'CREATE SCHEMA', 'ALTER SCHEMA'
    , 'CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO', 'ALTER TABLE'
    , 'CREATE FOREIGN TABLE', 'ALTER FOREIGN TABLE'
    , 'CREATE VIEW', 'ALTER VIEW'
    , 'CREATE MATERIALIZED VIEW', 'ALTER MATERIALIZED VIEW'
    , 'CREATE FUNCTION', 'ALTER FUNCTION'
    , 'CREATE TRIGGER'
    , 'CREATE TYPE', 'ALTER TYPE'
    , 'CREATE RULE'
    , 'COMMENT'
    )
    -- don't notify in case of CREATE TEMP table or other objects created on pg_temp
    AND cmd.schema_name is distinct from 'pg_temp'
    THEN
      NOTIFY pgrst, 'reload schema';
    END IF;
  END LOOP;
END; $$;


--
-- Name: pgrst_drop_watch(); Type: FUNCTION; Schema: extensions; Owner: -
--

CREATE FUNCTION extensions.pgrst_drop_watch() RETURNS event_trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  obj record;
BEGIN
  FOR obj IN SELECT * FROM pg_event_trigger_dropped_objects()
  LOOP
    IF obj.object_type IN (
      'schema'
    , 'table'
    , 'foreign table'
    , 'view'
    , 'materialized view'
    , 'function'
    , 'trigger'
    , 'type'
    , 'rule'
    )
    AND obj.is_temporary IS false -- no pg_temp objects
    THEN
      NOTIFY pgrst, 'reload schema';
    END IF;
  END LOOP;
END; $$;


--
-- Name: set_graphql_placeholder(); Type: FUNCTION; Schema: extensions; Owner: -
--

CREATE FUNCTION extensions.set_graphql_placeholder() RETURNS event_trigger
    LANGUAGE plpgsql
    AS $_$
    DECLARE
    graphql_is_dropped bool;
    BEGIN
    graphql_is_dropped = (
        SELECT ev.schema_name = 'graphql_public'
        FROM pg_event_trigger_dropped_objects() AS ev
        WHERE ev.schema_name = 'graphql_public'
    );

    IF graphql_is_dropped
    THEN
        create or replace function graphql_public.graphql(
            "operationName" text default null,
            query text default null,
            variables jsonb default null,
            extensions jsonb default null
        )
            returns jsonb
            language plpgsql
        as $$
            DECLARE
                server_version float;
            BEGIN
                server_version = (SELECT (SPLIT_PART((select version()), ' ', 2))::float);

                IF server_version >= 14 THEN
                    RETURN jsonb_build_object(
                        'errors', jsonb_build_array(
                            jsonb_build_object(
                                'message', 'pg_graphql extension is not enabled.'
                            )
                        )
                    );
                ELSE
                    RETURN jsonb_build_object(
                        'errors', jsonb_build_array(
                            jsonb_build_object(
                                'message', 'pg_graphql is only available on projects running Postgres 14 onwards.'
                            )
                        )
                    );
                END IF;
            END;
        $$;
    END IF;

    END;
$_$;


--
-- Name: FUNCTION set_graphql_placeholder(); Type: COMMENT; Schema: extensions; Owner: -
--

COMMENT ON FUNCTION extensions.set_graphql_placeholder() IS 'Reintroduces placeholder function for graphql_public.graphql';


--
-- Name: get_auth(text); Type: FUNCTION; Schema: pgbouncer; Owner: -
--

CREATE FUNCTION pgbouncer.get_auth(p_usename text) RETURNS TABLE(username text, password text)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
    RAISE WARNING 'PgBouncer auth request: %', p_usename;

    RETURN QUERY
    SELECT usename::TEXT, passwd::TEXT FROM pg_catalog.pg_shadow
    WHERE usename = p_usename;
END;
$$;


--
-- Name: clubdesk_offliz_to_dx(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.clubdesk_offliz_to_dx(offliz text) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$
  SELECT CASE
    WHEN offliz LIKE '%Volleyball Lizenz%' THEN 'scorer_vb'
    WHEN offliz = 'OTR1' THEN 'otr1_bb'
    WHEN offliz = 'OTR2' THEN 'otr2_bb'
    WHEN offliz = 'OTN'  THEN 'otn_bb'
    ELSE NULL
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
  -- JS getMonth() is 0-indexed (Aug=7, Sep=8). PG EXTRACT MONTH is 1-indexed.
  -- JS check: month < 8 (Jan–Aug) → previous Sep.
  -- PG equivalent: month <= 8 (Jan–Aug) → previous Sep. Note Aug is included
  -- in "previous season" both ways: JS month 7 (Aug) < 8 = true; PG month 8
  -- (Aug) <= 8 = true. Sep flips: JS month 8 (Sep) < 8 = false; PG month 9
  -- (Sep) <= 8 = false. Aligned.
  IF v_month <= 8 THEN
    RETURN make_date(v_year - 1, 9, 1);
  ELSE
    RETURN make_date(v_year, 9, 1);
  END IF;
END;
$$;


--
-- Name: FUNCTION kscw_current_season_start(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.kscw_current_season_start() IS 'Sep 1 of the current season (Sep–Aug). Mirrors getCurrentSeason() in src/utils/dateHelpers.ts. STABLE (not IMMUTABLE — depends on now()); do not use in indexes or generated columns.';


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
      RETURN (kscw_current_season_start()::timestamp AT TIME ZONE 'Europe/Zurich');
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

COMMENT ON FUNCTION public.kscw_fine_window_start(p_window text, p_ts timestamp with time zone) IS 'Start timestamp of the offense-counter window for a fine_rules.reset_window value. calendar_month/season anchor to Europe/Zurich wall-clock (1st of month / Sep 1); rolling windows subtract N days from now.';


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
    ELSE
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
-- Name: trg_scorer_delegation_validate(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trg_scorer_delegation_validate() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  -- Auto-set same_team flag
  NEW.same_team := (NEW.from_team = NEW.to_team);
  -- Auto-accept same-team delegations
  IF NEW.same_team = true AND (TG_OP = 'INSERT') THEN
    NEW.status := 'accepted';
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
-- Name: extensions; Type: TABLE; Schema: _realtime; Owner: -
--

CREATE TABLE _realtime.extensions (
    id uuid NOT NULL,
    type text,
    settings jsonb,
    tenant_external_id text,
    inserted_at timestamp(0) without time zone NOT NULL,
    updated_at timestamp(0) without time zone NOT NULL
);


--
-- Name: schema_migrations; Type: TABLE; Schema: _realtime; Owner: -
--

CREATE TABLE _realtime.schema_migrations (
    version bigint NOT NULL,
    inserted_at timestamp(0) without time zone
);


--
-- Name: tenants; Type: TABLE; Schema: _realtime; Owner: -
--

CREATE TABLE _realtime.tenants (
    id uuid NOT NULL,
    name text,
    external_id text,
    jwt_secret text,
    max_concurrent_users integer DEFAULT 200 NOT NULL,
    inserted_at timestamp(0) without time zone NOT NULL,
    updated_at timestamp(0) without time zone NOT NULL,
    max_events_per_second integer DEFAULT 100 NOT NULL,
    postgres_cdc_default text DEFAULT 'postgres_cdc_rls'::text,
    max_bytes_per_second integer DEFAULT 100000 NOT NULL,
    max_channels_per_client integer DEFAULT 100 NOT NULL,
    max_joins_per_second integer DEFAULT 500 NOT NULL,
    suspend boolean DEFAULT false,
    jwt_jwks jsonb,
    notify_private_alpha boolean DEFAULT false,
    private_only boolean DEFAULT false NOT NULL
);


--
-- Name: Features; Type: TABLE; Schema: p6pi0hr30o0mop9; Owner: -
--

CREATE TABLE p6pi0hr30o0mop9."Features" (
    id integer NOT NULL,
    created_at timestamp without time zone,
    updated_at timestamp without time zone,
    created_by character varying,
    updated_by character varying,
    nc_order numeric,
    nc_row_meta jsonb,
    title text
);


--
-- Name: Features_id_seq; Type: SEQUENCE; Schema: p6pi0hr30o0mop9; Owner: -
--

CREATE SEQUENCE p6pi0hr30o0mop9."Features_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: Features_id_seq; Type: SEQUENCE OWNED BY; Schema: p6pi0hr30o0mop9; Owner: -
--

ALTER SEQUENCE p6pi0hr30o0mop9."Features_id_seq" OWNED BY p6pi0hr30o0mop9."Features".id;


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
    date_updated timestamp with time zone
);


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
    CONSTRAINT broadcasts_activity_type_check CHECK (((activity_type)::text = ANY ((ARRAY['event'::character varying, 'game'::character varying, 'training'::character varying])::text[])))
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
-- Name: carpool_passengers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.carpool_passengers (
    id integer NOT NULL,
    status character varying(255) DEFAULT NULL::character varying,
    carpool integer,
    passenger integer,
    date_created timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    date_updated timestamp with time zone
);


--
-- Name: carpool_passengers_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.carpool_passengers_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: carpool_passengers_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.carpool_passengers_id_seq OWNED BY public.carpool_passengers.id;


--
-- Name: carpools; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.carpools (
    id integer NOT NULL,
    seats_available integer,
    departure_time time without time zone,
    departure_location character varying(255) DEFAULT NULL::character varying,
    notes text,
    status character varying(255) DEFAULT NULL::character varying,
    game integer,
    driver integer,
    date_created timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    date_updated timestamp with time zone
);


--
-- Name: carpools_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.carpools_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: carpools_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.carpools_id_seq OWNED BY public.carpools.id;


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
    rolle_bracketed text
);


--
-- Name: clubdesk_people; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.clubdesk_people AS
 SELECT DISTINCT ON (COALESCE(NULLIF(clubdesk_export.clubdesk_id, ''::text), lower(NULLIF(clubdesk_export.email, ''::text)))) clubdesk_export.clubdesk_id,
    clubdesk_export.nachname,
    clubdesk_export.vorname,
    clubdesk_export.email,
    clubdesk_export.email_alternativ,
    clubdesk_export.status,
    clubdesk_export.geschlecht,
    clubdesk_export.geburtsdatum,
    clubdesk_export.jahrgang,
    clubdesk_export.alter_,
    clubdesk_export.lizenznummer,
    clubdesk_export.lizenzart,
    clubdesk_export.sektion,
    clubdesk_export.beitragskategorie,
    clubdesk_export.offiziellen_lizenz,
    clubdesk_export.passivmitglied,
    clubdesk_export.telefon_mobil,
    clubdesk_export.gruppen,
    clubdesk_export.imported_at
   FROM public.clubdesk_export
  ORDER BY COALESCE(NULLIF(clubdesk_export.clubdesk_id, ''::text), lower(NULLIF(clubdesk_export.email, ''::text))), clubdesk_export.row_id;


--
-- Name: clubdesk_basketball; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.clubdesk_basketball AS
 SELECT clubdesk_people.clubdesk_id,
    clubdesk_people.nachname,
    clubdesk_people.vorname,
    clubdesk_people.email,
    clubdesk_people.email_alternativ,
    clubdesk_people.status,
    clubdesk_people.geschlecht,
    clubdesk_people.geburtsdatum,
    clubdesk_people.jahrgang,
    clubdesk_people.alter_,
    clubdesk_people.lizenznummer,
    clubdesk_people.lizenzart,
    clubdesk_people.sektion,
    clubdesk_people.beitragskategorie,
    clubdesk_people.offiziellen_lizenz,
    clubdesk_people.passivmitglied,
    clubdesk_people.telefon_mobil,
    clubdesk_people.gruppen,
    clubdesk_people.imported_at
   FROM public.clubdesk_people
  WHERE (clubdesk_people.sektion = 'Basketball'::text);


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
-- Name: clubdesk_volleyball; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.clubdesk_volleyball AS
 SELECT clubdesk_people.clubdesk_id,
    clubdesk_people.nachname,
    clubdesk_people.vorname,
    clubdesk_people.email,
    clubdesk_people.email_alternativ,
    clubdesk_people.status,
    clubdesk_people.geschlecht,
    clubdesk_people.geburtsdatum,
    clubdesk_people.jahrgang,
    clubdesk_people.alter_,
    clubdesk_people.lizenznummer,
    clubdesk_people.lizenzart,
    clubdesk_people.sektion,
    clubdesk_people.beitragskategorie,
    clubdesk_people.offiziellen_lizenz,
    clubdesk_people.passivmitglied,
    clubdesk_people.telefon_mobil,
    clubdesk_people.gruppen,
    clubdesk_people.imported_at
   FROM public.clubdesk_people
  WHERE (clubdesk_people.sektion = 'Volleyball'::text);


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
    CONSTRAINT conversations_shape_check CHECK (((((type)::text = 'team'::text) AND (team IS NOT NULL) AND (activity_type IS NULL) AND (activity_id IS NULL)) OR (((type)::text = ANY ((ARRAY['dm'::character varying, 'dm_request'::character varying, 'group_dm'::character varying])::text[])) AND (team IS NULL) AND (activity_type IS NULL) AND (activity_id IS NULL)) OR (((type)::text = 'activity_chat'::text) AND (team IS NULL) AND (activity_type IS NOT NULL) AND (activity_id IS NOT NULL))))
);


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
    cancel_reason text
);


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
    events_id integer,
    members_id integer
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
    events_id integer,
    teams_id integer
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
    "user" integer
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
    CONSTRAINT finance_accounts_division_check CHECK (((division IS NULL) OR ((division)::text = ANY ((ARRAY['club'::character varying, 'vb'::character varying, 'bb'::character varying])::text[])))),
    CONSTRAINT finance_accounts_source_check CHECK (((source)::text = ANY ((ARRAY['clubdesk'::character varying, 'native'::character varying])::text[]))),
    CONSTRAINT finance_accounts_type_check CHECK (((type IS NULL) OR ((type)::text = ANY ((ARRAY['asset'::character varying, 'liability'::character varying, 'equity'::character varying, 'income'::character varying, 'expense'::character varying, 'close'::character varying])::text[]))))
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
    CONSTRAINT finance_budget_lines_source_check CHECK (((source)::text = ANY ((ARRAY['clubdesk'::character varying, 'native'::character varying])::text[])))
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
    CONSTRAINT finance_fiscal_years_source_check CHECK (((source)::text = ANY ((ARRAY['clubdesk'::character varying, 'native'::character varying])::text[]))),
    CONSTRAINT finance_fiscal_years_status_check CHECK (((status)::text = ANY ((ARRAY['open'::character varying, 'closed'::character varying])::text[])))
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
    CONSTRAINT finance_imports_type_check CHECK (((import_type)::text = ANY ((ARRAY['invoices'::character varying, 'bookings'::character varying, 'accounts'::character varying, 'budget'::character varying, 'payments'::character varying])::text[])))
);


--
-- Name: TABLE finance_imports; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.finance_imports IS 'One row per ClubDesk finance sync/import. Records WHO (imported_by_*), WHAT (import_type), and how many rows — the finance equivalent of the audit-log actor capture for the raw-knex import path.';


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
-- Name: finance_invoices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.finance_invoices (
    id integer NOT NULL,
    clubdesk_id character varying(32) NOT NULL,
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
    CONSTRAINT finance_invoices_source_check CHECK (((source)::text = ANY ((ARRAY['clubdesk'::character varying, 'native'::character varying])::text[])))
);


--
-- Name: TABLE finance_invoices; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.finance_invoices IS 'Member invoices/dues mirrored from the ClubDesk Rechnungen export. Invoice fields + a member link ONLY — AHV/IBAN/home address present in the source CSV are deliberately NOT mirrored (keep the finance module low-PII). number is NULL for draft (Entwurf) invoices; clubdesk_id ([Id]) is the stable upsert key. member matched on recipient_email, fallback cd_benutzer_id.';


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
    CONSTRAINT finance_payments_source_check CHECK (((source)::text = ANY ((ARRAY['clubdesk'::character varying, 'native'::character varying])::text[])))
);


--
-- Name: TABLE finance_payments; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.finance_payments IS 'Individual payments against invoices. Created now for Scope C (camt.053/054 reconciliation); stays empty under Scope A, where paid/open amounts are read directly off finance_invoices.';


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
    CONSTRAINT finance_transactions_source_check CHECK (((source)::text = ANY ((ARRAY['clubdesk'::character varying, 'native'::character varying])::text[])))
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
    CONSTRAINT fine_rules_category_check CHECK (((category)::text = ANY ((ARRAY['late_signin'::character varying, 'no_show'::character varying, 'late_payment'::character varying, 'custom'::character varying])::text[]))),
    CONSTRAINT fine_rules_reset_window_check CHECK (((reset_window)::text = ANY ((ARRAY['calendar_month'::character varying, 'rolling_30d'::character varying, 'rolling_90d'::character varying, 'season'::character varying, 'never'::character varying])::text[])))
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
    CONSTRAINT fines_activity_type_check CHECK (((activity_type IS NULL) OR ((activity_type)::text = ANY ((ARRAY['training'::character varying, 'game'::character varying, 'event'::character varying])::text[])))),
    CONSTRAINT fines_amount_nonneg CHECK ((amount >= (0)::numeric)),
    CONSTRAINT fines_category_check CHECK (((category)::text = ANY ((ARRAY['late_signin'::character varying, 'no_show'::character varying, 'late_payment'::character varying, 'custom'::character varying])::text[]))),
    CONSTRAINT fines_paid_method_check CHECK (((paid_method IS NULL) OR ((paid_method)::text = ANY ((ARRAY['cash'::character varying, 'twint'::character varying, 'transfer'::character varying, 'other'::character varying])::text[])))),
    CONSTRAINT fines_paid_to_check CHECK (((paid_to IS NULL) OR ((paid_to)::text = ANY ((ARRAY['team_kasse'::character varying, 'club_kasse'::character varying])::text[])))),
    CONSTRAINT fines_status_check CHECK (((status)::text = ANY ((ARRAY['open'::character varying, 'paid'::character varying, 'waived'::character varying])::text[])))
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
    forms_id integer,
    teams_id integer
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
-- Name: game_scheduling_bookings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.game_scheduling_bookings (
    id integer NOT NULL,
    season character varying(255) DEFAULT NULL::character varying,
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
    game integer,
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
    confirmed_at timestamp with time zone
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
    team_contact_email text
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
    season_closes date
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
    season character varying(255) DEFAULT NULL::character varying,
    date date,
    start_time time without time zone,
    end_time time without time zone,
    source character varying(255) DEFAULT NULL::character varying,
    status character varying(255) DEFAULT NULL::character varying,
    kscw_team integer,
    hall integer,
    booking integer,
    game integer,
    date_created timestamp with time zone,
    date_updated timestamp with time zone
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
    auto_confirm_rsvp boolean
);


--
-- Name: COLUMN games.auto_confirm_rsvp; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.games.auto_confirm_rsvp IS 'NULL = inherit teams.features_enabled.game_auto_confirm. true/false = per-activity override.';


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
    date_updated timestamp with time zone
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
-- Name: hall_events_halls; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hall_events_halls (
    id integer NOT NULL,
    hall_events_id integer,
    halls_id integer
);


--
-- Name: hall_events_halls_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.hall_events_halls_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: hall_events_halls_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.hall_events_halls_id_seq OWNED BY public.hall_events_halls.id;


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
    hall_slots_id integer,
    teams_id integer
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
    member integer,
    team integer,
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
    "position" json,
    photo uuid,
    role json,
    kscw_membership_active boolean DEFAULT true NOT NULL,
    birthdate date,
    licences json,
    coach_approved_team boolean DEFAULT false NOT NULL,
    language character varying(255) DEFAULT 'german'::character varying,
    hide_phone boolean DEFAULT false NOT NULL,
    birthdate_visibility character varying(255) DEFAULT 'full'::character varying,
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
    CONSTRAINT members_role_values_valid CHECK (((role)::jsonb <@ '["user", "admin", "superuser", "vb_admin", "bb_admin", "vorstand", "website_admin"]'::jsonb))
);


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

COMMENT ON COLUMN public.members.otn_bb IS 'Basketball OTN (table official, national). Sourced from ClubDesk Offizielle Lizenz.';


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
-- Name: members_with_photo; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.members_with_photo WITH (security_invoker='true') AS
 SELECT m.id,
    m.email,
    m.first_name,
    m.last_name,
    m.phone,
    m.license_nr,
    m.number,
    m."position",
    m.photo,
    m.role,
    m.kscw_membership_active,
    m.birthdate,
    m.licences,
    m.coach_approved_team,
    m.language,
    m.hide_phone,
    m.birthdate_visibility,
    m.website_visible,
    m.wiedisync_active,
    m.shell,
    m.shell_expires,
    m.shell_reminder_sent,
    m.requested_team,
    m."user",
    m.date_created,
    m.date_updated,
    m.is_spielplaner,
    m.adresse,
    m.plz,
    m.ort,
    m.nationalitaet,
    m.anrede,
    m.sex,
    m.ahv_nummer,
    m.beitragskategorie,
        CASE
            WHEN (m.photo IS NOT NULL) THEN ('/storage/v1/object/public/kscw-files/'::text || o.name)
            ELSE NULL::text
        END AS photo_url
   FROM (public.members m
     LEFT JOIN storage.objects o ON (((o.bucket_id = 'kscw-files'::text) AND (o.name ~~ (m.photo || '%'::text)))));


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
    last_note_edited_at timestamp with time zone
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
-- Name: query_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.query_templates (
    id integer NOT NULL
);


--
-- Name: query_templates_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.query_templates_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: query_templates_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.query_templates_id_seq OWNED BY public.query_templates.id;


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
    amount real,
    notes text,
    game integer,
    team integer,
    paid_by_member integer,
    recorded_by integer,
    date_created timestamp with time zone,
    date_updated timestamp with time zone
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
    rejection_reason text
);


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
    CONSTRAINT scheduling_emails_direction_check CHECK (((direction)::text = ANY ((ARRAY['in'::character varying, 'out'::character varying])::text[])))
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
    date_updated timestamp with time zone
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
-- Name: sponsors_with_logo; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.sponsors_with_logo WITH (security_invoker='true') AS
 SELECT s.id,
    s.name,
    s.logo,
    s.website_url,
    s.sort_order,
    s.active,
    s.team_page_only,
    s.date_created,
    s.date_updated,
        CASE
            WHEN (s.logo IS NOT NULL) THEN ('/storage/v1/object/public/kscw-files/'::text || o.name)
            ELSE NULL::text
        END AS logo_url
   FROM (public.sponsors s
     LEFT JOIN storage.objects o ON (((o.bucket_id = 'kscw-files'::text) AND (o.name ~~ ((s.logo)::text || '%'::text)))));


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
    recruiting_positions jsonb
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
          WHERE ((mt.guest_level = 0) AND ((m.role)::jsonb @> '"vorstand"'::jsonb))) AS vb_vorstand,
    ( SELECT count(DISTINCT m.id) AS count
           FROM ((public.member_teams mt
             JOIN public.teams t ON (((t.id = mt.team) AND (t.active = true) AND ((t.sport)::text = 'basketball'::text))))
             JOIN public.members m ON ((m.id = mt.member)))
          WHERE ((mt.guest_level = 0) AND ((m.role)::jsonb @> '"vorstand"'::jsonb))) AS bb_vorstand,
    ( SELECT count(DISTINCT m.id) AS count
           FROM ((public.member_teams mt
             JOIN public.teams t ON (((t.id = mt.team) AND (t.active = true) AND ((t.sport)::text = 'volleyball'::text))))
             JOIN public.members m ON ((m.id = mt.member)))
          WHERE ((mt.guest_level = 0) AND (((m.role)::jsonb @> '"admin"'::jsonb) OR ((m.role)::jsonb @> '"superuser"'::jsonb)))) AS vb_admins,
    ( SELECT count(DISTINCT m.id) AS count
           FROM ((public.member_teams mt
             JOIN public.teams t ON (((t.id = mt.team) AND (t.active = true) AND ((t.sport)::text = 'basketball'::text))))
             JOIN public.members m ON ((m.id = mt.member)))
          WHERE ((mt.guest_level = 0) AND (((m.role)::jsonb @> '"admin"'::jsonb) OR ((m.role)::jsonb @> '"superuser"'::jsonb)))) AS bb_admins,
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
    COALESCE(g.scorer_duty_team, g.bb_duty_team) AS duty_team_id
   FROM (public.games g
     JOIN public.teams t ON ((t.id = g.kscw_team)))
  WHERE (((g.type)::text = 'home'::text) AND (g.date >= CURRENT_DATE) AND ((g.status)::text = ANY ((ARRAY['scheduled'::character varying, 'live'::character varying])::text[])) AND ((((t.sport)::text = 'volleyball'::text) AND (g.scorer_member IS NULL) AND (g.scoreboard_member IS NULL) AND (g.scorer_scoreboard_member IS NULL)) OR (((t.sport)::text = 'basketball'::text) AND (g.bb_scorer_member IS NULL) AND (g.bb_timekeeper_member IS NULL) AND (g.bb_24s_official IS NULL))))
  ORDER BY g.date, g."time";


--
-- Name: stats_members; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.stats_members WITH (security_invoker='true') AS
 SELECT count(*) AS total_members,
    count(*) FILTER (WHERE (members.wiedisync_active = true)) AS active_wiedisync,
    count(*) FILTER (WHERE (members.shell = true)) AS shell_accounts,
    count(*) FILTER (WHERE ((members.shell = false) AND (members.wiedisync_active = true))) AS registered_users,
    count(*) FILTER (WHERE members.scorer_vb) AS licence_scorer_vb,
    count(*) FILTER (WHERE members.referee_vb) AS licence_referee_vb,
    count(*) FILTER (WHERE members.otr1_bb) AS licence_otr1_bb,
    count(*) FILTER (WHERE members.otr2_bb) AS licence_otr2_bb,
    count(*) FILTER (WHERE ((members.role)::jsonb @> '"superuser"'::jsonb)) AS role_superuser,
    count(*) FILTER (WHERE ((members.role)::jsonb @> '"admin"'::jsonb)) AS role_admin,
    count(*) FILTER (WHERE ((members.role)::jsonb @> '"vb_admin"'::jsonb)) AS role_vb_admin,
    count(*) FILTER (WHERE ((members.role)::jsonb @> '"bb_admin"'::jsonb)) AS role_bb_admin,
    count(*) FILTER (WHERE ((members.role)::jsonb @> '"vorstand"'::jsonb)) AS role_vorstand
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
  GROUP BY t.id, t.name, t.sport;


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
-- Name: task_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.task_templates (
    id integer NOT NULL,
    name character varying(255) DEFAULT NULL::character varying,
    tasks_json json,
    team integer,
    created_by integer,
    date_created timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    date_updated timestamp with time zone
);


--
-- Name: task_templates_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.task_templates_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: task_templates_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.task_templates_id_seq OWNED BY public.task_templates.id;


--
-- Name: tasks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tasks (
    id integer NOT NULL,
    activity_type character varying(255) DEFAULT NULL::character varying,
    activity_id character varying(255) DEFAULT NULL::character varying,
    label character varying(255) DEFAULT NULL::character varying,
    category character varying(255) DEFAULT NULL::character varying,
    completed boolean DEFAULT false NOT NULL,
    completed_at timestamp with time zone,
    sort_order integer,
    assigned_to integer,
    claimed_by integer,
    created_by integer,
    date_created timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    date_updated timestamp with time zone
);


--
-- Name: tasks_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tasks_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tasks_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tasks_id_seq OWNED BY public.tasks.id;


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
    teams_id integer,
    members_id integer
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
    teams_id integer,
    members_id integer
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
    teams_id integer,
    sponsors_id integer
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
-- Name: Features id; Type: DEFAULT; Schema: p6pi0hr30o0mop9; Owner: -
--

ALTER TABLE ONLY p6pi0hr30o0mop9."Features" ALTER COLUMN id SET DEFAULT nextval('p6pi0hr30o0mop9."Features_id_seq"'::regclass);


--
-- Name: absences id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.absences ALTER COLUMN id SET DEFAULT nextval('public.absences_id_seq'::regclass);


--
-- Name: announcements id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.announcements ALTER COLUMN id SET DEFAULT nextval('public.announcements_id_seq'::regclass);


--
-- Name: app_settings id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_settings ALTER COLUMN id SET DEFAULT nextval('public.app_settings_id_seq'::regclass);


--
-- Name: broadcasts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.broadcasts ALTER COLUMN id SET DEFAULT nextval('public.broadcasts_id_seq'::regclass);


--
-- Name: bugfix_jobs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bugfix_jobs ALTER COLUMN id SET DEFAULT nextval('public.bugfix_jobs_id_seq'::regclass);


--
-- Name: carpool_passengers id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.carpool_passengers ALTER COLUMN id SET DEFAULT nextval('public.carpool_passengers_id_seq'::regclass);


--
-- Name: carpools id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.carpools ALTER COLUMN id SET DEFAULT nextval('public.carpools_id_seq'::regclass);


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
-- Name: finance_budget_lines id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_budget_lines ALTER COLUMN id SET DEFAULT nextval('public.finance_budget_lines_id_seq'::regclass);


--
-- Name: finance_fiscal_years id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_fiscal_years ALTER COLUMN id SET DEFAULT nextval('public.finance_fiscal_years_id_seq'::regclass);


--
-- Name: finance_imports id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_imports ALTER COLUMN id SET DEFAULT nextval('public.finance_imports_id_seq'::regclass);


--
-- Name: finance_invoices id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_invoices ALTER COLUMN id SET DEFAULT nextval('public.finance_invoices_id_seq'::regclass);


--
-- Name: finance_payments id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_payments ALTER COLUMN id SET DEFAULT nextval('public.finance_payments_id_seq'::regclass);


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
-- Name: game_scheduling_bookings id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_scheduling_bookings ALTER COLUMN id SET DEFAULT nextval('public.game_scheduling_bookings_id_seq'::regclass);


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
-- Name: hall_events_halls id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hall_events_halls ALTER COLUMN id SET DEFAULT nextval('public.hall_events_halls_id_seq'::regclass);


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
-- Name: query_templates id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.query_templates ALTER COLUMN id SET DEFAULT nextval('public.query_templates_id_seq'::regclass);


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
-- Name: scheduling_emails id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scheduling_emails ALTER COLUMN id SET DEFAULT nextval('public.scheduling_emails_id_seq'::regclass);


--
-- Name: scorer_courses id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scorer_courses ALTER COLUMN id SET DEFAULT nextval('public.scorer_courses_id_seq'::regclass);


--
-- Name: scorer_delegations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scorer_delegations ALTER COLUMN id SET DEFAULT nextval('public.scorer_delegations_id_seq'::regclass);


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
-- Name: task_templates id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_templates ALTER COLUMN id SET DEFAULT nextval('public.task_templates_id_seq'::regclass);


--
-- Name: tasks id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks ALTER COLUMN id SET DEFAULT nextval('public.tasks_id_seq'::regclass);


--
-- Name: team_invites id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_invites ALTER COLUMN id SET DEFAULT nextval('public.team_invites_id_seq'::regclass);


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
-- Name: trainings id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trainings ALTER COLUMN id SET DEFAULT nextval('public.trainings_id_seq'::regclass);


--
-- Name: user_logs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_logs ALTER COLUMN id SET DEFAULT nextval('public.user_logs_id_seq'::regclass);


--
-- Name: vm_vb_spielplan_contact id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vm_vb_spielplan_contact ALTER COLUMN id SET DEFAULT nextval('public.vm_vb_spielplan_contact_id_seq'::regclass);


--
-- Name: website_admin_access id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.website_admin_access ALTER COLUMN id SET DEFAULT nextval('public.website_admin_access_id_seq'::regclass);


--
-- Name: extensions extensions_pkey; Type: CONSTRAINT; Schema: _realtime; Owner: -
--

ALTER TABLE ONLY _realtime.extensions
    ADD CONSTRAINT extensions_pkey PRIMARY KEY (id);


--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: _realtime; Owner: -
--

ALTER TABLE ONLY _realtime.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (version);


--
-- Name: tenants tenants_pkey; Type: CONSTRAINT; Schema: _realtime; Owner: -
--

ALTER TABLE ONLY _realtime.tenants
    ADD CONSTRAINT tenants_pkey PRIMARY KEY (id);


--
-- Name: Features Features_pkey; Type: CONSTRAINT; Schema: p6pi0hr30o0mop9; Owner: -
--

ALTER TABLE ONLY p6pi0hr30o0mop9."Features"
    ADD CONSTRAINT "Features_pkey" PRIMARY KEY (id);


--
-- Name: absences absences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.absences
    ADD CONSTRAINT absences_pkey PRIMARY KEY (id);


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
-- Name: carpool_passengers carpool_passengers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.carpool_passengers
    ADD CONSTRAINT carpool_passengers_pkey PRIMARY KEY (id);


--
-- Name: carpools carpools_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.carpools
    ADD CONSTRAINT carpools_pkey PRIMARY KEY (id);


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
-- Name: finance_payments finance_payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_payments
    ADD CONSTRAINT finance_payments_pkey PRIMARY KEY (id);


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
-- Name: game_scheduling_bookings game_scheduling_bookings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_scheduling_bookings
    ADD CONSTRAINT game_scheduling_bookings_pkey PRIMARY KEY (id);


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
-- Name: hall_events_halls hall_events_halls_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hall_events_halls
    ADD CONSTRAINT hall_events_halls_pkey PRIMARY KEY (id);


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
-- Name: push_subscriptions push_subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_pkey PRIMARY KEY (id);


--
-- Name: query_templates query_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.query_templates
    ADD CONSTRAINT query_templates_pkey PRIMARY KEY (id);


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
-- Name: scheduling_emails scheduling_emails_message_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scheduling_emails
    ADD CONSTRAINT scheduling_emails_message_id_unique UNIQUE (message_id);


--
-- Name: scheduling_emails scheduling_emails_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scheduling_emails
    ADD CONSTRAINT scheduling_emails_pkey PRIMARY KEY (id);


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
-- Name: task_templates task_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_templates
    ADD CONSTRAINT task_templates_pkey PRIMARY KEY (id);


--
-- Name: tasks tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_pkey PRIMARY KEY (id);


--
-- Name: team_invites team_invites_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_invites
    ADD CONSTRAINT team_invites_pkey PRIMARY KEY (id);


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
-- Name: extensions_tenant_external_id_index; Type: INDEX; Schema: _realtime; Owner: -
--

CREATE INDEX extensions_tenant_external_id_index ON _realtime.extensions USING btree (tenant_external_id);


--
-- Name: extensions_tenant_external_id_type_index; Type: INDEX; Schema: _realtime; Owner: -
--

CREATE UNIQUE INDEX extensions_tenant_external_id_type_index ON _realtime.extensions USING btree (tenant_external_id, type);


--
-- Name: tenants_external_id_index; Type: INDEX; Schema: _realtime; Owner: -
--

CREATE UNIQUE INDEX tenants_external_id_index ON _realtime.tenants USING btree (external_id);


--
-- Name: Features_order_idx; Type: INDEX; Schema: p6pi0hr30o0mop9; Owner: -
--

CREATE INDEX "Features_order_idx" ON p6pi0hr30o0mop9."Features" USING btree (nc_order);


--
-- Name: absences_member_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX absences_member_index ON public.absences USING btree (member);


--
-- Name: blocks_blocked_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX blocks_blocked_index ON public.blocks USING btree (blocked);


--
-- Name: blocks_blocker_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX blocks_blocker_index ON public.blocks USING btree (blocker);


--
-- Name: carpool_passengers_carpool_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX carpool_passengers_carpool_index ON public.carpool_passengers USING btree (carpool);


--
-- Name: carpool_passengers_passenger_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX carpool_passengers_passenger_index ON public.carpool_passengers USING btree (passenger);


--
-- Name: carpools_driver_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX carpools_driver_index ON public.carpools USING btree (driver);


--
-- Name: carpools_game_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX carpools_game_index ON public.carpools USING btree (game);


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
-- Name: finance_budget_lines_fy_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX finance_budget_lines_fy_idx ON public.finance_budget_lines USING btree (fiscal_year);


--
-- Name: finance_imports_type_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX finance_imports_type_at_idx ON public.finance_imports USING btree (import_type, imported_at DESC);


--
-- Name: finance_invoices_due_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX finance_invoices_due_idx ON public.finance_invoices USING btree (due_date);


--
-- Name: finance_invoices_member_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX finance_invoices_member_status_idx ON public.finance_invoices USING btree (member, status);


--
-- Name: finance_invoices_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX finance_invoices_status_idx ON public.finance_invoices USING btree (status);


--
-- Name: finance_payments_invoice_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX finance_payments_invoice_idx ON public.finance_payments USING btree (invoice);


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
-- Name: forms_teams_teams_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX forms_teams_teams_id_idx ON public.forms_teams USING btree (teams_id);


--
-- Name: game_scheduling_bookings_game_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX game_scheduling_bookings_game_index ON public.game_scheduling_bookings USING btree (game);


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
-- Name: game_scheduling_slots_booking_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX game_scheduling_slots_booking_index ON public.game_scheduling_slots USING btree (booking);


--
-- Name: game_scheduling_slots_game_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX game_scheduling_slots_game_index ON public.game_scheduling_slots USING btree (game);


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
-- Name: hall_slots_hall_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX hall_slots_hall_index ON public.hall_slots USING btree (hall);


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
-- Name: idx_slot_claims_active_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_slot_claims_active_unique ON public.slot_claims USING btree (hall_slot, date) WHERE ((status)::text = 'active'::text);


--
-- Name: idx_spielplaner_assignments_kscw_team; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_spielplaner_assignments_kscw_team ON public.spielplaner_assignments USING btree (kscw_team);


--
-- Name: idx_spielplaner_assignments_member; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_spielplaner_assignments_member ON public.spielplaner_assignments USING btree (member);


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
-- Name: members_requested_team_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX members_requested_team_index ON public.members USING btree (requested_team);


--
-- Name: members_user_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX members_user_index ON public.members USING btree ("user");


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
-- Name: messages_conversation_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX messages_conversation_index ON public.messages USING btree (conversation);


--
-- Name: messages_sender_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX messages_sender_index ON public.messages USING btree (sender);


--
-- Name: notifications_member_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notifications_member_index ON public.notifications USING btree (member);


--
-- Name: notifications_team_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notifications_team_index ON public.notifications USING btree (team);


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
-- Name: reports_conversation_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX reports_conversation_index ON public.reports USING btree (conversation);


--
-- Name: reports_message_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX reports_message_index ON public.reports USING btree (message);


--
-- Name: reports_reported_member_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX reports_reported_member_index ON public.reports USING btree (reported_member);


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
-- Name: scheduling_emails_date_sent_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX scheduling_emails_date_sent_idx ON public.scheduling_emails USING btree (date_sent DESC NULLS LAST);


--
-- Name: scheduling_emails_unread_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX scheduling_emails_unread_idx ON public.scheduling_emails USING btree (direction) WHERE (read_at IS NULL);


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
-- Name: spielplaner_assignments_kscw_team_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX spielplaner_assignments_kscw_team_index ON public.spielplaner_assignments USING btree (kscw_team);


--
-- Name: spielplaner_assignments_member_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX spielplaner_assignments_member_index ON public.spielplaner_assignments USING btree (member);


--
-- Name: task_templates_created_by_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX task_templates_created_by_index ON public.task_templates USING btree (created_by);


--
-- Name: task_templates_team_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX task_templates_team_index ON public.task_templates USING btree (team);


--
-- Name: tasks_assigned_to_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tasks_assigned_to_index ON public.tasks USING btree (assigned_to);


--
-- Name: tasks_claimed_by_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tasks_claimed_by_index ON public.tasks USING btree (claimed_by);


--
-- Name: tasks_created_by_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tasks_created_by_index ON public.tasks USING btree (created_by);


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
-- Name: user_logs_user_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_logs_user_index ON public.user_logs USING btree ("user");


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
-- Name: events trg_activity_chat_event_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_activity_chat_event_delete AFTER DELETE ON public.events FOR EACH ROW EXECUTE FUNCTION public.fn_activity_chat_event_delete();


--
-- Name: events trg_events_notify; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_events_notify AFTER INSERT OR DELETE OR UPDATE ON public.events FOR EACH ROW EXECUTE FUNCTION public.trg_events_notify();


--
-- Name: games trg_games_notify; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_games_notify AFTER INSERT OR DELETE OR UPDATE ON public.games FOR EACH ROW EXECUTE FUNCTION public.trg_games_notify();


--
-- Name: halls trg_halls_protect_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_halls_protect_delete BEFORE DELETE ON public.halls FOR EACH ROW EXECUTE FUNCTION public.trg_protect_hall_delete();


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
-- Name: scorer_delegations trg_scorer_delegation_validate; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_scorer_delegation_validate BEFORE INSERT ON public.scorer_delegations FOR EACH ROW EXECUTE FUNCTION public.trg_scorer_delegation_validate();


--
-- Name: slot_claims trg_slot_claims_validate; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_slot_claims_validate BEFORE INSERT OR UPDATE ON public.slot_claims FOR EACH ROW EXECUTE FUNCTION public.trg_slot_claims_validate();


--
-- Name: teams trg_teams_protect_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_teams_protect_delete BEFORE DELETE ON public.teams FOR EACH ROW EXECUTE FUNCTION public.trg_protect_team_delete();


--
-- Name: teams trg_teams_release_derby_host; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_teams_release_derby_host BEFORE DELETE ON public.teams FOR EACH ROW EXECUTE FUNCTION public.trg_teams_release_derby_host();


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
-- Name: extensions extensions_tenant_external_id_fkey; Type: FK CONSTRAINT; Schema: _realtime; Owner: -
--

ALTER TABLE ONLY _realtime.extensions
    ADD CONSTRAINT extensions_tenant_external_id_fkey FOREIGN KEY (tenant_external_id) REFERENCES _realtime.tenants(external_id) ON DELETE CASCADE;


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
-- Name: carpool_passengers carpool_passengers_carpool_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.carpool_passengers
    ADD CONSTRAINT carpool_passengers_carpool_foreign FOREIGN KEY (carpool) REFERENCES public.carpools(id) ON DELETE CASCADE;


--
-- Name: carpool_passengers carpool_passengers_passenger_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.carpool_passengers
    ADD CONSTRAINT carpool_passengers_passenger_foreign FOREIGN KEY (passenger) REFERENCES public.members(id) ON DELETE CASCADE;


--
-- Name: carpools carpools_driver_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.carpools
    ADD CONSTRAINT carpools_driver_foreign FOREIGN KEY (driver) REFERENCES public.members(id) ON DELETE CASCADE;


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
-- Name: finance_invoices finance_invoices_fiscal_year_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_invoices
    ADD CONSTRAINT finance_invoices_fiscal_year_fkey FOREIGN KEY (fiscal_year) REFERENCES public.finance_fiscal_years(id) ON DELETE SET NULL;


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
-- Name: finance_payments finance_payments_import_batch_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_payments
    ADD CONSTRAINT finance_payments_import_batch_fkey FOREIGN KEY (import_batch) REFERENCES public.finance_imports(id) ON DELETE SET NULL;


--
-- Name: finance_payments finance_payments_invoice_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_payments
    ADD CONSTRAINT finance_payments_invoice_fkey FOREIGN KEY (invoice) REFERENCES public.finance_invoices(id) ON DELETE CASCADE;


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
-- Name: finance_transactions finance_transactions_fiscal_year_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_transactions
    ADD CONSTRAINT finance_transactions_fiscal_year_fkey FOREIGN KEY (fiscal_year) REFERENCES public.finance_fiscal_years(id) ON DELETE SET NULL;


--
-- Name: finance_transactions finance_transactions_import_batch_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_transactions
    ADD CONSTRAINT finance_transactions_import_batch_fkey FOREIGN KEY (import_batch) REFERENCES public.finance_imports(id) ON DELETE SET NULL;


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
    ADD CONSTRAINT fines_member_fkey FOREIGN KEY (member) REFERENCES public.members(id) ON DELETE CASCADE;


--
-- Name: fines fines_paid_received_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fines
    ADD CONSTRAINT fines_paid_received_by_fkey FOREIGN KEY (paid_received_by) REFERENCES public.members(id) ON DELETE SET NULL;


--
-- Name: fines fines_team_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fines
    ADD CONSTRAINT fines_team_fkey FOREIGN KEY (team) REFERENCES public.teams(id) ON DELETE CASCADE;


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
-- Name: hall_events_halls hall_events_halls_hall_events_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hall_events_halls
    ADD CONSTRAINT hall_events_halls_hall_events_id_foreign FOREIGN KEY (hall_events_id) REFERENCES public.hall_events(id) ON DELETE CASCADE;


--
-- Name: hall_events_halls hall_events_halls_halls_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hall_events_halls
    ADD CONSTRAINT hall_events_halls_halls_id_foreign FOREIGN KEY (halls_id) REFERENCES public.halls(id) ON DELETE CASCADE;


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
-- Name: member_teams member_teams_member_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_teams
    ADD CONSTRAINT member_teams_member_foreign FOREIGN KEY (member) REFERENCES public.members(id) ON DELETE CASCADE;


--
-- Name: members members_photo_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.members
    ADD CONSTRAINT members_photo_foreign FOREIGN KEY (photo) REFERENCES public.directus_files(id) ON DELETE SET NULL;


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
    ADD CONSTRAINT team_requests_member_fkey FOREIGN KEY (member) REFERENCES public.members(id);


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
-- Name: user_logs user_logs_user_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_logs
    ADD CONSTRAINT user_logs_user_foreign FOREIGN KEY ("user") REFERENCES public.members(id) ON DELETE CASCADE;


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
-- Name: carpool_passengers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.carpool_passengers ENABLE ROW LEVEL SECURITY;

--
-- Name: carpools; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.carpools ENABLE ROW LEVEL SECURITY;

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
-- Name: query_templates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.query_templates ENABLE ROW LEVEL SECURITY;

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
-- Name: task_templates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.task_templates ENABLE ROW LEVEL SECURITY;

--
-- Name: tasks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;

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
-- Name: supabase_realtime; Type: PUBLICATION; Schema: -; Owner: -
--

CREATE PUBLICATION supabase_realtime WITH (publish = 'insert, update, delete, truncate');


--
-- Name: issue_graphql_placeholder; Type: EVENT TRIGGER; Schema: -; Owner: -
--

CREATE EVENT TRIGGER issue_graphql_placeholder ON sql_drop
         WHEN TAG IN ('DROP EXTENSION')
   EXECUTE FUNCTION extensions.set_graphql_placeholder();


--
-- Name: issue_pg_cron_access; Type: EVENT TRIGGER; Schema: -; Owner: -
--

CREATE EVENT TRIGGER issue_pg_cron_access ON ddl_command_end
         WHEN TAG IN ('CREATE EXTENSION')
   EXECUTE FUNCTION extensions.grant_pg_cron_access();


--
-- Name: issue_pg_graphql_access; Type: EVENT TRIGGER; Schema: -; Owner: -
--

CREATE EVENT TRIGGER issue_pg_graphql_access ON ddl_command_end
         WHEN TAG IN ('CREATE FUNCTION')
   EXECUTE FUNCTION extensions.grant_pg_graphql_access();


--
-- Name: issue_pg_net_access; Type: EVENT TRIGGER; Schema: -; Owner: -
--

CREATE EVENT TRIGGER issue_pg_net_access ON ddl_command_end
         WHEN TAG IN ('CREATE EXTENSION')
   EXECUTE FUNCTION extensions.grant_pg_net_access();


--
-- Name: pgrst_ddl_watch; Type: EVENT TRIGGER; Schema: -; Owner: -
--

CREATE EVENT TRIGGER pgrst_ddl_watch ON ddl_command_end
   EXECUTE FUNCTION extensions.pgrst_ddl_watch();


--
-- Name: pgrst_drop_watch; Type: EVENT TRIGGER; Schema: -; Owner: -
--

CREATE EVENT TRIGGER pgrst_drop_watch ON sql_drop
   EXECUTE FUNCTION extensions.pgrst_drop_watch();


--
-- PostgreSQL database dump complete
--

