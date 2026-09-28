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
END $$;
