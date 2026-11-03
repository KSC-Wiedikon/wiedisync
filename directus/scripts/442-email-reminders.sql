-- Migration 442: email reminders — "you haven't answered" + "your activity starts soon".
--
-- Owner, 03.11.2026, after a team poll (8 of 9: "yes for both"): Wiedisync emails a
-- member who has not answered Yes or No (Maybe counts as not answered) before the
-- deadline, and reminds them of a training / game / event a chosen time before it
-- starts. Each player switches either email off in Profile → Email notifications.
-- Scorer duties keep their own reminder (scorer-reminders.js); this does not touch it.
--
--   email_notify_rsvp_reminders      — daily digest of activities still waiting for a
--                                      Yes/No (default on)
--   email_notify_activity_reminders  — one email per activity before it starts (default on)
--   activity_reminder_lead_minutes   — how long before the start that email goes out
--                                      (default 1440 = 1 day; the profile offers 1 h … 2 days)
--
-- email_reminders_sent is the send log the crons dedupe on (kscw-hooks
-- email-reminders.js): one row per member, activity and kind, claimed before the
-- mail goes out and removed again when the send fails, so a retry is possible and a
-- second run never mails twice. Not a Directus collection — only the hooks read and
-- write it; the 04:00 notification cleanup trims rows older than 60 days.
--
-- Schema-only + idempotent.

BEGIN;

ALTER TABLE members ADD COLUMN IF NOT EXISTS email_notify_rsvp_reminders     boolean NOT NULL DEFAULT true;
ALTER TABLE members ADD COLUMN IF NOT EXISTS email_notify_activity_reminders boolean NOT NULL DEFAULT true;
ALTER TABLE members ADD COLUMN IF NOT EXISTS activity_reminder_lead_minutes  integer NOT NULL DEFAULT 1440;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'members_activity_reminder_lead_minutes_range') THEN
    ALTER TABLE members ADD CONSTRAINT members_activity_reminder_lead_minutes_range
      CHECK (activity_reminder_lead_minutes BETWEEN 15 AND 10080);
  END IF;
END $$;

INSERT INTO directus_fields (collection, field, special, interface, width, sort, note)
SELECT v.collection, v.field, v.special, v.interface, 'half', v.sort, v.note
FROM (VALUES
  ('members', 'email_notify_rsvp_reminders',     'cast-boolean', 'boolean',       485, 'Email me when I have not answered Yes or No before the deadline.'),
  ('members', 'email_notify_activity_reminders', 'cast-boolean', 'boolean',       486, 'Email me before my trainings, games and events.'),
  ('members', 'activity_reminder_lead_minutes',  NULL,           'input',         487, 'How many minutes before the start the activity reminder is sent.')
) AS v(collection, field, special, interface, sort, note)
WHERE NOT EXISTS (
  SELECT 1 FROM directus_fields df WHERE df.collection = v.collection AND df.field = v.field
);

CREATE TABLE IF NOT EXISTS email_reminders_sent (
  id            bigserial PRIMARY KEY,
  member        integer NOT NULL REFERENCES members (id) ON DELETE CASCADE,
  activity_type text NOT NULL,
  activity_id   text NOT NULL,
  kind          text NOT NULL,
  sent_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT email_reminders_sent_activity_type_chk CHECK (activity_type IN ('training', 'game', 'event')),
  CONSTRAINT email_reminders_sent_kind_chk CHECK (kind IN ('rsvp', 'activity')),
  CONSTRAINT email_reminders_sent_unique UNIQUE (member, activity_type, activity_id, kind)
);

CREATE INDEX IF NOT EXISTS email_reminders_sent_sent_at_idx ON email_reminders_sent (sent_at);

COMMENT ON TABLE public.email_reminders_sent IS
  'Send log of the RSVP + activity reminder emails (kscw-hooks email-reminders.js). One row per member, activity and kind; the crons skip anything already here.';

COMMIT;
