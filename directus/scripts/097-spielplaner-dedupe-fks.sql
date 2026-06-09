-- Migration 097: drop duplicate foreign keys on spielplaner_assignments.
--
-- The collection was created in migration 031 with member/kscw_team foreign keys
-- named *_fkey. When the collection was later registered via the Directus admin
-- UI (the documented "register via UI" step), Directus created its OWN foreign
-- keys named *_foreign on the SAME columns. Each column ended up with TWO
-- identical FOREIGN KEY constraints (both ON DELETE CASCADE):
--
--   spielplaner_assignments_member_fkey      +  spielplaner_assignments_member_foreign
--   spielplaner_assignments_kscw_team_fkey   +  spielplaner_assignments_kscw_team_foreign
--
-- Two FKs per column makes Directus's schema introspection ambiguous: it cannot
-- map directus_relations rows 186/187 to a single database foreign key, so the
-- o2m relations members.spielplaner_assignments / teams.spielplaner_assignments
-- fall out of the LIVE schema. Symptoms:
--   * Admin UI renders "The relationship is not configured properly or you
--     don't have permission to access it" on the Spielplaner Assignments field.
--   * GET /relations/{members,teams}/spielplaner_assignments returns FORBIDDEN
--     even for a full admin (a known-good control like /relations/teams/captain
--     returns 200).
--
-- Fix: drop the migration-origin *_fkey duplicates and keep the
-- Directus-managed *_foreign constraints. Behaviour is identical
-- (ON DELETE CASCADE), so data integrity is unchanged. After applying, the
-- Directus container(s) must be RESTARTED so the in-memory schema is rebuilt
-- with exactly one FK per column.
--
-- Schema-only, idempotent, no data changes.

BEGIN;

ALTER TABLE public.spielplaner_assignments
  DROP CONSTRAINT IF EXISTS spielplaner_assignments_member_fkey;

ALTER TABLE public.spielplaner_assignments
  DROP CONSTRAINT IF EXISTS spielplaner_assignments_kscw_team_fkey;

COMMIT;
