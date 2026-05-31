-- Migration 070: drop the wide-open `USING(true)` RLS SELECT policies left on
-- sensitive tables for the Supabase `anon` + `authenticated` PostgREST roles.
--
-- Security audit 2026-05-31 (Medium): 38 `anon_read_* … FOR SELECT TO anon
-- USING (true)` and 44 `auth_read_* … FOR SELECT TO authenticated USING (true)`
-- policies sit on highly sensitive tables — members (email/phone/photo/licence),
-- participations, absences, member_teams, push_subscriptions, email_verifications,
-- notifications, feedback, sv_vm_check (Swiss-Volley PII), etc. These are
-- PostgREST/PocketBase-era leftovers with no row restriction. Today the only
-- thing preventing an unauthenticated full-table dump is migration 011 having
-- REVOKEd the table GRANTs + schema USAGE from those roles — but that control
-- already failed once (migration 035: `event_signups` silently inherited
-- Supabase default grants and was world-exposed until re-revoked). A Supabase
-- image upgrade or any future `GRANT … TO authenticated` re-opens every one of
-- these tables instantly, because the RLS policy permits ALL rows.
--
-- Fix (mirrors the 011 / 043 precedent — REVOKE the grants, here we go one
-- further and DROP the permissive policies so a stray future GRANT cannot leak
-- rows): drop every `anon_read_*` / `auth_read_*` SELECT policy. The app reaches
-- all data through Directus, which connects as `supabase_admin` (the table
-- owner / a privileged role), NOT via PostgREST as anon/authenticated — so RLS
-- policies on those PostgREST roles are never consulted by the live API and
-- dropping them does not break any legitimate caller.
--
-- Idempotent: looped DROP POLICY IF EXISTS over pg_policies, matched by the
-- `anon_read_*` / `auth_read_*` naming convention on its own table. Re-runs are
-- no-ops. Schema-only — no permission rows, no data changes.

BEGIN;

DO $$
DECLARE
  p record;
BEGIN
  FOR p IN
    SELECT schemaname, tablename, policyname
      FROM pg_policies
     WHERE schemaname = 'public'
       AND (policyname LIKE 'anon_read_%' OR policyname LIKE 'auth_read_%')
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON %I.%I',
      p.policyname, p.schemaname, p.tablename
    );
  END LOOP;
END $$;

COMMIT;

-- =============================================================================
-- Verification (read-only): no permissive anon/authenticated read policies left.
-- =============================================================================
-- SELECT tablename, policyname FROM pg_policies
-- WHERE schemaname = 'public'
--   AND (policyname LIKE 'anon_read_%' OR policyname LIKE 'auth_read_%');
-- (expect zero rows)
--
-- And the GRANT backstop from migration 011 still holds:
-- SELECT has_table_privilege('anon','members','SELECT'),
--        has_table_privilege('authenticated','members','SELECT');
-- (expect f, f)
