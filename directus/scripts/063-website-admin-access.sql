-- 063-website-admin-access.sql
-- Per-user website-admin section grants for /admin (kscw-website).
-- Internal config table — deliberately NOT registered in Directus
-- (no directus_collections/directus_fields row), so there is no
-- /items/website_admin_access REST surface. Reached only via the
-- /kscw/wadmin endpoint (raw knex). See
-- docs/superpowers/specs/2026-05-19-admin-section-access-design.md.

BEGIN;

CREATE TABLE IF NOT EXISTS website_admin_access (
  id           serial PRIMARY KEY,
  "user"       uuid NOT NULL UNIQUE
                 REFERENCES directus_users(id) ON DELETE CASCADE,
  sections     jsonb NOT NULL DEFAULT '[]'::jsonb,
  date_created timestamptz NOT NULL DEFAULT now(),
  date_updated timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE website_admin_access IS
  'kscw-website /admin per-user section grants. Internal — not a Directus collection; only reachable via /kscw/wadmin.';
COMMENT ON COLUMN website_admin_access.sections IS
  'JSON array of section keys: news, events, registrations, sponsors, scorer_courses, mixed_turnier';

COMMIT;
