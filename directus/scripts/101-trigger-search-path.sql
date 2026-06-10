-- Migration 101: pin `search_path` on the trigger functions added after the
-- 071 sweep.
--
-- Migration 071 re-pinned `SET search_path = public` on every then-existing
-- trigger/helper function (schema-injection hardening: an unqualified table ref
-- in a SECURITY-relevant function is hijackable by a search_path-shadowing role).
-- Three trigger functions have been created SINCE that sweep, each ending in a
-- plain `$$ LANGUAGE plpgsql;` with no SET clause — so they regressed the
-- documented control the moment they shipped:
--
--   1. members_prevent_email_blanking()      — migration 059 (members email guard)
--   2. trg_form_submissions_guard()          — migration 086 (form-submit INSERT guard)
--   3. trg_form_submissions_update_guard()   — migration 088 (form-submit UPDATE guard)
--
-- All three reference unqualified public tables (`members`, `forms`,
-- `form_submissions`). Pinning search_path = public removes the hijack vector and
-- matches the rest of the hardened functions (001/043/050/071).
--
-- Implementation: ALTER FUNCTION … SET search_path = public for each. This pins
-- the proconfig WITHOUT re-stating any function body, so this migration cannot
-- drift from the live definitions. The three are zero-arg trigger functions, so
-- the empty `()` arg list resolves them uniquely.
--
-- Idempotent: ALTER FUNCTION … SET is re-runnable. Schema-only, no data changes,
-- no permission changes.
--
-- Apply on dev:  npm run db:migrate:dev
-- Apply on prod: npm run db:migrate:prod

BEGIN;

-- 1. members_prevent_email_blanking() — trigger fn, no args (migration 059).
ALTER FUNCTION public.members_prevent_email_blanking() SET search_path = public;

-- 2. trg_form_submissions_guard() — trigger fn, no args (migration 086).
ALTER FUNCTION public.trg_form_submissions_guard() SET search_path = public;

-- 3. trg_form_submissions_update_guard() — trigger fn, no args (migration 088).
ALTER FUNCTION public.trg_form_submissions_update_guard() SET search_path = public;

COMMIT;

-- =============================================================================
-- Verification (read-only): each function below should list search_path=public.
-- =============================================================================
-- SELECT proname, proconfig FROM pg_proc
-- WHERE proname IN (
--   'members_prevent_email_blanking',
--   'trg_form_submissions_guard',
--   'trg_form_submissions_update_guard'
-- );
