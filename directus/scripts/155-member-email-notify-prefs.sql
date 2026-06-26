-- Migration 155: per-member notification opt-out preferences.
--
-- Adds five boolean opt-in flags to members (default TRUE = keep receiving) so a
-- member — typically an admin or coach drowning in operational alerts — can
-- silence specific notification categories from their own profile:
--
--   email_notify_registrations    — admin/sport-admin alert on each new registration  (EMAIL)
--   email_notify_join_requests    — coach/TR alert when someone asks to join a team    (EMAIL)
--   email_notify_form_submissions — form owner/audience alert on a public submission   (PUSH; forms send no email)
--   email_notify_announcements    — club-news / announcement broadcast                 (EMAIL)
--   email_notify_events           — event invitation                                   (EMAIL)
--
-- Default TRUE preserves today's behavior (every qualifying recipient receives
-- everything) until a member explicitly opts out. Enforced in the send paths
-- (kscw-endpoints event-notify / registration / join-request / public-forms and
-- the kscw-hooks announcement fanout). Opt-out suppresses only the email (or the
-- form push) — the in-app notification bell is never affected.
--
-- Editable on the items API via MEMBER_EDITABLE_FIELDS (setup-permissions.mjs);
-- registered in directus_fields below so the items API + admin Data Model expose
-- them.
--
-- Schema-only + idempotent.

BEGIN;

ALTER TABLE members ADD COLUMN IF NOT EXISTS email_notify_registrations    boolean NOT NULL DEFAULT true;
ALTER TABLE members ADD COLUMN IF NOT EXISTS email_notify_join_requests    boolean NOT NULL DEFAULT true;
ALTER TABLE members ADD COLUMN IF NOT EXISTS email_notify_form_submissions boolean NOT NULL DEFAULT true;
ALTER TABLE members ADD COLUMN IF NOT EXISTS email_notify_announcements    boolean NOT NULL DEFAULT true;
ALTER TABLE members ADD COLUMN IF NOT EXISTS email_notify_events           boolean NOT NULL DEFAULT true;

-- Register in directus_fields so the items API + admin Data Model read them.
INSERT INTO directus_fields (collection, field, special, interface, width, sort, note)
SELECT v.collection, v.field, 'cast-boolean', 'boolean', 'half', v.sort, v.note
FROM (VALUES
  ('members', 'email_notify_registrations',    480, 'Email me about new registrations (admins/sport-admins).'),
  ('members', 'email_notify_join_requests',    481, 'Email me about team join requests (coaches/TRs).'),
  ('members', 'email_notify_form_submissions', 482, 'Notify me about form submissions (push — forms send no email).'),
  ('members', 'email_notify_announcements',     483, 'Email me club news / announcement broadcasts.'),
  ('members', 'email_notify_events',            484, 'Email me event invitations.')
) AS v(collection, field, sort, note)
WHERE NOT EXISTS (
  SELECT 1 FROM directus_fields df WHERE df.collection = v.collection AND df.field = v.field
);

COMMIT;
