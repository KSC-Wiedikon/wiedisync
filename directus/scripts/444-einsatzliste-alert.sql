-- Migration 444: the Einsatzliste alert, 2 hours before a game.
--
-- Owner, 04.11.2026: read the Einsatzliste 2 h before kickoff, and when it is empty or
-- differs from the RSVPs, email the team's coaches and team responsibles.
--
--   game_vm_sheets.alert_checked_at — the list was compared for the alert (whatever the
--     result, once per game; kscw-hooks einsatzliste-alert.js). NULL: not yet, or a send
--     failed and the next tick retries.
--
-- The email claims one email_reminders_sent row per recipient with kind 'einsatzliste',
-- so a retry only reaches the people who did not get it. The kind CHECK is widened for it.
--
-- Schema-only + idempotent. game_vm_sheets is raw-knex only: no field row, no permissions.

BEGIN;

ALTER TABLE game_vm_sheets ADD COLUMN IF NOT EXISTS alert_checked_at timestamptz;

ALTER TABLE email_reminders_sent DROP CONSTRAINT IF EXISTS email_reminders_sent_kind_chk;
ALTER TABLE email_reminders_sent ADD CONSTRAINT email_reminders_sent_kind_chk
  CHECK (kind IN ('rsvp', 'activity', 'weekly', 'einsatzliste'));

COMMIT;
