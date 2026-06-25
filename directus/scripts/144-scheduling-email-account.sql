-- Migration 144: per-account partitioning for scheduling_emails.
--
-- The embedded Spielplanung mailbox (migration 100) synced a single Migadu
-- account, volleyball@spielplanung.kscw.ch. It now serves TWO accounts —
-- volleyball@ and the live basketball@spielplanung.kscw.ch — surfaced behind a
-- Volleyball/Basketball toggle on the new Mailbox tab. This migration adds an
-- `account` discriminator and moves dedup from a global Message-ID to a
-- per-account one, so the same Message-ID can legitimately appear in both
-- mailboxes (e.g. a mail Cc'd to both, or a cross-test) without one clobbering
-- the other.
--
-- Coupled to the kscw-endpoints scheduling-mailbox refactor: the sync/reply
-- upserts switch their ON CONFLICT target from (message_id) to
-- (account, message_id), so the new composite UNIQUE below MUST exist before the
-- new endpoint code runs (deploy schema first, per the CLAUDE.md policy).
--
-- Written ONLY via the scheduling-mailbox endpoints (knex, sport-gated) — never
-- the items API — so NO permission rows are needed. Schema-only + idempotent.

BEGIN;

-- Partition column. Added NOT NULL DEFAULT 'volleyball' so every existing row
-- (all volleyball) is backfilled in a single statement.
ALTER TABLE scheduling_emails
  ADD COLUMN IF NOT EXISTS account varchar(16) NOT NULL DEFAULT 'volleyball';

ALTER TABLE scheduling_emails
  DROP CONSTRAINT IF EXISTS scheduling_emails_account_check;
ALTER TABLE scheduling_emails
  ADD CONSTRAINT scheduling_emails_account_check CHECK (account IN ('volleyball', 'basketball'));

-- Move uniqueness from global message_id to per-account. Dropping the migration
-- 100 constraint drops its backing index too; the new composite is what the
-- endpoint's ON CONFLICT (account, message_id) needs.
ALTER TABLE scheduling_emails
  DROP CONSTRAINT IF EXISTS scheduling_emails_message_id_unique;
ALTER TABLE scheduling_emails
  DROP CONSTRAINT IF EXISTS scheduling_emails_account_message_id_unique;
ALTER TABLE scheduling_emails
  ADD CONSTRAINT scheduling_emails_account_message_id_unique UNIQUE (account, message_id);

-- Unread badge is now per-account (the list filters by account), so make the
-- partial index account-aware to keep the count index-served.
DROP INDEX IF EXISTS scheduling_emails_unread_idx;
CREATE INDEX IF NOT EXISTS scheduling_emails_unread_idx
  ON scheduling_emails (account, direction) WHERE read_at IS NULL;

COMMENT ON COLUMN scheduling_emails.account IS
  'Which Migadu mailbox this row belongs to: volleyball (default, back-compat) | basketball. Dedup is per-account: UNIQUE (account, message_id). Set by the scheduling-mailbox sync/reply path from the active account config.';

-- Directus admin metadata (visibility/debugging only; the table carries no item
-- permissions — access is via the scheduling-mailbox endpoints).
INSERT INTO directus_fields (collection, field, special, interface, sort, width, note)
SELECT 'scheduling_emails', 'account', NULL, 'select-dropdown', 0, 'half',
  'volleyball | basketball — which Migadu mailbox this message belongs to.'
WHERE NOT EXISTS (
  SELECT 1 FROM directus_fields WHERE collection = 'scheduling_emails' AND field = 'account'
);

COMMIT;
