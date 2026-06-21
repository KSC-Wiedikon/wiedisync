-- Migration 122: scorer-duty confirmation actor + timestamp.
--
-- Records WHO confirmed a game's scorekeeping duty and WHEN, so the scorer page
-- can show "Confirmed by … · dd.mm.yyyy HH:MM" (mirrors the game-scheduling
-- confirmed_by_* / confirmed_at pattern). Set server-side by a filter hook on
-- games.items.update (kscw-hooks) when duty_confirmed flips to true; cleared
-- when it flips to false.
--
-- NAME ONLY, no email: games.read is ['*'] for the Member policy, so any column
-- here is readable by every member — a confirmer's email must not ride along
-- (members otherwise can't read member emails). Name + timestamp answer
-- "who + when" without that leak.
--
-- Schema-only + idempotent. No permission change (games.read already ['*']).

BEGIN;

ALTER TABLE games ADD COLUMN IF NOT EXISTS duty_confirmed_by_name varchar(255);
ALTER TABLE games ADD COLUMN IF NOT EXISTS duty_confirmed_at timestamptz;

COMMENT ON COLUMN games.duty_confirmed_by_name IS
  'Display name of who confirmed the scorekeeping duty. Set by the kscw-hooks filter on games.items.update when duty_confirmed flips true; cleared when false. Shown on the scorer page.';
COMMENT ON COLUMN games.duty_confirmed_at IS
  'When the scorekeeping duty was confirmed. Set/cleared alongside duty_confirmed_by_name.';

-- Directus field metadata so the columns appear in the admin Data Model and are
-- reliably exposed by the items API. Mirrors the 117 (members.iban) pattern.
INSERT INTO directus_fields (collection, field, special, interface, sort, hidden, note)
SELECT 'games', 'duty_confirmed_by_name', NULL, 'input', 90, false,
  'Who confirmed the scorer duty (system-set by hook).'
WHERE NOT EXISTS (
  SELECT 1 FROM directus_fields WHERE collection = 'games' AND field = 'duty_confirmed_by_name'
);

INSERT INTO directus_fields (collection, field, special, interface, sort, hidden, note)
SELECT 'games', 'duty_confirmed_at', NULL, 'datetime', 91, false,
  'When the scorer duty was confirmed (system-set by hook).'
WHERE NOT EXISTS (
  SELECT 1 FROM directus_fields WHERE collection = 'games' AND field = 'duty_confirmed_at'
);

COMMIT;
