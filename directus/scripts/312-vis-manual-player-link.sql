-- Migration 312: let staff hand-link a member to a VIS player number.
--
-- WHY A SEPARATE COLUMN, and not just "edit vis_player_no".
-- `vis-player-check` rewrites `in_vis` / `vis_player_no` for the WHOLE cohort on
-- every run (weekly cron + the "Check VIS now" button), so a value typed into
-- `vis_player_no` survives until the next sweep and then silently vanishes. The
-- override therefore has to live in a column the sweep READS and never writes.
--
--   vis_player_no_manual — set by a human on /admin/transfers. The sweep never
--                          touches it.
--   vis_manual_vis_name  — what VIS itself calls that player number, refreshed
--                          by the sweep. NULL after a check = the number is not
--                          in that federation's index.
--
-- THE VERIFICATION IS THE POINT. `in_vis` is read as eligibility evidence — a
-- transfer can only be requested for a player already in VIS — so a typo'd
-- number that asserted presence would be worse than no number at all. Hence the
-- contract, implemented in BOTH mirrors of the checker:
--
--   • a manual number found in the member's federation roster WINS over name
--     matching → in_vis = true, vis_player_no = the manual number, and
--     vis_manual_vis_name records VIS's own spelling so the operator can eyeball
--     that they linked the right person;
--   • a manual number NOT found there does NOT assert presence. `in_vis` falls
--     back to whatever name matching concluded (normally false) and the page
--     shows the number with a warning. The wrong link is visible, never silently
--     authoritative.
--
-- The name that motivated it: member 34 is `Christiane` / `Clüver`, VIS #243602
-- in the GER index is `Dorothea Christiane` / `Clüver`. The 2026-08-13 subset
-- step now matches her automatically, but the class of mismatch it cannot reach
-- (a married name, a transliteration, a genuinely different spelling) is exactly
-- what this column is for.
--
-- Both columns are STAFF-ONLY: they join MEMBER_STAFF_ONLY_FIELDS in
-- setup-permissions.mjs, which keeps them out of member-visible read and
-- own-profile write. A member who could set their own `vis_player_no_manual`
-- could assert their own VIS presence — the very fact the club exists to verify.
--
-- Schema-only + idempotent.

BEGIN;

ALTER TABLE members
  ADD COLUMN IF NOT EXISTS vis_player_no_manual integer,
  ADD COLUMN IF NOT EXISTS vis_manual_vis_name  text;

COMMENT ON COLUMN members.vis_player_no_manual IS
  'Hand-set FIVB VIS player number (staff, /admin/transfers). Wins over name matching when the sweep can confirm it in the federation roster; NEVER written by vis-player-check. Empty = no override.';
COMMENT ON COLUMN members.vis_manual_vis_name IS
  'VIS''s own "FirstName LastName" for vis_player_no_manual, refreshed by vis-player-check. NULL after a check = that number is not in the member''s federation index — the link is unconfirmed and does not assert presence.';

INSERT INTO directus_fields (collection, field, interface, readonly, hidden, sort, width, note)
SELECT 'members', 'vis_player_no_manual', 'input', false, false, 209, 'half',
  'Hand-set VIS player number. Overrides name matching once the check confirms it exists in the federation index.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection='members' AND field='vis_player_no_manual');

INSERT INTO directus_fields (collection, field, interface, readonly, hidden, sort, width, note)
SELECT 'members', 'vis_manual_vis_name', 'input', true, false, 210, 'half',
  'How VIS spells the manually linked player. Empty after a check means the number was not found.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection='members' AND field='vis_manual_vis_name');

COMMIT;
