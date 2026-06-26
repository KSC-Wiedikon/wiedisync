-- Migration 140: finance email settings — the bulk-send TEST MODE switch.
--
-- Singleton row (id = 1). `test_mode` defaults TRUE so that NO real member email
-- can go out until an admin explicitly turns it off: while test_mode is on, every
-- dues-run email send is redirected to `test_recipient` (the treasurer sees the
-- mail; members never do). Flipping test_mode off is the deliberate, audit-logged
-- act that enables real sends.
--
-- Schema-only + idempotent. Reads/writes go through /kscw/finance/email-settings
-- (canManageFinance) — endpoint-gated, no items-API permission needed.

BEGIN;

CREATE TABLE IF NOT EXISTS finance_email_settings (
  id               smallint PRIMARY KEY DEFAULT 1,
  test_mode        boolean NOT NULL DEFAULT true,
  test_recipient   varchar(255),
  updated_by_name  varchar(255),
  updated_by_email varchar(255),
  date_updated     timestamptz,
  CONSTRAINT finance_email_settings_singleton CHECK (id = 1)
);
-- Seed the safe default (test mode ON) — idempotent.
INSERT INTO finance_email_settings (id, test_mode) VALUES (1, true) ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE finance_email_settings IS
  'Singleton (id=1) finance email switch. test_mode=true (default) redirects every dues-run email to test_recipient so members are never emailed until an admin turns it off.';

-- Directus admin metadata (singleton collection, optional admin visibility).
INSERT INTO directus_collections (collection, icon, color, "group", sort, archive_app_filter, singleton)
SELECT 'finance_email_settings', 'mark_email_read', '#059669', NULL, NULL, true, true
WHERE NOT EXISTS (SELECT 1 FROM directus_collections WHERE collection = 'finance_email_settings');

INSERT INTO directus_fields (collection, field, special, interface, sort, width, note)
SELECT 'finance_email_settings', 'test_mode', 'cast-boolean', 'boolean', 1, 'half',
  'When on, dues emails go ONLY to the test recipient — never to members.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_email_settings' AND field = 'test_mode');
INSERT INTO directus_fields (collection, field, interface, sort, width, note)
SELECT 'finance_email_settings', 'test_recipient', 'input', 2, 'half', 'Address that receives every send while test mode is on.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_email_settings' AND field = 'test_recipient');
INSERT INTO directus_fields (collection, field, interface, readonly, sort, width)
SELECT 'finance_email_settings', 'updated_by_name', 'input', true, 3, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_email_settings' AND field = 'updated_by_name');

COMMIT;
