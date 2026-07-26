-- Migration 243: the VIS presence check now covers CH-origin members too.
--
-- NO STRUCTURAL CHANGE — this corrects a column COMMENT that has become false.
--
-- Migration 240 introduced `members.in_vis` on the premise that a Swiss
-- federation of origin makes VIS presence irrelevant, and documented NULL as
-- "not checked (CH-origin members are skipped)". That premise was too narrow:
-- Swiss Volley is a federation in VIS with its own player index (vis_no 189 /
-- SUI in `vis_federations`) exactly like the others, so the same question IS
-- answerable for our Swiss-origin members — and the Transfers page now groups
-- them under Swiss Volley rather than hiding them in a tally.
--
-- What has NOT changed is what `in_vis` means for them: for a CH-origin member a
-- `false` blocks nothing, because no international transfer applies to them in
-- the first place. It reads "no player of that name in Swiss Volley's index",
-- which is a lead worth seeing, never a verdict — the match is by normalised
-- name. The UI says exactly that (`trSwissInVisNoHint`).
--
-- `vis-player-check.mjs` also stopped checking GUESTS in the same change (a
-- member whose every `member_teams` row has `guest_level > 0` holds no club
-- licence, so there is no eligibility to establish). That is a query filter in
-- the script, not a schema fact, so it is recorded here only for context.
--
-- Comment-only + idempotent (COMMENT ON replaces).

BEGIN;

COMMENT ON COLUMN members.in_vis IS
  'Found in the VIS player roster of their federation of origin — including CH, checked against Swiss Volley''s own index (VIS fed 189/SUI). NULL = not checked yet (guests and federation_of_origin = NONE are never checked). false = no evidence they were licensed there — treat as a lead, not a fact: name matching is fuzzy and federation_of_origin is often a seed from nationality. For a CH-origin member a false blocks nothing, since no international transfer applies to them.';

COMMIT;

SELECT 'in_vis true' AS metric, count(*)::text AS value FROM members WHERE in_vis
UNION ALL SELECT 'in_vis false', count(*)::text FROM members WHERE in_vis = false
UNION ALL SELECT 'unchecked', count(*)::text FROM members WHERE in_vis IS NULL
UNION ALL SELECT 'ch_origin_total', count(*)::text FROM members WHERE federation_of_origin = 'CH';
