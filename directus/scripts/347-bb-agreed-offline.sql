-- 347-bb-agreed-offline.sql
--
-- Record a basketball game the opponent agreed to OFF the portal.
--
-- WHY
-- ---
-- `basketball_slot_plan.proposal_status` has six values and only ONE way to reach
-- 'accepted': the opponent club answers through its token link (or a planner accepts a
-- date the club picked itself, `/bb/club-proposals`). `/bb/offer` moves draft → offered
-- and stops there.
--
-- But the deliverable of the whole module is the WSR Art. 18 escape — "games agreed
-- before the Spielplansitzung need no attendance there" — and most of those agreements
-- happen on the phone. A planner who rings the opponent, agrees the date, and writes it
-- down has no way to say so: the game sits at 'draft' forever, and the panel that is
-- supposed to answer "what still needs the Spielplansitzung?" counts it as outstanding.
--
-- WHAT
-- ----
-- Two columns, so an agreement recorded by us is never confusable with one the club
-- gave through its own link:
--
--   agreed_offline          — the discriminator. Set only by /bb/mark-agreed.
--   agreed_offline_by_name  — the KSCW planner who recorded it (CLAUDE.md → Audit
--                             logging option (b); writeUserLog covers option (a)).
--
-- ⚠ THE TWO NAME COLUMNS MEAN DIFFERENT THINGS AND BOTH ARE POPULATED.
--   `responded_by_name`     = who at the OPPONENT agreed (the planner types it; the
--                             endpoint requires it — an agreement with nobody is a
--                             note-to-self, not an agreement).
--   `agreed_offline_by_name`= who at KSCW recorded it.
-- Reusing responded_by_name alone would put a KSCW name in the column the portal fills
-- with the club's own responder, and the audit trail would then claim the club answered.
--
-- ⚠ The CHECK is deliberate: `agreed_offline` is only meaningful on an accepted row.
-- Any future flow that moves such a row off 'accepted' MUST clear the flag in the same
-- statement — otherwise the row would keep claiming an agreement it no longer holds.
-- The constraint is what forces that to be a conscious decision instead of a silent one.
--
-- ⚠ No new permission rows (CLAUDE.md rule 1). setup-permissions.mjs already grants
-- TERMINPLANUNG_POLICY full CRUD on basketball_slot_plan with fields '*', so both
-- columns ride the existing grant exactly as migration 280's offer columns did.
--
-- ⚠⚠ Directus caches the schema at boot and a raw-SQL `directus_fields` insert does NOT
-- bust that cache (2026-08-22, `events.open_roster` read back as `type: alias` until the
-- container was restarted). Restart after applying:
--   npm run db:migrate:dev && ssh hetzner "sudo docker restart directus-kscw-dev"
--
-- Schema-only + idempotent per the CLAUDE.md migration policy.

BEGIN;

ALTER TABLE basketball_slot_plan
  ADD COLUMN IF NOT EXISTS agreed_offline boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS agreed_offline_by_name varchar(255);

COMMENT ON COLUMN basketball_slot_plan.agreed_offline IS
  'TRUE when a KSCW planner recorded this agreement outside the opponent portal (phone/email). Distinguishes it from an answer the club gave through its own link, which leaves this false. Written only by POST /kscw/admin/terminplanung/bb/mark-agreed.';
COMMENT ON COLUMN basketball_slot_plan.agreed_offline_by_name IS
  'The KSCW planner who recorded an offline agreement. NOT the opponent — that is responded_by_name, which mark-agreed also requires.';

-- Only an accepted row may claim an offline agreement. See the header: this is what
-- forces a future status change to clear the flag rather than leave it lying.
ALTER TABLE basketball_slot_plan
  DROP CONSTRAINT IF EXISTS basketball_slot_plan_agreed_offline_check;
ALTER TABLE basketball_slot_plan
  ADD CONSTRAINT basketball_slot_plan_agreed_offline_check
  CHECK (agreed_offline = false OR proposal_status = 'accepted');

-- Register the fields so the items API (the offers panel reads via useCollection with
-- fields ['*']) and the Directus admin can see them.
-- ⚠ NULL in a VALUES list types as text and `options` is json — cast it.
INSERT INTO directus_fields (collection, field, special, interface, options, readonly, hidden, sort, width, note)
SELECT 'basketball_slot_plan', 'agreed_offline', 'cast-boolean', 'boolean', NULL::json, true, false, 19, 'half',
       'Agreed off the portal (phone/email) and recorded by a KSCW planner, rather than answered by the club through its link.'
WHERE NOT EXISTS (
  SELECT 1 FROM directus_fields WHERE collection = 'basketball_slot_plan' AND field = 'agreed_offline'
);

INSERT INTO directus_fields (collection, field, special, interface, options, readonly, hidden, sort, width, note)
SELECT 'basketball_slot_plan', 'agreed_offline_by_name', NULL, 'input', NULL::json, true, false, 20, 'half',
       'The KSCW planner who recorded the offline agreement. The opponent-side name is responded_by_name.'
WHERE NOT EXISTS (
  SELECT 1 FROM directus_fields WHERE collection = 'basketball_slot_plan' AND field = 'agreed_offline_by_name'
);

COMMIT;
