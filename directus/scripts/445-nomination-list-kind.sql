-- Migration 445: the send-log kind of migration 444 in English.
--
-- 444 stored 'einsatzliste' as an email_reminders_sent kind, which db:lint-names refuses
-- (stored values are English). Its CHECK now allows 'nomination_list' instead. Nothing has
-- been logged under the old value on dev (the alert only runs on prod) and prod gets
-- 444 + 445 together; the UPDATE is there for safety.
--
-- Schema-only + idempotent.

BEGIN;

ALTER TABLE email_reminders_sent DROP CONSTRAINT IF EXISTS email_reminders_sent_kind_chk;
UPDATE email_reminders_sent SET kind = 'nomination_list' WHERE kind = 'einsatzliste';
ALTER TABLE email_reminders_sent ADD CONSTRAINT email_reminders_sent_kind_chk
  CHECK (kind IN ('rsvp', 'activity', 'weekly', 'nomination_list'));

COMMIT;
