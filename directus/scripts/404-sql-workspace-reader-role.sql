-- Migration 404: kscw_sql_reader — the role the SQL workspace reads as.
--
-- WHY
-- ---
-- Security audit 2026-10-11, H4b. Read mode of /admin/sql (every full admin,
-- ~5 board members since migration 402) ran as the Directus login role, which
-- OWNS `public` — so it could SELECT what Directus hides even from admins:
-- directus_users.password (argon2 hashes), .token (static API tokens),
-- .tfa_secret, .auth_data; directus_sessions; directus_shares; password-reset
-- and e-mail-verification codes; identity-document key envelopes;
-- game_vm_sheets (minors' full birthdates); members' E2EE private key, KDF salt
-- and calendar-feed token. Text matching cannot close that (SELECT *, views,
-- quoting); privileges can.
--
-- WHAT CHANGES
-- ------------
--   * Cluster role kscw_sql_reader — NOLOGIN, BYPASSRLS, nothing else. BYPASSRLS
--     because ~40 tables still carry Supabase-era ENABLE ROW LEVEL SECURITY
--     with no policies (no table FORCEs it): Directus reads them as their
--     owner, any other role reads ZERO rows. The role holds SELECT only, so
--     bypassing RLS gives it nothing the owner does not already see.
--   * Granted to directus_prod / directus_dev (whichever exist) WITH INHERIT
--     FALSE, SET TRUE: the login role gains no privilege from it implicitly; it
--     can only SET ROLE into it. The SQL workspace does exactly that,
--     transaction-locally, in read mode only (kscw-endpoints/src/sql-reader.js).
--     Directus itself never uses the role.
--   * In THIS database: USAGE on public; SELECT on every table and view except
--     the credential tables; column-level SELECT (every column but the
--     credential ones) where a table has credential columns; SELECT on
--     sequences; EXECUTE on public functions.
--
-- The grant block below is repeated verbatim in directus-db-role.sql, which
-- apply-migrations.mjs runs after every batch and both dev refreshes run after
-- the restore — so tables created later are covered, and THAT file holds the
-- living deny list. No default privileges on purpose: a table created between
-- two runs is unreadable in the workspace until the next run (fails closed).
--
-- Idempotent: the role is created only when missing (its attributes are
-- re-asserted every run), table grants are revoke-then-grant. Schema-only
-- (roles + grants), per the migration policy; no Directus permission rows.

BEGIN;

-- Only catalog objects below; never resolve a name through `public`.
SET LOCAL search_path = pg_catalog;

DO $role$
DECLARE
  r text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kscw_sql_reader') THEN
    CREATE ROLE kscw_sql_reader NOLOGIN;
  END IF;
  ALTER ROLE kscw_sql_reader NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION BYPASSRLS;

  FOREACH r IN ARRAY ARRAY['directus_prod', 'directus_dev'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT kscw_sql_reader TO %I WITH INHERIT FALSE, SET TRUE', r);
    END IF;
  END LOOP;
END $role$;

COMMENT ON ROLE kscw_sql_reader IS
  'SQL workspace read mode (SET LOCAL ROLE): SELECT on public minus credential tables/columns. Migration 404 + directus-db-role.sql.';

-- ── Reader grants — same block as directus-db-role.sql (the living copy) ────
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

COMMIT;
