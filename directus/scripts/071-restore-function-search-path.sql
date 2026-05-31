-- Migration 071: restore `SET search_path` hardening on functions that lost it.
--
-- Security audit 2026-05-31 (Low/Info): three regressions of a documented
-- search_path-pinning control (CLAUDE.md "every audit pass breaks something"
-- class — a control correct once, silently undone by a later CREATE OR REPLACE):
--
--   1. trg_trainings_notify()      — migration 001 defined it
--      `$$ LANGUAGE plpgsql SET search_path = public`; migration 054 redefined
--      it via CREATE OR REPLACE ending in plain `$$ LANGUAGE plpgsql;`, wiping
--      the proconfig. (Low)
--   2. fn_messaging_dm_autoaccept() — migration 043 set search_path via
--      ALTER FUNCTION; migration 052 redefined it via CREATE OR REPLACE with no
--      SET clause, undoing 043. (Low)
--   3. The migration 069 fines helpers — kscw_current_season_start(),
--      kscw_fine_window_start(text, timestamptz),
--      kscw_compute_fine_amount(integer, integer, text) — were created without
--      a SET search_path clause. (Info)
--
-- All reference unqualified public tables (halls / member_teams / notifications;
-- conversations / member_teams / message_requests / blocks; fine_rules / fines).
-- Pinning search_path = public removes the search_path-shadowing hijack vector
-- and matches the rest of the hardened functions (001/043).
--
-- Implementation: ALTER FUNCTION … SET search_path = public for ALL of them.
-- This pins the proconfig WITHOUT re-stating any function body, so this
-- migration cannot drift from the live definitions (the safer choice for the
-- two trigger functions whose bodies are non-trivial — training notifications
-- and DM auto-accept). The pin is what enforces search_path at execution time,
-- identical in effect to an inline `SET search_path` clause.
--
-- Idempotent: ALTER FUNCTION … SET is re-runnable. Schema-only.

BEGIN;

-- 1. trg_trainings_notify() — trigger fn, no args (lost search_path in 054).
ALTER FUNCTION trg_trainings_notify() SET search_path = public;

-- 2. fn_messaging_dm_autoaccept() — trigger fn, no args (lost search_path in 052).
ALTER FUNCTION fn_messaging_dm_autoaccept() SET search_path = public;

-- 3. Migration 069 fines helpers.
ALTER FUNCTION kscw_current_season_start() SET search_path = public;
ALTER FUNCTION kscw_fine_window_start(text, timestamptz) SET search_path = public;
ALTER FUNCTION kscw_compute_fine_amount(integer, integer, text) SET search_path = public;

COMMIT;

-- =============================================================================
-- Verification (read-only): every function below should list search_path=public.
-- =============================================================================
-- SELECT proname, proconfig FROM pg_proc
-- WHERE proname IN (
--   'trg_trainings_notify', 'fn_messaging_dm_autoaccept',
--   'kscw_current_season_start', 'kscw_fine_window_start', 'kscw_compute_fine_amount'
-- );
