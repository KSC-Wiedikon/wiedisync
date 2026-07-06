-- Migration 178: scheduling_emails.group_reposted_at (cron bookkeeping)
--
-- Option 4 for the Spielplanung → Google Group flow: instead of Migadu's
-- transparent forward (which keeps the external sender's From and gets
-- spoof-rejected by Google Groups for -all/no-DMARC domains like svrz.ch), the
-- mailbox cron re-mails qualifying inbound messages to the group AS the mailbox
-- (volleyball@spielplanung.kscw.ch — DKIM-aligned, so it authenticates and
-- posts). This column stamps when a row was handled (sent / skipped / dry-run)
-- so the 10-min cron never double-posts. NULL = not yet considered.
--
-- Internal bookkeeping written via raw knex (no directus_fields row needed).
-- Schema-only + idempotent.

BEGIN;

ALTER TABLE scheduling_emails
  ADD COLUMN IF NOT EXISTS group_reposted_at timestamptz;

-- Seal the existing backlog: only mail that arrives AFTER this migration should
-- be reposted, so the first cron run doesn't dump ~60 days of history into the
-- group. Stamps every current row as handled. Idempotent (NULL-only).
UPDATE scheduling_emails SET group_reposted_at = now() WHERE group_reposted_at IS NULL;

-- Partial index: the cron repeatedly scans for unhandled inbound rows.
CREATE INDEX IF NOT EXISTS scheduling_emails_group_repost_pending_idx
  ON scheduling_emails (account, date_sent)
  WHERE group_reposted_at IS NULL AND direction = 'in';

COMMIT;
