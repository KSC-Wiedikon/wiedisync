-- Migration 127: manual opponent assignment for scheduling_emails.
--
-- Auto-classification (kscw-endpoints scheduling-mailbox + the frontend
-- useMailbox classifier) routes each synced email to an opponent row by contact
-- address + the KSCW team code in the subject. For the residual genuinely
-- ambiguous cases (shared club contact, forwarded mail with no KSCW marker, e.g.
-- "Fw: Heim-Spiel Planung Oerlikon"), a spielplaner can pin the whole chain to
-- the right opponent from the dashboard. This column stores that manual override.
--
-- Soft reference (plain integer, NO foreign key) — consistent with the rest of
-- this table (migration 100): opponents are recreated on resync, so we never
-- want a cascade. The classifier ignores an assigned_opponent that no longer
-- matches a current opponent row and falls back to auto-classification.
--
-- Written ONLY via the scheduling-mailbox assign endpoint (knex, admin/
-- spielplaner-gated, actor-logged) — never the items API. Schema-only +
-- idempotent per the CLAUDE.md migration policy.

BEGIN;

ALTER TABLE scheduling_emails
  ADD COLUMN IF NOT EXISTS assigned_opponent integer;

COMMENT ON COLUMN scheduling_emails.assigned_opponent IS
  'Manual override of the read-time opponent classification: the game_scheduling_opponents.id a spielplaner pinned this email chain to. Soft reference (no FK; opponents are recreated on resync). NULL = use auto-classification.';

-- Directus admin metadata (visibility/debugging only; the table carries no item
-- permissions — access is via the scheduling-mailbox endpoints).
INSERT INTO directus_fields (collection, field, special, interface, sort, width, note)
SELECT 'scheduling_emails', 'assigned_opponent', NULL, 'input', 7, 'half',
  'Manual opponent assignment (game_scheduling_opponents.id). NULL = auto-classify.'
WHERE NOT EXISTS (
  SELECT 1 FROM directus_fields WHERE collection = 'scheduling_emails' AND field = 'assigned_opponent'
);

COMMIT;
