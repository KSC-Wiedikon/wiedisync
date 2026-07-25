-- Migration 240: record whether a member exists in the FIVB VIS player index.
--
-- WHY THIS IS THE QUESTION THAT MATTERS. A transfer can only be requested for a
-- player who is ALREADY in VIS. If they are not, the club has to ask the
-- federation of origin to enter them first — a different action, addressed to a
-- different party, and nothing in wiedisync could tell the two apart.
--
-- Only meaningful for members whose federation of origin is NOT Switzerland: a
-- CH origin means no international transfer applies at all, so their VIS presence
-- is irrelevant and is deliberately left unchecked rather than filled with a
-- misleading `false`.
--
-- in_vis:
--   NULL  — not checked (the default, and the honest state for the 483 CH-origin
--           members the checker deliberately skips)
--   true  — found in the origin federation's VIS player roster
--   false — not found; the federation of origin must add them before a transfer
--           can be requested
--
-- ⚠ `false` IS EVIDENCE, NOT PROOF, and the distinction matters twice over.
-- Matching is by normalised name (with a first-name-prefix fallback, since VIS
-- stores full legal given names), so a married name or a spelling variant reads
-- as not-found. AND, because federation_of_origin was seeded from nationality for
-- most members (migration 239), a `false` usually means the SEED was wrong — the
-- person was never licensed in their passport country — rather than that a
-- federation needs to add them. Read it as "no evidence they were ever licensed
-- there", which is genuinely useful: it is the cheapest way to clear a false
-- positive off the transfer worklist.
--
-- vis_player_no is kept when found: it is the key for a deep link into VIS and
-- the only stable identifier VIS exposes for a person.
--
-- Schema-only + idempotent.

BEGIN;

ALTER TABLE members
  ADD COLUMN IF NOT EXISTS in_vis            boolean,
  ADD COLUMN IF NOT EXISTS in_vis_checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS vis_player_no     integer;

COMMENT ON COLUMN members.in_vis IS
  'Found in the VIS player roster of their federation of origin. NULL = not checked (CH-origin members are skipped). false = no evidence they were ever licensed there — treat as a lead, not a fact: name matching is fuzzy and federation_of_origin is often a seed from nationality.';
COMMENT ON COLUMN members.vis_player_no IS
  'FIVB VIS player number, captured when a match is found. The key for a deep link into the VIS transfers app.';

CREATE INDEX IF NOT EXISTS members_in_vis_idx ON members (in_vis) WHERE in_vis IS NOT NULL;

INSERT INTO directus_fields (collection, field, interface, special, readonly, hidden, sort, width, note)
SELECT 'members', 'in_vis', 'boolean', 'cast-boolean', true, false, 206, 'half',
  'Present in the VIS player index of their federation of origin. Set by vis-player-check.mjs; empty = not checked.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection='members' AND field='in_vis');

INSERT INTO directus_fields (collection, field, interface, readonly, hidden, sort, width, note)
SELECT 'members', 'in_vis_checked_at', 'datetime', true, false, 207, 'half', 'When the VIS presence check last ran for this member.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection='members' AND field='in_vis_checked_at');

INSERT INTO directus_fields (collection, field, interface, readonly, hidden, sort, width, note)
SELECT 'members', 'vis_player_no', 'input', true, false, 208, 'half', 'FIVB VIS player number (deep-link key).'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection='members' AND field='vis_player_no');

COMMIT;
