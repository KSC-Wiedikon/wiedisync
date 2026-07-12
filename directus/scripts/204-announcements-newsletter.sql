-- Migration 204: newsletter-style announcement emails.
--
-- Per-announcement email options for the "newsletter look" (2026-07-12):
--   email_layout — 'standard' (existing branded card) or 'newsletter'
--                  (wide masthead layout; the announcement image renders as a
--                  hero — announcement images are folder-less uploads, which
--                  the Public policy can read via /assets, so email clients
--                  can fetch them anonymously).
--   reply_to     — optional Reply-To address for the outbound emails; NULL or
--                  empty keeps today's no-reply behaviour.
--
-- Read by the announcements email fanout in kscw-hooks; written by the
-- AnnouncementsPage via the items API (Sport Admin+ already has announcements
-- CRUD, so no permission changes).
--
-- Schema-only + idempotent.

BEGIN;

ALTER TABLE announcements ADD COLUMN IF NOT EXISTS email_layout varchar(20) NOT NULL DEFAULT 'standard';
ALTER TABLE announcements ADD COLUMN IF NOT EXISTS reply_to varchar(255);

DO $$ BEGIN
  ALTER TABLE announcements
    ADD CONSTRAINT announcements_email_layout_check
    CHECK (email_layout IN ('standard', 'newsletter'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN announcements.email_layout IS
  'Email template for the fanout: standard branded card or newsletter masthead layout (migration 204).';
COMMENT ON COLUMN announcements.reply_to IS
  'Optional Reply-To for announcement emails; NULL/empty = no-reply (migration 204).';

-- ── Directus admin metadata ────────────────────────────────────────────
INSERT INTO directus_fields (collection, field, interface, options, readonly, hidden, sort, width, note)
SELECT 'announcements', 'email_layout', 'select-dropdown',
  '{"choices":[{"text":"Standard","value":"standard"},{"text":"Newsletter","value":"newsletter"}]}'::json,
  false, false, 30, 'half',
  'Email template for the fanout (standard card vs newsletter masthead).'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'announcements' AND field = 'email_layout');

INSERT INTO directus_fields (collection, field, interface, readonly, hidden, sort, width, note)
SELECT 'announcements', 'reply_to', 'input', false, false, 31, 'half',
  'Optional Reply-To for announcement emails; empty = no-reply.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'announcements' AND field = 'reply_to');

COMMIT;
