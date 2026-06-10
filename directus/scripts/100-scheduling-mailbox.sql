-- Migration 100: Embedded mailbox for the Spielplanung (Terminplanung) dashboard.
--
-- `scheduling_emails` — a local, synced copy of the dedicated Migadu mailbox
-- volleyball@spielplanung.kscw.ch. A cron (kscw-hooks, every 10 min) pulls the
-- INBOX + Sent folders over IMAP (imapflow + mailparser, env-gated on
-- SCHEDULING_IMAP_PASSWORD), parses each message and upserts it here keyed by
-- RFC 5322 Message-ID. Replies composed in the dashboard are sent over the
-- existing SES SMTP (raw MIME via nodemailer MailComposer, so threading headers
-- + Message-ID are under our control), appended to the Migadu Sent folder, and
-- logged here as direction='out'.
--
-- Messages are NOT linked to game_scheduling_opponents by FK: contact lists
-- change and one club contact can serve several KSCW teams, so the
-- opponent<->email match is computed at read time by address intersection with
-- game_scheduling_opponents.contact_email (tiny volumes — a season is a few
-- hundred mails). Attachment CONTENT is not stored; the metadata (filename,
-- type, size) lands in `attachments` and the bytes are streamed on demand from
-- IMAP via (folder, imap_uid).
--
-- Accessed ONLY via the kscw-endpoints scheduling-mailbox routes (knex, gated
-- by isAdminOrSpielplaner) — never the Directus items API — so NO permission
-- rows are needed (admins bypass; the endpoint is the gate). Schema-only +
-- idempotent per the CLAUDE.md migration policy.

BEGIN;

-- ── scheduling_emails ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS scheduling_emails (
  id               serial PRIMARY KEY,
  -- RFC 5322 Message-ID (angle brackets stripped). Synthetic
  -- "<folder>-<uidvalidity>-<uid>@sync.local" when a message has none.
  message_id       text NOT NULL,
  in_reply_to      text,
  -- Full References header (space-joined ids) — kept verbatim so replies can
  -- extend the chain. "references" is reserved-ish in SQL, hence the suffix.
  references_ids   text,
  direction        varchar(8) NOT NULL DEFAULT 'in',  -- 'in' (INBOX) | 'out' (Sent / app-sent)
  folder           varchar(64),                       -- IMAP folder it was synced from (NULL for app-sent until the Sent sync sees it)
  imap_uid         integer,                           -- UID in `folder` at sync time (attachment streaming)
  from_address     text,
  from_name        text,
  to_addresses     text,                              -- comma-joined bare addresses
  cc_addresses     text,
  subject          text,
  body_text        text,
  body_html        text,
  has_attachments  boolean NOT NULL DEFAULT false,
  attachments      jsonb,                             -- [{filename, contentType, size}] — metadata only
  date_sent        timestamptz,                       -- Date header (fallback: IMAP internal date)
  read_at          timestamptz,                       -- dashboard-level read marker (global, not per-user)
  date_created     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT scheduling_emails_message_id_unique UNIQUE (message_id),
  CONSTRAINT scheduling_emails_direction_check CHECK (direction IN ('in', 'out'))
);

-- Hot path: "latest N messages" for the dashboard list.
CREATE INDEX IF NOT EXISTS scheduling_emails_date_sent_idx
  ON scheduling_emails (date_sent DESC NULLS LAST);
-- Unread badge: direction='in' AND read_at IS NULL.
CREATE INDEX IF NOT EXISTS scheduling_emails_unread_idx
  ON scheduling_emails (direction) WHERE read_at IS NULL;

COMMENT ON TABLE scheduling_emails IS
  'Synced copy of the volleyball@spielplanung.kscw.ch Migadu mailbox (INBOX + Sent) plus dashboard-composed replies. Deduped by Message-ID. Opponent matching is computed at read time by address intersection with game_scheduling_opponents.contact_email. Managed only via the kscw scheduling-mailbox endpoints (knex, admin/spielplaner-gated).';
COMMENT ON COLUMN scheduling_emails.message_id IS
  'RFC 5322 Message-ID without angle brackets; synthetic fallback when absent. Unique — the sync upserts ON CONFLICT DO NOTHING.';
COMMENT ON COLUMN scheduling_emails.imap_uid IS
  'IMAP UID in `folder` at sync time. Used to stream attachment bytes on demand; can go stale after mailbox moves (the endpoint then returns 410 and a re-sync refreshes it).';
COMMENT ON COLUMN scheduling_emails.read_at IS
  'Set when a spielplaner opens the message in the dashboard. Global marker (single shared mailbox), not per-user.';

-- ── Directus admin metadata (visibility/debugging only; no item perms) ──
INSERT INTO directus_collections (collection, icon, color, "group", sort, archive_field, archive_value, unarchive_value, archive_app_filter)
SELECT 'scheduling_emails', 'mail', '#0EA5E9', NULL, NULL, NULL, NULL, NULL, true
WHERE NOT EXISTS (SELECT 1 FROM directus_collections WHERE collection = 'scheduling_emails');

INSERT INTO directus_fields (collection, field, special, interface, sort, width, note)
SELECT 'scheduling_emails', 'direction', NULL, 'select-dropdown', 1, 'half', 'in = received (INBOX), out = sent.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'scheduling_emails' AND field = 'direction');

INSERT INTO directus_fields (collection, field, special, interface, sort, width, note)
SELECT 'scheduling_emails', 'from_address', NULL, 'input', 2, 'half', 'Sender address.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'scheduling_emails' AND field = 'from_address');

INSERT INTO directus_fields (collection, field, special, interface, sort, width, note)
SELECT 'scheduling_emails', 'to_addresses', NULL, 'input', 3, 'half', 'Comma-joined recipient addresses.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'scheduling_emails' AND field = 'to_addresses');

INSERT INTO directus_fields (collection, field, special, interface, sort, width, note)
SELECT 'scheduling_emails', 'subject', NULL, 'input', 4, 'full', NULL
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'scheduling_emails' AND field = 'subject');

INSERT INTO directus_fields (collection, field, special, interface, sort, width, note)
SELECT 'scheduling_emails', 'date_sent', NULL, 'datetime', 5, 'half', 'Date header (fallback: IMAP internal date).'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'scheduling_emails' AND field = 'date_sent');

INSERT INTO directus_fields (collection, field, special, interface, sort, width, note)
SELECT 'scheduling_emails', 'read_at', NULL, 'datetime', 6, 'half', 'Read in the dashboard.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'scheduling_emails' AND field = 'read_at');

INSERT INTO directus_fields (collection, field, special, interface, readonly, hidden, sort)
SELECT 'scheduling_emails', 'date_created', 'date-created', 'datetime', true, true, 90
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'scheduling_emails' AND field = 'date_created');

COMMIT;
