-- Migration 443: weekly overview email (Sunday 18:00 Zurich).
--
-- Owner, 03.11.2026: on top of the two reminders of migration 442, one email on
-- Sunday evening listing the member's trainings, games and events of the coming
-- week (Monday to Sunday), each with their answer and, while it is still open,
-- the deadline. Default on, a third switch in Profile → Email notifications.
--
--   email_notify_weekly_digest — the weekly overview (default on)
--
-- The digest claims one email_reminders_sent row per listed activity with kind
-- 'weekly', so a re-run on the same evening (the cron checks 18:00–20:59) skips a
-- member who already got theirs. The kind CHECK is widened for it.
--
-- Schema-only + idempotent.

BEGIN;

ALTER TABLE members ADD COLUMN IF NOT EXISTS email_notify_weekly_digest boolean NOT NULL DEFAULT true;

INSERT INTO directus_fields (collection, field, special, interface, width, sort, note)
SELECT 'members', 'email_notify_weekly_digest', 'cast-boolean', 'boolean', 'half', 488,
       'Email me an overview of my coming week on Sunday evening.'
WHERE NOT EXISTS (
  SELECT 1 FROM directus_fields df WHERE df.collection = 'members' AND df.field = 'email_notify_weekly_digest'
);

ALTER TABLE email_reminders_sent DROP CONSTRAINT IF EXISTS email_reminders_sent_kind_chk;
ALTER TABLE email_reminders_sent ADD CONSTRAINT email_reminders_sent_kind_chk
  CHECK (kind IN ('rsvp', 'activity', 'weekly'));

COMMIT;
