-- Migration 196: scorer-duty manual credit per team.
--
-- Adds teams.duty_credit — an integer "credit" (duties this team is excused
-- from) that the scorer-assignment engine subtracts from a team's desirability
-- (-10 points per credit, the same currency as the fair-rotation penalty). It
-- stacks on top of the AUTOMATIC referee credit (min(referee_vb licences, 2)
-- duties) computed at runtime from member licences.
--
-- Requested by Thamy (2026-07-08): shift scorer/scoreboard load off the teams
-- that already serve the club (e.g. H1/H3 supply referees) toward the teams that
-- don't (D2/D3/D4). The auto referee credit lands most of it; this column is the
-- manual fine-tuning knob, editable directly in the Team summary on the
-- scorer-assignment page (admin-only route → no items-API grant needed; admins
-- bypass field permissions).
--
-- Schema-only + idempotent (repo policy #2). Permissions live in
-- setup-permissions.mjs — the assign page is AdminRoute-gated, so no non-admin
-- grant is required for the PATCH.

BEGIN;

ALTER TABLE teams ADD COLUMN IF NOT EXISTS duty_credit integer NOT NULL DEFAULT 0;
COMMENT ON COLUMN teams.duty_credit IS
  'Scorer-duty manual credit: duties this team is excused from (higher = fewer scorer/scoreboard assignments). Stacks on top of the automatic referee credit. Edited on the scorer-assignment page.';

INSERT INTO directus_fields (collection, field, special, interface, options, sort, hidden, note)
SELECT 'teams', 'duty_credit', NULL, 'input',
  '{"min":0,"step":1}', 60, false,
  'Scorer-duty credit: duties this team is excused from (higher = fewer duties). Stacks on the automatic referee credit.'
WHERE NOT EXISTS (
  SELECT 1 FROM directus_fields WHERE collection = 'teams' AND field = 'duty_credit'
);

COMMIT;
