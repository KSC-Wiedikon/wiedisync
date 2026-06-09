-- Migration 098: configure the spielplaner_assignments.user_created relation
-- so the admin UI shows WHO created each assignment, and unhide the audit
-- fields so WHO + WHEN are visible.
--
-- Context: migration 031 created user_created with an inline FK to
-- directus_users, but registering the collection via the Directus admin UI
-- dropped that FK and never created a directus_relations row. The field is
-- therefore an unlinked, hidden, readonly column (special=user-created). This
-- migration restores it as a proper m2o to directus_users.
--
-- IMPORTANT — do NOT configure this relation via the Directus admin UI: that is
-- what created the duplicate-FK bug fixed in migration 097 (the UI adds its own
-- *_foreign FK on top of any existing one). user_created currently has NO FK, so
-- we add exactly one (named *_foreign, the Directus convention, so a future UI
-- reconcile reuses it instead of duplicating) plus the directus_relations
-- metadata row that Directus's introspection binds to it.
--
-- After applying, RESTART the Directus container(s) so the schema picks up the
-- new relation + field visibility. Schema + Directus-metadata only, idempotent.

BEGIN;

-- 1. Single foreign key user_created -> directus_users (ON DELETE SET NULL).
DO $$ BEGIN
  ALTER TABLE public.spielplaner_assignments
    ADD CONSTRAINT spielplaner_assignments_user_created_foreign
    FOREIGN KEY (user_created) REFERENCES public.directus_users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. directus_relations metadata row (mirrors the m2o shape Directus expects).
INSERT INTO directus_relations (many_collection, many_field, one_collection, one_deselect_action)
SELECT 'spielplaner_assignments', 'user_created', 'directus_users', 'nullify'
WHERE NOT EXISTS (
  SELECT 1 FROM directus_relations
  WHERE many_collection = 'spielplaner_assignments' AND many_field = 'user_created'
);

-- 3. Unhide the audit fields so the assignment item shows who + when.
UPDATE directus_fields SET hidden = false
WHERE collection = 'spielplaner_assignments' AND field IN ('date_created', 'user_created');

-- 4. Readable o2m display templates (instead of raw UUIDs):
--    on a TEAM's list show the member + creation date; on a MEMBER's list show
--    the team + creation date.
UPDATE directus_fields
SET options = '{"template":"{{member.first_name}} {{member.last_name}} · {{date_created}}"}'::json
WHERE collection = 'teams' AND field = 'spielplaner_assignments';

UPDATE directus_fields
SET options = '{"template":"{{kscw_team.name}} · {{date_created}}"}'::json
WHERE collection = 'members' AND field = 'spielplaner_assignments';

COMMIT;
