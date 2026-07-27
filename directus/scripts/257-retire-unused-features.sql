-- Migration 257 — retire three never-used features: tasks, carpools, saved
-- explorer queries
--
-- Context (DB review 2026-07-27, finding deadweight-03; product decision by
-- the club admin 2026-07-27). tasks / task_templates / carpools /
-- carpool_passengers / query_templates were fully wired (UI, endpoints,
-- permission rows, i18n ×5) but hold 0 rows and have zero user_logs entries
-- EVER — a full 560-game season passed without a single write. That is a
-- standing maintenance/audit surface for features nobody uses. Retired:
-- tables dropped, Directus metadata cleaned, grants removed from
-- setup-permissions.mjs, frontend modules + i18n removed — all in the same
-- change-set. Row counts re-verified 0 live immediately before this was
-- written.
--
-- Deliberately KEPT (same finding, same decision): fines/fine_rules (a rule
-- was configured — someone started), slot_claims + referee_expenses
-- (plausibly useful when season 2026/27 starts in September), broadcasts
-- (backs the live "Contact all" buttons).
--
-- Rebuild path if a feature returns: git history (frontend modules +
-- setup-permissions blocks) + this file's DDL inverse; the tables held no
-- data to restore.
--
-- Idempotent.

BEGIN;

-- Junction first, then parents.
DROP TABLE IF EXISTS carpool_passengers;
DROP TABLE IF EXISTS carpools;
DROP TABLE IF EXISTS tasks;
DROP TABLE IF EXISTS task_templates;
DROP TABLE IF EXISTS query_templates;

-- Directus metadata (verified live: no alias fields on OTHER collections
-- point at these — tasks/carpools link polymorphically or M2O inward only).
DELETE FROM directus_relations
 WHERE many_collection IN ('tasks', 'task_templates', 'carpools', 'carpool_passengers', 'query_templates')
    OR one_collection  IN ('tasks', 'task_templates', 'carpools', 'carpool_passengers', 'query_templates');
DELETE FROM directus_fields
 WHERE collection IN ('tasks', 'task_templates', 'carpools', 'carpool_passengers', 'query_templates');
DELETE FROM directus_collections
 WHERE collection IN ('tasks', 'task_templates', 'carpools', 'carpool_passengers', 'query_templates');

-- Stale directus_permissions rows are cleared by the next db:setup-perms run
-- (part of every deploy); the grants are already gone from the script.

COMMIT;
