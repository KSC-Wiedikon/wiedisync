-- Migration 072: restore `security_invoker = true` on the PII / stats views.
--
-- Security audit 2026-05-31 (Low): migration 004 set `security_invoker = true`
-- on members_with_photo and the stats_* views so they run as the *caller*
-- (respecting RLS / the caller's grants) rather than the view owner (a superuser
-- that bypasses RLS). Later CASCADE-recreates dropped the reloption:
--   * 003-stat-views.sql / 068-stat-views-licence-booleans.sql recreate the
--     stats_* views via `DROP VIEW … CASCADE; CREATE VIEW …` with no
--     `WITH (security_invoker = true)`.
-- The live baseline confirms the regression: only sponsors_with_logo retains
-- `WITH (security_invoker='true')`; members_with_photo (exposes member
-- email/phone/photo) and every stats_* view are back to the default
-- (security_definer) behaviour. Any role able to SELECT these views reads
-- through the owner's RLS-bypassing privileges. Bounded today by the same
-- GRANT-revoke as migration 011, but it silently reverts a documented control
-- on a view containing member PII.
--
-- Fix (mirrors migration 004): ALTER each affected view to SET
-- `security_invoker = true`. No view bodies are re-stated, so this cannot drift
-- from the current definitions. Idempotent + guarded so it is a no-op when a
-- view is absent on a given environment.
--
-- Schema-only. After applying, regenerate the SCHEMA.sql baseline
-- (`npm run db:baseline:prod`) so a fresh install carries the reloption too.

BEGIN;

DO $$
DECLARE
  v text;
BEGIN
  FOREACH v IN ARRAY ARRAY[
    'members_with_photo',
    'stats_club_overview',
    'stats_delegations',
    'stats_game_results',
    'stats_games_missing_schreiber',
    'stats_members',
    'stats_participation',
    'stats_schreiber_coverage',
    'stats_team_roster'
  ] LOOP
    IF EXISTS (SELECT 1 FROM pg_views WHERE schemaname = 'public' AND viewname = v) THEN
      EXECUTE format('ALTER VIEW %I SET (security_invoker = true)', v);
    END IF;
  END LOOP;
END $$;

COMMIT;

-- =============================================================================
-- Verification (read-only): every view below should report security_invoker.
-- =============================================================================
-- SELECT c.relname, c.reloptions
-- FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
-- WHERE n.nspname = 'public' AND c.relkind = 'v'
--   AND c.relname IN (
--     'members_with_photo','stats_club_overview','stats_delegations',
--     'stats_game_results','stats_games_missing_schreiber','stats_members',
--     'stats_participation','stats_schreiber_coverage','stats_team_roster'
--   );
-- (each reloptions array should contain security_invoker=true)
