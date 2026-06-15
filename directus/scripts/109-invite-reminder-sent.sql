-- Migration 109: track invite reminders.
--
-- Adds `game_scheduling_opponents.reminder_sent_at timestamptz` — stamped when
-- the admin "Send reminders" action emails an opponent that still has an
-- unscheduled home/away game. Kept separate from `email_sent_at` (the first
-- invite send) so the dashboard can show when a reminder last went out without
-- losing the original-invite timestamp.
--
-- Idempotent. Schema-only (the column sits under the existing
-- game_scheduling_opponents endpoint-gated access — no setup-permissions change).

BEGIN;

ALTER TABLE game_scheduling_opponents
  ADD COLUMN IF NOT EXISTS reminder_sent_at timestamptz;

COMMENT ON COLUMN game_scheduling_opponents.reminder_sent_at IS
  'When a scheduling reminder was last emailed to this opponent (NULL = never reminded).';

-- Directus field metadata so the column is exposed via the items API.
INSERT INTO directus_fields (collection, field, special, interface, display, sort, hidden, note)
SELECT 'game_scheduling_opponents', 'reminder_sent_at', 'cast-timestamp', 'datetime', 'datetime', 60, false,
  'When a scheduling reminder was last emailed to this opponent.'
WHERE NOT EXISTS (
  SELECT 1 FROM directus_fields WHERE collection = 'game_scheduling_opponents' AND field = 'reminder_sent_at'
);

COMMIT;
