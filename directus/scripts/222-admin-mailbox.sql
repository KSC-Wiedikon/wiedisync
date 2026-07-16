-- Migration 222: club-admin mailbox (admin@wiedisync.kscw.ch).
--
-- A third mailbox alongside the two Spielplanung ones, for general club admin
-- correspondence. It reuses `scheduling_emails` rather than forking a table: the
-- IMAP sync, MIME composition, Sent-append and attachment streaming in
-- scheduling-mailbox.js are all account-agnostic already, and a fork would mean
-- maintaining two copies of ~900 lines that drift (cf. the team-availability /
-- slots-token copy that has to be hand-kept in sync).
--
-- The cost of reusing: `scheduling_emails` keeps a name that no longer strictly
-- describes it, and `account` stops meaning "sport". That's the honest trade —
-- the column was always a partition key, `sport` was just the only partition
-- that existed. The CHECK is widened rather than dropped so an unknown account
-- still can't be written.
--
-- Mail path (same as spielplanung): Migadu IMAP inbound, AWS SES SMTP outbound.
-- Migadu's send quota is never touched — only a human sending from Migadu webmail
-- consumes it. Sending from this address needs wiedisync.kscw.ch verified as an
-- SES identity + `include:amazonses.com` in its SPF, or DMARC (p=quarantine on
-- that domain) drops the replies. Do NOT set a custom SES MAIL FROM on it: that
-- needs an MX record and would fight Migadu's inbound MX.
--
-- ── Per-user read state ────────────────────────────────────────────────
-- scheduling_emails.read_at is a single GLOBAL marker — deliberate for
-- Spielplanung, which is one shared desk staffed by one or two spielplaners.
-- The club mailbox has several admins reading independently, where one person
-- opening a message must not mark it read for everyone. So the admin account
-- gets per-user reads via this junction, and Spielplanung keeps read_at
-- untouched. `scheduling_email_reads` is therefore NOT a general replacement:
-- it's consulted only for accounts flagged perUserReads in ACCOUNTS.
--
-- Schema-only + idempotent. Item permissions: none — scheduling_emails has no
-- policy rows at all (migration 100 header); the endpoint IS the gate, via
-- authForAccount in scheduling-mailbox.js.

BEGIN;

-- Widen the account partition. 'admin' = admin@wiedisync.kscw.ch.
DO $$ BEGIN
  ALTER TABLE public.scheduling_emails DROP CONSTRAINT IF EXISTS scheduling_emails_account_check;
  ALTER TABLE public.scheduling_emails
    ADD CONSTRAINT scheduling_emails_account_check
    CHECK (account IN ('volleyball', 'basketball', 'admin'));
END $$;

COMMENT ON COLUMN public.scheduling_emails.account IS
  'Mailbox partition (migrations 144/222): volleyball|basketball = the Spielplanung mailboxes at *@spielplanung.kscw.ch; admin = the club-admin mailbox at admin@wiedisync.kscw.ch. Deduped per-account by UNIQUE (account, message_id). NB this is an account key, not a sport — the name predates the admin mailbox.';

CREATE TABLE IF NOT EXISTS public.scheduling_email_reads (
  id       serial PRIMARY KEY,
  email    integer NOT NULL REFERENCES public.scheduling_emails(id) ON DELETE CASCADE,
  member   integer NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  read_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT scheduling_email_reads_email_member_unique UNIQUE (email, member)
);

-- The unread count is a NOT EXISTS against (member, email) on every list load.
CREATE INDEX IF NOT EXISTS scheduling_email_reads_member_idx
  ON public.scheduling_email_reads (member, email);

COMMENT ON TABLE public.scheduling_email_reads IS
  'Per-user read state (migration 222), for mailbox accounts where several people read independently — currently only the admin account. The Spielplanung accounts keep the global scheduling_emails.read_at marker instead (one shared desk, one shared read state). A row means "this member has opened this message".';

-- ── Directus admin metadata (visibility/debugging; the endpoint is the gate) ──
INSERT INTO directus_collections (collection, icon, color, "group", sort, archive_app_filter)
SELECT 'scheduling_email_reads', 'drafts', '#0ea5e9', NULL, NULL, true
WHERE NOT EXISTS (SELECT 1 FROM directus_collections WHERE collection = 'scheduling_email_reads');

INSERT INTO directus_fields (collection, field, special, interface, display, sort, width, note)
SELECT 'scheduling_email_reads', 'email', 'm2o', 'select-dropdown-m2o', 'related-values', 1, 'half', 'The message that was opened.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'scheduling_email_reads' AND field = 'email');

INSERT INTO directus_fields (collection, field, special, interface, display, sort, width, note)
SELECT 'scheduling_email_reads', 'member', 'm2o', 'select-dropdown-m2o', 'related-values', 2, 'half', 'The admin who opened it.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'scheduling_email_reads' AND field = 'member');

INSERT INTO directus_fields (collection, field, interface, readonly, sort, width)
SELECT 'scheduling_email_reads', 'read_at', 'datetime', true, 3, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'scheduling_email_reads' AND field = 'read_at');

INSERT INTO directus_relations (many_collection, many_field, one_collection, one_field, one_collection_field, one_allowed_collections, junction_field, sort_field, one_deselect_action)
SELECT 'scheduling_email_reads', 'email', 'scheduling_emails', NULL, NULL, NULL, NULL, NULL, 'delete'
WHERE NOT EXISTS (SELECT 1 FROM directus_relations WHERE many_collection = 'scheduling_email_reads' AND many_field = 'email');

INSERT INTO directus_relations (many_collection, many_field, one_collection, one_field, one_collection_field, one_allowed_collections, junction_field, sort_field, one_deselect_action)
SELECT 'scheduling_email_reads', 'member', 'members', NULL, NULL, NULL, NULL, NULL, 'delete'
WHERE NOT EXISTS (SELECT 1 FROM directus_relations WHERE many_collection = 'scheduling_email_reads' AND many_field = 'member');

COMMIT;
