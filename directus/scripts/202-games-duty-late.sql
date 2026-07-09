-- Migration 202: "duty is late" alarm bookkeeping on games.
--
-- A coach / team-responsible of the PLAYING team can flag an assigned duty
-- official (scorer / Täfeler / combined / referee / BB officials) as late once
-- they're inside the role's arrival window. Flagging emails the official + the
-- sport's TK (vb_admin / bb_admin) + the club admin ONCE, and reveals the
-- official's contact to the coach until the game starts (+ grace).
--
-- This column is the idempotency + persistence record: one entry per flagged
-- role, { role: { at, by_name } }. It carries NO contact info (safe to expose),
-- and is only ever written/read by the duty-late endpoint (raw knex, admin
-- context) — so no permission rows are needed. Registered in directus_fields
-- so the items API / dashboards can see it.
--
-- Schema-only + idempotent.

BEGIN;

ALTER TABLE games ADD COLUMN IF NOT EXISTS duty_late_json jsonb;

COMMENT ON COLUMN games.duty_late_json IS
  'Per-role late-arrival reports { role: { at, by_name } } (migration 202). Written by the duty-late endpoint; no contact info stored.';

-- ── Directus admin metadata ────────────────────────────────────────────
INSERT INTO directus_fields (collection, field, special, interface, options, readonly, hidden, sort, width, note)
SELECT 'games', 'duty_late_json', 'cast-json', 'input-code', '{"language":"json"}'::json, true, true, 200, 'full',
  'Per-role late-arrival reports { role: { at, by_name } }. Written by the duty-late endpoint.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'games' AND field = 'duty_late_json');

COMMIT;
