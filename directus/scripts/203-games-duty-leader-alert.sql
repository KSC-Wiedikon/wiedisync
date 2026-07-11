-- Migration 203: "contact team leaders" emergency bookkeeping on games.
--
-- The mirror image of migration 202 (duty_late_json). Where duty_late_json
-- records a COACH flagging the duty official as late, this records the DUTY
-- OFFICIAL hitting the "Emergency: contact team leaders" button in the 60'
-- window before kickoff — which reveals the playing team's Coach/TR contact to
-- them and emails the club admin + sport TK once.
--
-- One entry per official who pressed it, { memberId: { at, by_name } }. Carries
-- NO contact info (safe to expose), written/read only by the
-- duty-leader-contact endpoint (raw knex, admin context) — no permission rows
-- needed. Registered in directus_fields so the items API / dashboards can see it.
--
-- Schema-only + idempotent.

BEGIN;

ALTER TABLE games ADD COLUMN IF NOT EXISTS duty_leader_alert_json jsonb;

COMMENT ON COLUMN games.duty_leader_alert_json IS
  'Emergency "contact team leaders" reports { memberId: { at, by_name } } (migration 203). Written by the duty-leader-contact endpoint; no contact info stored.';

-- ── Directus admin metadata ────────────────────────────────────────────
INSERT INTO directus_fields (collection, field, special, interface, options, readonly, hidden, sort, width, note)
SELECT 'games', 'duty_leader_alert_json', 'cast-json', 'input-code', '{"language":"json"}'::json, true, true, 201, 'full',
  'Emergency "contact team leaders" reports { memberId: { at, by_name } }. Written by the duty-leader-contact endpoint.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'games' AND field = 'duty_leader_alert_json');

COMMIT;
