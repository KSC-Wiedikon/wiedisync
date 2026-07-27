-- Migration 252 — drop the dead hall_events_halls M2M
--
-- Context (DB review 2026-07-27, findings deadweight-01 / jix-07). The
-- hall_events.hall M2M (junction hall_events_halls) has held 0 rows against
-- 135 hall_events since the PocketBase→Directus migration: gcal-sync.js wrote
-- a scalar `record.hall` via raw knex — a column that does not exist on
-- hall_events (the field is a Directus alias) — and only never crashed
-- because its resolveHall() substring match ('KWI A'…) never matched the
-- feed's real strings ('Halle B', 'Halle A+B'), so the write never fired.
-- Nothing else anywhere writes the junction; the frontend's `event.hall`
-- branch in virtualSlots.ts was dead code describing a feed that never
-- existed — hall resolution has always gone through the location-string
-- regex fallback.
--
-- Removed in the same change (outside this file): the dead gcal-sync.js
-- write, the virtualSlots.ts dead branch, the setup-permissions.mjs grants
-- (+ PERMISSIONS.md), and the junction lists in CLAUDE.md / INFRA.md.
-- SCHEMA.sql loses the table at the next `npm run db:baseline:prod`.
-- Stale directus_permissions rows (if any) are cleared by the next
-- `db:setup-perms` run, which is part of every deploy.
--
-- Idempotent.

BEGIN;

DROP TABLE IF EXISTS hall_events_halls;

DELETE FROM directus_relations   WHERE many_collection = 'hall_events_halls';
DELETE FROM directus_fields      WHERE collection = 'hall_events_halls'
                                    OR (collection = 'hall_events' AND field = 'hall');
DELETE FROM directus_collections WHERE collection = 'hall_events_halls';

COMMIT;
