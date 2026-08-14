-- Migration 321: the ClubDesk sync-down stops writing and starts PROPOSING.
--
-- Until now, clicking "Sync down" WAS the write. The button set a flag, a
-- per-minute dispatcher ran clubdesk-sync.sh, and import-clubdesk-csv.mjs piped
-- one SQL blob straight into psql — 21 statements against `members` across 10
-- transactions. A weekly cron (Sat 22:00 UTC) did the same with nobody watching.
--
-- Exactly ONE of those 21 statements checked `clubdesk_push_pending`, and even
-- that guard was undercut: passes A and B wrote 7 of the same columns earlier in
-- the same run, matched by license_nr/email instead of clubdesk_id, unguarded.
-- So a correction made in wiedisync could be silently reverted by the next
-- sync — the defect migration 319 had to fix forward for `beitragskategorie`,
-- one column at a time. This table fixes the shape instead of the symptom.
--
-- The new contract: the sync-down DETECTS and stages a row here; a superadmin
-- accepts (ClubDesk's value is written to `members`) or refuses (ours stands,
-- and the member is flagged so the next sync-up corrects ClubDesk). Linking is
-- deliberately NOT staged — `clubdesk_id` is identity, not data; it only ever
-- fills an empty value and only on authoritative keys, and ambiguous matches
-- already have their own "Link" decision in Data Health.
--
-- ⚠ `rule` is not decoration. It records WHY the sync wanted the change, which
-- is the only thing that makes an accept/refuse decision informed:
--   fill      — wiedisync's cell is empty, ClubDesk has something
--   overwrite — both hold a value and ClubDesk's has historically won
--                (beitragskategorie, sektion, register_status, eintritt, austritt)
--   set_true  — a group/licence-derived boolean the register asserts
--   create    — a ClubDesk contact with no `members` row at all
--
-- ⚠⚠ The two partial uniques below are the whole safety model, and they are
-- NOT interchangeable:
--
--   proposals_pending_uq  — re-running detection must not stack duplicate open
--     proposals for the same (member, field). Detection runs weekly plus
--     on-demand; without this the queue grows by one row per run per diff and
--     an admin ends up deciding the same question repeatedly.
--
--   proposals_refused_uq  — THE TOMBSTONE, and the thing the codebase has been
--     missing outright. import-clubdesk-csv.mjs:569-575 already documents the
--     need for it ("a member who deletes their IBAN would have it resurrected
--     every sync... needs a tombstone before importing") and works around its
--     absence by excluding IBAN from the down-sync entirely. A refused
--     (member, field, value) triple is skipped by detection forever, so
--     refusing is a durable decision rather than a weekly chore. It keys on
--     `proposed_value` on purpose: refusing "ClubDesk says Zürich" must not
--     suppress a LATER, genuinely different proposal for the same field.
--
-- Deliberately no `directus_fields` registration: this table is read and written
-- only by kscw-endpoints over raw knex, never through the items API, and an
-- unregistered table stays out of the Data Explorer's collection list. If the
-- explorer ever needs it, that is a separate schema-only migration.
--
-- Permissions live in setup-permissions.mjs (CLAUDE.md rule 1), not here.

CREATE TABLE IF NOT EXISTS clubdesk_sync_proposals (
  id               bigserial PRIMARY KEY,
  -- NULL for a `create` proposal: there is no member row yet, that is the point.
  member_id        integer REFERENCES members(id) ON DELETE CASCADE,
  clubdesk_id      varchar(64) NOT NULL,
  -- NULL for a `create` proposal (the whole contact is proposed, not one cell).
  field            varchar(64),
  current_value    text,
  proposed_value   text,
  rule             varchar(16) NOT NULL,
  status           varchar(16) NOT NULL DEFAULT 'pending',
  -- For a `create`, the contact's name/email so the reviewer can judge without
  -- a second lookup into clubdesk_export (which is TRUNCATEd every run).
  payload          jsonb,
  detected_at      timestamptz NOT NULL DEFAULT now(),
  decided_at       timestamptz,
  decided_by_name  varchar(255),
  decided_by_email varchar(255),
  CONSTRAINT clubdesk_sync_proposals_rule_chk
    CHECK (rule IN ('fill', 'overwrite', 'set_true', 'create')),
  CONSTRAINT clubdesk_sync_proposals_status_chk
    CHECK (status IN ('pending', 'accepted', 'refused')),
  -- A field proposal needs a member and a column; a create needs neither.
  CONSTRAINT clubdesk_sync_proposals_shape_chk
    CHECK (
      (rule = 'create' AND member_id IS NULL AND field IS NULL)
      OR (rule <> 'create' AND member_id IS NOT NULL AND field IS NOT NULL)
    )
);

-- One open proposal per (member, field). Creates are keyed on the contact
-- instead, since they have no member_id yet.
DROP INDEX IF EXISTS clubdesk_sync_proposals_pending_uq;
CREATE UNIQUE INDEX clubdesk_sync_proposals_pending_uq
  ON clubdesk_sync_proposals (member_id, field)
  WHERE status = 'pending' AND rule <> 'create';

DROP INDEX IF EXISTS clubdesk_sync_proposals_pending_create_uq;
CREATE UNIQUE INDEX clubdesk_sync_proposals_pending_create_uq
  ON clubdesk_sync_proposals (clubdesk_id)
  WHERE status = 'pending' AND rule = 'create';

-- The tombstone. Keyed on the VALUE so a later, different proposal still lands.
DROP INDEX IF EXISTS clubdesk_sync_proposals_refused_uq;
CREATE UNIQUE INDEX clubdesk_sync_proposals_refused_uq
  ON clubdesk_sync_proposals (member_id, field, proposed_value)
  WHERE status = 'refused' AND rule <> 'create';

DROP INDEX IF EXISTS clubdesk_sync_proposals_refused_create_uq;
CREATE UNIQUE INDEX clubdesk_sync_proposals_refused_create_uq
  ON clubdesk_sync_proposals (clubdesk_id)
  WHERE status = 'refused' AND rule = 'create';

-- The list query is "everything still pending, newest first".
DROP INDEX IF EXISTS clubdesk_sync_proposals_status_idx;
CREATE INDEX clubdesk_sync_proposals_status_idx
  ON clubdesk_sync_proposals (status, detected_at DESC);
