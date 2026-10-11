-- preflight-no-foreign-functions.sql — refuse to let superuser host tooling run
-- code that a non-superuser could have written (security review 2026-10-11, H5).
--
-- NOT a migration: no NNN- prefix, so apply-migrations.mjs never applies it.
--
-- WHY
-- ---
-- Directus logs in as a NOSUPERUSER role (directus_prod / directus_dev, F29)
-- that owns the tables in `public` and holds CREATE on the schema. Whoever gets
-- that role's DDL — the SQL workspace in write mode + PIN, or code execution in
-- the container — can CREATE FUNCTION and hang it on a trigger, rule, CHECK,
-- DEFAULT or index expression of a table it owns. A plain (SECURITY INVOKER)
-- function runs with the privileges of whoever FIRES it, and the host tooling
-- fires them as the cluster superuser:
--   • apply-migrations.mjs — every migration, and the tracker INSERT before them
--   • refresh-dev-daily.sh / refresh-dev-from-prod.sh — the clone's COPY
--     (CHECKs), the scrub's UPDATEs, the re-pin, the rollback restore
-- One planted trigger is superuser, and superuser is `COPY … TO PROGRAM` on the
-- host that holds prod.
--
-- Every function the repo creates is created by the superuser (migrations, the
-- SCHEMA.sql baseline, the refresh's restore, CREATE EXTENSION). A function owned
-- by anyone else is foreign by definition — and so is anything that calls one.
--
-- WHAT IT FLAGS (kind = first field of an OFFENDER line)
--   function    a function / procedure / aggregate in `public` — or in a schema
--               named after the connected role, which "$user" puts AHEAD of
--               public on the search path — owned by a role that is not allowed
--   trigger | rule | constraint | default | index | type
--               in those schemas, that calls a function owned by a role that is
--               not allowed — in ANY schema, directly or through an operator.
--               `rule` includes a view's SELECT rule, `constraint` a domain's
--               CHECK, `type` a domain's DEFAULT.
--   allowlist   an allowed_owners entry that is not a superuser, or that a
--               Directus login role can act as. Such an entry would whitelist
--               exactly what this check exists to catch, so it is never honoured
--               (and fails the check, so the misconfiguration is seen).
-- Not checked: RLS policies — the superuser bypasses RLS, so tooling never
-- evaluates one.
--
-- ⚠ The dev refresh restores with `pg_dump --no-owner`, which re-creates EVERY
-- function as the superuser. Ownership is the only evidence, and the restore
-- erases it: the check has to run on the SOURCE of a dump (prod before the
-- clone, dev before its safety dump), not only on the result. See the refresh
-- scripts for where each call sits.
--
-- psql variable (required — an unset variable leaves the literal `:'allowed_owners'`
-- below, a syntax error, so the check fails CLOSED):
--   allowed_owners   comma-separated role names. The callers fill it from
--                    KSCW_PREFLIGHT_ALLOWED_OWNERS, default `supabase_admin,postgres` (postgres owns the pgcrypto + unaccent functions on prod)
--                    (the role every migration and restore runs as).
--
-- OUTPUT (formatting is pinned below, whatever flags the caller passed):
--   OFFENDER|<kind>|<object>|<function>|<owner>   one line per finding
--   PREFLIGHT|<n>                                 always last, n = findings
-- A caller passes ONLY on the exact, single line `PREFLIGHT|0`. Anything else —
-- offenders, a psql error, a truncated answer — aborts it.
--
-- Read-only: catalog SELECTs, search_path pinned to pg_catalog, so the check
-- itself never resolves a name to a user-defined function.
--
-- Consumers (one SQL, three callers — keep all of them on THIS file):
--   • apply-migrations.mjs       via preflight-no-foreign-functions.mjs
--   • refresh-dev-daily.sh       reads it from its own root-only directory
--   • refresh-dev-from-prod.sh   ships it to the VPS base64-encoded

\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on
\pset format unaligned
SET search_path = pg_catalog;

WITH
listed AS (
  SELECT DISTINCT btrim(x) AS rolname
    FROM unnest(string_to_array(:'allowed_owners', ',')) AS u(x)
   WHERE btrim(x) <> ''
),
-- The Directus login roles. Neither they nor any role they can act as is ever
-- an allowed owner, however the variable is set.
directus_login AS (
  SELECT oid FROM pg_roles WHERE rolname IN ('directus_prod', 'directus_dev')
),
allowed AS (
  SELECT r.oid
    FROM pg_roles r
    JOIN listed l ON l.rolname = r.rolname
   WHERE r.rolsuper
     AND NOT EXISTS (SELECT 1 FROM directus_login d WHERE pg_has_role(d.oid, r.oid, 'MEMBER'))
),
-- A listed role that does not exist owns nothing and is simply ignored.
bad_allowlist AS (
  SELECT 'allowlist'::text AS kind,
         l.rolname::text AS object,
         '-'::text AS fn,
         CASE WHEN NOT r.rolsuper THEN 'not a superuser'
              ELSE 'a Directus login role can act as it' END AS owner
    FROM listed l
    JOIN pg_roles r ON r.rolname = l.rolname
   WHERE r.oid NOT IN (SELECT oid FROM allowed)
),
-- Where tooling resolves unqualified names: public, and "$user" when a schema
-- of that name exists (it is searched BEFORE public).
scope AS (
  SELECT oid FROM pg_namespace WHERE nspname IN ('public', current_user)
),
foreign_fn AS (
  SELECT p.oid, p.pronamespace, p.proowner
    FROM pg_proc p
   WHERE p.pronamespace NOT IN ('pg_catalog'::regnamespace::oid, 'information_schema'::regnamespace::oid)
     AND p.proowner NOT IN (SELECT oid FROM allowed)
),
-- An operator is a function call in disguise: CHECK (a === b) depends on the
-- operator, not on the function behind it.
foreign_ref AS (
  SELECT 'pg_catalog.pg_proc'::regclass::oid AS refclassid, f.oid AS refobjid, f.oid AS fn
    FROM foreign_fn f
  UNION ALL
  SELECT 'pg_catalog.pg_operator'::regclass::oid, o.oid, f.oid
    FROM pg_operator o
    JOIN foreign_fn f ON f.oid = o.oprcode
),
dep AS (
  SELECT d.classid, d.objid, d.objsubid, r.fn
    FROM pg_depend d
    JOIN foreign_ref r ON r.refclassid = d.refclassid AND r.refobjid = d.refobjid
),
hits AS (
  SELECT 'trigger'::text AS kind, d.classid, d.objid, d.objsubid, d.fn
    FROM dep d
    JOIN pg_trigger t ON t.oid = d.objid
    JOIN pg_class c   ON c.oid = t.tgrelid
   WHERE d.classid = 'pg_catalog.pg_trigger'::regclass::oid
     AND c.relnamespace IN (SELECT oid FROM scope)
  UNION ALL
  SELECT 'rule', d.classid, d.objid, d.objsubid, d.fn
    FROM dep d
    JOIN pg_rewrite w ON w.oid = d.objid
    JOIN pg_class c   ON c.oid = w.ev_class
   WHERE d.classid = 'pg_catalog.pg_rewrite'::regclass::oid
     AND c.relnamespace IN (SELECT oid FROM scope)
  UNION ALL
  SELECT 'constraint', d.classid, d.objid, d.objsubid, d.fn
    FROM dep d
    JOIN pg_constraint k ON k.oid = d.objid
   WHERE d.classid = 'pg_catalog.pg_constraint'::regclass::oid
     AND k.connamespace IN (SELECT oid FROM scope)
  UNION ALL
  SELECT 'default', d.classid, d.objid, d.objsubid, d.fn
    FROM dep d
    JOIN pg_attrdef a ON a.oid = d.objid
    JOIN pg_class c   ON c.oid = a.adrelid
   WHERE d.classid = 'pg_catalog.pg_attrdef'::regclass::oid
     AND c.relnamespace IN (SELECT oid FROM scope)
  UNION ALL
  SELECT 'index', d.classid, d.objid, d.objsubid, d.fn
    FROM dep d
    JOIN pg_class i ON i.oid = d.objid
   WHERE d.classid = 'pg_catalog.pg_class'::regclass::oid
     AND i.relkind IN ('i', 'I')
     AND i.relnamespace IN (SELECT oid FROM scope)
  UNION ALL
  -- A domain's DEFAULT, a range type's support functions.
  SELECT 'type', d.classid, d.objid, d.objsubid, d.fn
    FROM dep d
    JOIN pg_type ty ON ty.oid = d.objid
   WHERE d.classid = 'pg_catalog.pg_type'::regclass::oid
     AND ty.typnamespace IN (SELECT oid FROM scope)
),
offenders AS (
  SELECT 'function'::text AS kind,
         f.oid::regprocedure::text AS object,
         f.oid::regprocedure::text AS fn,
         pg_get_userbyid(f.proowner)::text AS owner
    FROM foreign_fn f
   WHERE f.pronamespace IN (SELECT oid FROM scope)
  UNION ALL
  SELECT h.kind,
         pg_describe_object(h.classid, h.objid, h.objsubid),
         h.fn::regprocedure::text,
         pg_get_userbyid(p.proowner)::text
    FROM hits h
    JOIN pg_proc p ON p.oid = h.fn
  UNION ALL
  SELECT kind, object, fn, owner FROM bad_allowlist
)
-- Identifiers can hold anything, newlines and `|` included: flatten them so one
-- finding is one line and cannot be made to look like the all-clear.
SELECT line
  FROM (
    SELECT 0 AS ord,
           'OFFENDER|' || kind
             || '|' || regexp_replace(coalesce(object, '?'), '[[:cntrl:]|]', '?', 'g')
             || '|' || regexp_replace(coalesce(fn, '?'),     '[[:cntrl:]|]', '?', 'g')
             || '|' || regexp_replace(coalesce(owner, '?'),  '[[:cntrl:]|]', '?', 'g') AS line
      FROM offenders
    UNION ALL
    SELECT 1, 'PREFLIGHT|' || count(*) FROM offenders
  ) AS out
 ORDER BY ord, line;
