-- Migration 234: track the international-transfer state per member.
--
-- `federation_of_origin` (migration 223) records WHERE a member was first
-- licensed. It does not record what the club then had to DO about it: a member
-- arriving from FIPAV needs a transfer certificate requested, chased and
-- received, and today that lives in somebody's head or inbox.
--
-- Deliberately separate from federation_of_origin, which is a fact about the
-- member and is member-editable. Transfer state is a fact about CLUB ADMIN work
-- on that member, is staff-only, and changes many times over one unchanging
-- federation_of_origin.
--
-- transfer_status:
--   NULL         — not looked at yet. The default, and the honest one: the club
--                  has 111 members with a non-Swiss nationality who have never
--                  been asked, and pretending those are "pending" would invent a
--                  workflow nobody started.
--   'pending'    — a transfer is needed and is being chased.
--   'done'       — certificate received / the player is cleared to play.
--   'not_needed' — looked at, and no transfer applies (e.g. only ever played a
--                  recreational body like CSI/UISP, which are not FIVB/FIBA
--                  members, so there is no licence to transfer).
--
-- ⚠ 'not_needed' is NOT the same as federation_of_origin = 'NONE'. NONE is the
-- member's own answer about their history; not_needed is the club's conclusion
-- about the paperwork. A member can answer "Italy" honestly and still be
-- not_needed because the Italian licence was CSI, not FIPAV.
--
-- Actor capture: these columns are written through the Directus items API, which
-- records the acting user in directus_activity automatically. transfer_done_by_name
-- additionally persists WHO cleared it on the row itself, because "who signed this
-- off" is a domain question the audit log answers only awkwardly (per CLAUDE.md's
-- actor-capture rule).
--
-- Schema-only + idempotent.

BEGIN;

ALTER TABLE members
  ADD COLUMN IF NOT EXISTS transfer_status       varchar(16),
  ADD COLUMN IF NOT EXISTS transfer_done_at      timestamptz,
  ADD COLUMN IF NOT EXISTS transfer_done_by_name text,
  ADD COLUMN IF NOT EXISTS transfer_note         text;

COMMENT ON COLUMN members.transfer_status IS
  'International-transfer workflow state: NULL = not reviewed, ''pending'' = being chased, ''done'' = cleared, ''not_needed'' = reviewed, no transfer applies. Distinct from federation_of_origin = ''NONE'', which is the member''s own answer rather than the club''s conclusion.';
COMMENT ON COLUMN members.transfer_done_at IS
  'When transfer_status last became ''done''. Cleared when the status moves away from done, so it can never describe a state the row is no longer in.';
COMMENT ON COLUMN members.transfer_done_by_name IS
  'Display name of the staff member who marked the transfer done — the domain-level "who signed this off", alongside the automatic directus_activity trail.';

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'members_transfer_status_chk') THEN
    ALTER TABLE members ADD CONSTRAINT members_transfer_status_chk
      CHECK (transfer_status IS NULL OR transfer_status IN ('pending', 'done', 'not_needed'));
  END IF;
END $do$;

-- Partial index: the Transfers page only ever asks for rows that HAVE a state,
-- and that will stay a small minority of members.
CREATE INDEX IF NOT EXISTS members_transfer_status_idx
  ON members (transfer_status) WHERE transfer_status IS NOT NULL;

INSERT INTO directus_fields (collection, field, interface, options, readonly, hidden, sort, width, note)
SELECT 'members', 'transfer_status', 'select-dropdown',
  '{"choices":[{"text":"Pending","value":"pending"},{"text":"Done","value":"done"},{"text":"Not needed","value":"not_needed"}]}'::json,
  false, false, 202, 'half',
  'International-transfer state. Empty = not reviewed yet.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'members' AND field = 'transfer_status');

INSERT INTO directus_fields (collection, field, interface, readonly, hidden, sort, width, note)
SELECT 'members', 'transfer_done_at', 'datetime', true, false, 203, 'half',
  'Set automatically when the transfer is marked done.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'members' AND field = 'transfer_done_at');

INSERT INTO directus_fields (collection, field, interface, readonly, hidden, sort, width, note)
SELECT 'members', 'transfer_done_by_name', 'input', true, false, 204, 'half',
  'Who marked the transfer done.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'members' AND field = 'transfer_done_by_name');

INSERT INTO directus_fields (collection, field, interface, readonly, hidden, sort, width, note)
SELECT 'members', 'transfer_note', 'input-multiline', false, false, 205, 'full',
  'Free-text note on the transfer (reference numbers, who was contacted, blockers).'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'members' AND field = 'transfer_note');

COMMIT;

-- After applying: run `npm run db:setup-perms:dev|prod` — the four columns join
-- the staff-readable/writable member field lists.
