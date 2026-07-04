-- Migration 171: polls — per-poll "results visible to everyone" toggle.
--
-- Poll results were manager-only at the data layer (members read only their own
-- poll_votes row since the 2026-07-02 audit #5/#14), yet PollCard rendered
-- result bars for members computed from that single own row — a misleading
-- "100% / 1 vote" tally. Feature request 2026-07-04: let the creator decide at
-- creation time whether everyone may see the results.
--
--   results_visible = true  → any member of the poll's team (team polls) or of
--                             its conversation (chat polls) may read the
--                             aggregate counts via GET /kscw/polls/:id/results.
--                             Voter identity stays manager-only (and hidden
--                             entirely for anonymous polls), exactly as before.
--   results_visible = false → status quo: managers + the poll creator only.
--
-- Default FALSE so existing polls keep their current manager-only behaviour;
-- the frontend defaults the checkbox to ON for newly created polls.

BEGIN;

ALTER TABLE polls ADD COLUMN IF NOT EXISTS results_visible boolean NOT NULL DEFAULT false;

-- Register the field so the items API + admin data model expose it.
INSERT INTO directus_fields (collection, field, special, interface, display, note, sort, width)
SELECT 'polls', 'results_visible', 'cast-boolean', 'boolean', 'boolean',
       'Everyone (not just team managers) may see the aggregate results. Identity-free — voter names stay manager-only.', 99, 'half'
WHERE NOT EXISTS (
  SELECT 1 FROM directus_fields WHERE collection = 'polls' AND field = 'results_visible'
);

COMMIT;
