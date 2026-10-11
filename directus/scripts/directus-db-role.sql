-- directus-db-role.sql — hand the `public` schema of one KSCW database to that
-- environment's Directus login role (security audit 2026-09-28, F29).
--
--   docker exec -i kscw-postgres psql -U supabase_admin -d <db> -v ON_ERROR_STOP=1 \
--     -v role=directus_prod|directus_dev < directus-db-role.sql
--
-- Why: both Directus containers used to connect as the cluster SUPERUSER, so a
-- dev admin (or anyone with code execution in either container) could open the
-- other environment's database or run `COPY … TO PROGRAM` on the host. Each
-- container now logs in as its own NOSUPERUSER role that can connect only to
-- its own database (CONNECT is granted per role; PUBLIC's is revoked — that
-- part is one-off cluster DDL, see INFRA.md → F29).
--
-- Why OWNERSHIP, not just grants:
--   * Directus alters tables at runtime (Data Model UI, its own system
--     migrations on a version bump) — that needs the owner.
--   * ~40 tables still carry Supabase-era `ENABLE ROW LEVEL SECURITY` with no
--     policies. The superuser bypassed that; a non-owner would read ZERO rows.
--     The owner bypasses non-forced RLS, so owning the tables keeps behaviour.
--
-- Idempotent. Re-run after anything that creates or re-creates objects as
-- supabase_admin: `apply-migrations.mjs` does it after every applied batch, and
-- the nightly dev refresh after it restores the prod clone. Functions keep their
-- owner (none is SECURITY DEFINER, so triggers already run as the caller).
--
-- Also (migration 404, audit 2026-10-11 H4b): re-grants the SQL workspace's
-- reader role kscw_sql_reader — membership for this env's login role, and
-- SELECT on this database minus the credential tables/columns. This file holds
-- the LIVING deny list; re-running it after every batch is what covers tables
-- created after 404. A no-op (NOTICE) until 404 has created the role.

-- This runs as the superuser, and the Directus role owns `public`: resolve
-- nothing through it (a planted public.format() would otherwise be a way up).
SET search_path = pg_catalog;

SELECT set_config('kscw.directus_role', :'role', false) AS directus_role \gset

DO $$
DECLARE
  r text := current_setting('kscw.directus_role');
  o record;
BEGIN
  IF r NOT IN ('directus_prod', 'directus_dev') THEN
    RAISE EXCEPTION 'directus-db-role.sql: unexpected role %', r;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
    RAISE NOTICE 'directus-db-role.sql: role % does not exist yet — nothing to do', r;
    RETURN;
  END IF;

  EXECUTE format('GRANT USAGE, CREATE ON SCHEMA public TO %I', r);

  -- Tables, views, matviews, foreign tables, and free-standing sequences.
  -- Sequences owned by a column (serial / identity) follow their table and
  -- cannot be re-owned on their own.
  FOR o IN
    SELECT c.relname, c.relkind
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
       AND c.relowner <> (SELECT oid FROM pg_roles WHERE rolname = r)
       AND NOT (c.relkind = 'S' AND EXISTS (
             SELECT 1 FROM pg_depend d
              WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid
                AND d.refclassid = 'pg_class'::regclass AND d.deptype IN ('a', 'i')))
     ORDER BY CASE c.relkind WHEN 'r' THEN 0 WHEN 'p' THEN 0 WHEN 'S' THEN 1 ELSE 2 END
  LOOP
    EXECUTE format('ALTER %s public.%I OWNER TO %I',
      CASE o.relkind WHEN 'v' THEN 'VIEW' WHEN 'm' THEN 'MATERIALIZED VIEW'
                     WHEN 'f' THEN 'FOREIGN TABLE' WHEN 'S' THEN 'SEQUENCE' ELSE 'TABLE' END,
      o.relname, r);
  END LOOP;

  -- Enum / domain types used by columns (ALTER TABLE on such a column wants them).
  FOR o IN
    SELECT t.typname, t.typtype
      FROM pg_type t
      JOIN pg_namespace n ON n.oid = t.typnamespace
     WHERE n.nspname = 'public' AND t.typtype IN ('e', 'd')
       AND t.typowner <> (SELECT oid FROM pg_roles WHERE rolname = r)
  LOOP
    EXECUTE format('ALTER %s public.%I OWNER TO %I',
      CASE o.typtype WHEN 'd' THEN 'DOMAIN' ELSE 'TYPE' END, o.typname, r);
  END LOOP;

  -- Belt and braces for anything the loops skip, and for objects migrations
  -- create later (default privileges are per creating role).
  EXECUTE format('GRANT ALL ON ALL TABLES IN SCHEMA public TO %I', r);
  EXECUTE format('GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO %I', r);
  EXECUTE format('GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO %I', r);
  EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO %I', r);
  EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO %I', r);
  EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO %I', r);

  -- The SQL workspace's reader role (migration 404): SET ROLE into it only,
  -- never inherit it — Directus itself does not use it.
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kscw_sql_reader') THEN
    EXECUTE format('GRANT kscw_sql_reader TO %I WITH INHERIT FALSE, SET TRUE', r);
  END IF;
END $$;

-- ── Reader grants (kscw_sql_reader) — the living copy; migration 404 ran the
--    same block once ────────────────────────────────────────────────────────
DO $grant$
DECLARE
  -- No SELECT at all.
  deny_tables constant text[] := ARRAY[
    'directus_sessions', 'directus_shares',
    'password_reset_tokens', 'email_verifications',
    'identity_documents', 'identity_document_keys',
    'game_vm_sheets'
  ];
  -- Bearer secrets whose names do not say so (table.column).
  deny_columns constant text[] := ARRAY[
    'directus_users.token', 'directus_settings.mapbox_key',
    'members.ical_token',
    'push_subscriptions.keys_auth', 'push_subscriptions.keys_p256dh',
    'newsletter_subscribers.verify_token', 'newsletter_subscribers.unsubscribe_token'
  ];
  -- Any column of any table or view whose NAME says credential: directus_users
  -- .password/.tfa_secret/.auth_data, directus_settings.*_api_key,
  -- members.e2ee_private_key/.e2ee_kdf_salt, email_accounts.password_enc,
  -- signup_tokens.token_hash — and the next one somebody adds.
  deny_name_re constant text :=
    '(^|_)(password|passwd|pwd|secret|private_?key|privkey|api_?key|kdf_salt|token_hash|auth_data|otp)s?(_|$)';
  rel record;
  cols text;
  n_denied int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kscw_sql_reader') THEN
    RAISE NOTICE 'kscw_sql_reader does not exist (migration 404) — no reader grants';
    RETURN;
  END IF;

  -- Start from nothing, so a table or column added to a deny list loses the
  -- grant it had. Revoking a table privilege revokes its column privileges.
  EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM kscw_sql_reader';
  EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM kscw_sql_reader';
  EXECUTE 'GRANT USAGE ON SCHEMA public TO kscw_sql_reader';

  FOR rel IN
    SELECT c.oid, c.relname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
     ORDER BY c.relname
  LOOP
    CONTINUE WHEN rel.relname = ANY (deny_tables);
    SELECT count(*) FILTER (WHERE x.denied),
           string_agg(quote_ident(x.attname), ', ' ORDER BY x.attnum) FILTER (WHERE NOT x.denied)
      INTO n_denied, cols
      FROM (SELECT a.attname, a.attnum,
                   (a.attname ~* deny_name_re OR (rel.relname || '.' || a.attname) = ANY (deny_columns)) AS denied
              FROM pg_attribute a
             WHERE a.attrelid = rel.oid AND a.attnum > 0 AND NOT a.attisdropped) x;
    IF n_denied = 0 THEN
      EXECUTE format('GRANT SELECT ON TABLE public.%I TO kscw_sql_reader', rel.relname);
    ELSIF cols IS NOT NULL THEN
      EXECUTE format('GRANT SELECT (%s) ON TABLE public.%I TO kscw_sql_reader', cols, rel.relname);
    END IF;
  END LOOP;

  EXECUTE 'GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO kscw_sql_reader';
  EXECUTE 'GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO kscw_sql_reader';
END $grant$;
