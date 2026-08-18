-- Migration 326: email_accounts — the club's mailbox credential store ("Emails Garage")
--
-- The club runs a dozen mailboxes across five .kscw.ch (sub)domains — the two
-- scheduling boxes, admin@wiedisync, scorer@volleyball, finance@mail,
-- vis_transfers@mail, kontakt@, and whatever Migadu holds that nobody wrote
-- down. Until now the only record of which ones exist and what their passwords
-- are was Luca's Vaultwarden, which nobody else in the committee can open. A
-- volleyball admin who needs to read scorer@ in Migadu webmail had to ask.
--
-- This table is that record, readable in-app at /admin/emails-garage.
--
-- ⚠⚠ THIS TABLE IS DELIBERATELY NOT REGISTERED IN directus_collections /
-- directus_fields. That is the opposite of the CLAUDE.md rule for ordinary
-- columns, and it is on purpose: an unregistered table is invisible to the
-- Directus items API (/items/email_accounts 403s for everyone, admins
-- included), so the ONLY door to it is the gated custom endpoint in
-- kscw-endpoints/src/email-accounts.js, which enforces the sport scope and
-- writes an audit row per reveal. Registering it would hand every field to
-- anyone holding a broad `fields=*` policy and bypass the reveal log entirely.
-- If a future migration is tempted to add it to the data model: don't.
--
-- ⚠ `password_enc` is CIPHERTEXT, never a plaintext password. Format is
-- `v1:<iv_b64>:<tag_b64>:<ciphertext_b64>`, AES-256-GCM under EMAIL_VAULT_KEY
-- (a 32-byte key in the container env, NOT in the database). A stolen dump is
-- therefore useless on its own — which is the whole reason the column is not
-- plain text, since the page's entire job is to display these.
--
-- ⚠ `sport` drives who may see the row (migration-level default 'club'):
--   volleyball → global admin + vb_admin      basketball → global admin + bb_admin
--   club       → every admin tier that reaches the page
-- It is derived from the address's domain on insert/sync (volleyball.kscw.ch →
-- volleyball, basketball.kscw.ch → basketball, everything else → club) but is a
-- real editable column, because `scorer@volleyball.kscw.ch` is volleyball by
-- domain while `kontakt@kscw.ch` is club-wide by intent, not by DNS.
--
-- Schema-only, idempotent. No permission rows — permissions live only in
-- setup-permissions.mjs, and this collection is intentionally outside Directus.

BEGIN;

CREATE TABLE IF NOT EXISTS email_accounts (
  id               serial PRIMARY KEY,
  address          text        NOT NULL,
  label            text,
  sport            text        NOT NULL DEFAULT 'club',
  provider         text        NOT NULL DEFAULT 'migadu',
  password_enc     text,
  notes            text,
  -- true once the Migadu mailbox sweep has seen this address. Rows a human
  -- typed in for a non-Migadu box (ClubDesk, SES) stay false and are never
  -- deactivated by the sweep.
  migadu_managed   boolean     NOT NULL DEFAULT false,
  is_active        boolean     NOT NULL DEFAULT true,
  last_seen_at     timestamptz,
  sort             integer,
  created_by_name  text,
  updated_by_name  text,
  date_created     timestamptz NOT NULL DEFAULT now(),
  date_updated     timestamptz
);

-- Addresses are case-insensitive; the endpoint lowercases on write, and the
-- index makes a second casing a hard conflict rather than a silent duplicate
-- row with a different password.
CREATE UNIQUE INDEX IF NOT EXISTS email_accounts_address_key
  ON email_accounts (lower(address));

CREATE INDEX IF NOT EXISTS email_accounts_sport_idx ON email_accounts (sport);

-- Domain is read constantly (grouping the page, deriving the sport) and never
-- written independently — a generated column keeps it honest against an address
-- edit that a trigger-free text column would silently outlive.
ALTER TABLE email_accounts
  ADD COLUMN IF NOT EXISTS domain text
  GENERATED ALWAYS AS (lower(split_part(address, '@', 2))) STORED;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'email_accounts_sport_check'
  ) THEN
    ALTER TABLE email_accounts
      ADD CONSTRAINT email_accounts_sport_check
      CHECK (sport IN ('volleyball', 'basketball', 'club'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'email_accounts_address_check'
  ) THEN
    -- Not a full RFC address grammar — just enough that a typo'd "scorer" with
    -- no domain cannot become a row whose generated `domain` is the empty
    -- string and which therefore sorts into a nameless group on the page.
    ALTER TABLE email_accounts
      ADD CONSTRAINT email_accounts_address_check
      CHECK (address LIKE '%@%.%' AND address NOT LIKE '%@' AND address NOT LIKE '@%');
  END IF;
END $$;

COMMENT ON TABLE public.email_accounts IS
  'The club mailbox credential store behind /admin/emails-garage. NOT registered in '
  'directus_collections on purpose — the only reader is kscw-endpoints/src/email-accounts.js, '
  'which enforces the per-sport scope and audits every password reveal. password_enc is '
  'AES-256-GCM ciphertext under EMAIL_VAULT_KEY (container env), never plaintext.';

COMMENT ON COLUMN public.email_accounts.password_enc IS
  'v1:<iv_b64>:<tag_b64>:<ct_b64> — AES-256-GCM under EMAIL_VAULT_KEY. NULL = no password on '
  'file (the account is listed, the page shows "not stored"). Never select this into any '
  'response that is not the audited single-row reveal.';

COMMENT ON COLUMN public.email_accounts.sport IS
  'Visibility scope: volleyball = global admin + vb_admin, basketball = global admin + bb_admin, '
  'club = every admin tier on the page. Seeded from the domain, editable — intent beats DNS.';

COMMENT ON COLUMN public.email_accounts.migadu_managed IS
  'true once the Migadu mailbox sweep saw this address. The sweep only ever deactivates rows it '
  'owns, so a hand-entered ClubDesk/SES address is never touched by it.';

COMMIT;

-- Verification (dev/prod):
--   \d email_accounts
--   SELECT to_regclass('public.email_accounts');                        -- → email_accounts
--   SELECT count(*) FROM directus_collections WHERE collection = 'email_accounts';  -- → 0 (must stay 0)
--   SELECT count(*) FROM directus_fields      WHERE collection = 'email_accounts';  -- → 0 (must stay 0)
