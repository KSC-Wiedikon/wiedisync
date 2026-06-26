-- Migration 146: dunning / Mahnwesen — payment reminders on overdue native invoices.
--
-- Native-only (source='native', status open/partial, open_amount>0, due_date<today).
-- finance_dunning_notices records each reminder (level 1/2/3, optional fee, channel);
-- finance_invoices.dunning_level denormalises the highest level issued (for the
-- aging list + badge); members.never_dun is the per-member opt-out (Swiss clubs
-- often flag members never to remind), backfilled from clubdesk_export.nie_mahnen.
--
-- Reminder SENDING reuses the existing test-mode-guarded email path, so no member
-- is reminded by email until test mode is off. Schema-only + idempotent.

BEGIN;

CREATE TABLE IF NOT EXISTS finance_dunning_notices (
  id               serial PRIMARY KEY,
  invoice          integer NOT NULL REFERENCES finance_invoices(id) ON DELETE CASCADE,
  level            smallint NOT NULL CHECK (level BETWEEN 1 AND 3),
  reminder_fee     numeric(12,2) NOT NULL DEFAULT 0,
  channel          varchar(16) NOT NULL DEFAULT 'manual' CHECK (channel IN ('email', 'manual')),
  recipient_email  varchar(255),
  sent_at          timestamptz,
  created_by_name  varchar(255),
  created_by_email varchar(255),
  date_created     timestamptz NOT NULL DEFAULT now(),
  user_created     uuid,
  CONSTRAINT finance_dunning_notices_invoice_level_uq UNIQUE (invoice, level)
);
CREATE INDEX IF NOT EXISTS finance_dunning_notices_invoice_idx ON finance_dunning_notices (invoice);

ALTER TABLE finance_invoices ADD COLUMN IF NOT EXISTS dunning_level smallint NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS finance_invoices_native_overdue_idx
  ON finance_invoices (due_date) WHERE source = 'native' AND status IN ('open', 'partial');

ALTER TABLE members ADD COLUMN IF NOT EXISTS never_dun boolean NOT NULL DEFAULT false;

-- Backfill never_dun from the ClubDesk staging export (nie_mahnen is free TEXT in
-- clubdesk_export — parse common truthy encodings), by email, if present.
DO $$ BEGIN
  IF to_regclass('public.clubdesk_export') IS NOT NULL THEN
    UPDATE members m SET never_dun = true
    FROM clubdesk_export c
    WHERE lower(c.email) = lower(m.email)
      AND lower(trim(coalesce(c.nie_mahnen, ''))) IN ('true', 'wahr', 'ja', 'yes', '1', 'x')
      AND m.never_dun IS DISTINCT FROM true;
  END IF;
EXCEPTION WHEN undefined_column THEN NULL; END $$;

COMMENT ON COLUMN finance_invoices.dunning_level IS 'Highest dunning level issued for this native invoice (0=none, 1/2/3). Denormalised from finance_dunning_notices.';

INSERT INTO directus_collections (collection, icon, color, "group", sort, archive_app_filter)
SELECT 'finance_dunning_notices', 'notifications_active', '#d97706', NULL, NULL, true
WHERE NOT EXISTS (SELECT 1 FROM directus_collections WHERE collection = 'finance_dunning_notices');
INSERT INTO directus_fields (collection, field, special, interface, display, sort, width, note)
SELECT 'finance_dunning_notices', 'invoice', 'm2o', 'select-dropdown-m2o', 'related-values', 1, 'half', 'Invoice reminded.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_dunning_notices' AND field = 'invoice');
INSERT INTO directus_fields (collection, field, interface, sort, width)
SELECT 'finance_dunning_notices', 'level', 'input', 2, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_dunning_notices' AND field = 'level');
INSERT INTO directus_fields (collection, field, interface, sort, width)
SELECT 'finance_dunning_notices', 'reminder_fee', 'input', 3, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_dunning_notices' AND field = 'reminder_fee');
INSERT INTO directus_fields (collection, field, special, interface, readonly, hidden, sort)
SELECT 'finance_dunning_notices', 'date_created', 'date-created', 'datetime', true, true, 90
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_dunning_notices' AND field = 'date_created');
INSERT INTO directus_relations (many_collection, many_field, one_collection, one_field, one_collection_field, one_allowed_collections, junction_field, sort_field, one_deselect_action)
SELECT 'finance_dunning_notices', 'invoice', 'finance_invoices', NULL, NULL, NULL, NULL, NULL, 'nullify'
WHERE NOT EXISTS (SELECT 1 FROM directus_relations WHERE many_collection = 'finance_dunning_notices' AND many_field = 'invoice');

COMMIT;
