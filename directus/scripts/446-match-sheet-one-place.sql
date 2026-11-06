-- Migration 446: the match sheet is the one place to change the players (owner, 06.11.2026).
--
-- A coach's add or removal on the sheet now also writes the RSVP and re-saves the
-- Einsatzliste in Volleymanager (scorer-roster.js, nomination-push.js).
--
--   games.vm_nomination_sheet_changed_at — when a coach last changed WHO is on the sheet,
--     not their number or captain. NULL: never. Later than vm_nomination_claimed_at means no
--     push has seen that change yet, say because one was already running or the queue was lost
--     in a restart, and the cron sends it (nominationPushDue).
--
-- The email about a list Volleymanager flags claims one email_reminders_sent row per
-- recipient with kind 'nomination_flagged', so the CHECK is widened for it.
--
-- Schema-only + idempotent. Written by raw knex only: no field row, no permissions, the
-- same as vm_nomination_claimed_at.

BEGIN;

ALTER TABLE games ADD COLUMN IF NOT EXISTS vm_nomination_sheet_changed_at timestamptz;

ALTER TABLE email_reminders_sent DROP CONSTRAINT IF EXISTS email_reminders_sent_kind_chk;
ALTER TABLE email_reminders_sent ADD CONSTRAINT email_reminders_sent_kind_chk
  CHECK (kind IN ('rsvp', 'activity', 'weekly', 'nomination_list', 'nomination_flagged'));

COMMIT;
