-- 349-user-logs-acting-guardian.sql
--
-- Keep the guardian visible in the audit trail.
--
-- WHY
-- ---
-- Migration 348 lets Nina act as her daughter: the server resolves the request
-- as Mila, so every existing $CURRENT_USER policy filter and every server-side
-- `where('user', accountability.user)` keeps working verbatim. That is exactly
-- the property that makes the design safe — and it is also what makes the audit
-- trail lie by omission.
--
-- ⚠⚠ WITHOUT THIS COLUMN, EVERY RSVP NINA MAKES FOR ZOÉ IS LOGGED AS *ZOÉ*, AND
-- NINA IS INVISIBLE. `user_logs.user` resolves from accountability.user, which
-- by then IS the child. An audit trail that cannot distinguish "the 14-year-old
-- did this" from "her mother did this on her behalf" is not an audit trail for
-- a feature whose entire subject is adults acting for minors.
--
-- WHAT
-- ----
-- One nullable column. NULL means "the member did this herself" — which is the
-- overwhelming majority of rows and the correct reading for all history that
-- predates this migration.
--
-- ⚠⚠ TWO WRITERS MUST BOTH BE STAMPED, OR THE TRAIL IS HALF-BLIND:
--   1. kscw-hooks/src/audit.js → writeLog()   — the items-API half. This is the
--      AUTHORITATIVE writer: it binds action('items.create'|'update'|'delete')
--      and inserts with raw knex, so the `user_logs.items.create` FILTER hook
--      never sees these rows and cannot stamp them.
--   2. kscw-endpoints/src/activity-log.js → writeUserLog() — the custom-endpoint
--      half, for raw-knex writes that bypass Directus's activity trail entirely.
-- Stamping only one leaves half of every household's actions unattributed.
--
-- ⚠ Directus's OWN directus_activity / directus_revisions rows still name the
-- child, with no acting column — we do not own that table's shape. `user_logs`,
-- surfaced at /admin/audit-log, is the club's audit trail of record. This is
-- stated in SECURITY.md so an investigator does not read directus_activity and
-- conclude a minor acted alone.
--
-- ⚠ Deliberately NOT a NOT NULL default-0 or a boolean: the guardian's member id
-- is the useful fact ("via Nina Bolgé"), and ON DELETE SET NULL is right — if a
-- guardian's member row is ever deleted, the action still happened and the row
-- must survive with the actor degraded to unknown, not cascade-deleted.
--
-- ⚠ `user_logs` is a REGISTERED Directus collection, so the column needs a
-- directus_fields row or the admin audit page cannot read it back.
--
-- ⚠⚠ Restart the container after applying — a raw-SQL directus_fields insert
-- does not bust the schema cache (2026-08-22).
--
-- ⚠ No permission rows here (migrations are SCHEMA-ONLY). Sport Admin already
-- holds create+read on user_logs with unrestricted fields, so the column rides
-- the existing grant. update/delete stay ungranted — the tier under audit must
-- not be able to rewrite its own trail.
--
-- Schema-only + idempotent per the CLAUDE.md migration policy.

BEGIN;

ALTER TABLE user_logs
  ADD COLUMN IF NOT EXISTS acting_guardian integer REFERENCES members(id) ON DELETE SET NULL;

COMMENT ON COLUMN user_logs.acting_guardian IS
  'The guardian who performed this action on behalf of user (migration 348). NULL = the member acted herself, which is also the correct reading of every row predating this column. Rendered at /admin/audit-log as a "via <name>" badge.';

-- Partial: the overwhelming majority of rows are NULL and the only query that
-- uses this is "show me what guardians did", so indexing the NULLs is waste.
CREATE INDEX IF NOT EXISTS user_logs_acting_guardian_ix
  ON user_logs (acting_guardian) WHERE acting_guardian IS NOT NULL;

INSERT INTO directus_fields (collection, field, interface, display, readonly, sort, width, note)
SELECT 'user_logs', 'acting_guardian', 'select-dropdown-m2o', 'related-values', true, 90, 'half',
       'Set when a household guardian performed this action on behalf of the member. NULL = the member acted herself.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'user_logs' AND field = 'acting_guardian');

COMMIT;
