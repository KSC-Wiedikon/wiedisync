-- 290-bb-group-club-exceptions.sql
--
-- Hand-verified club links the exact-name rule cannot make.
--
-- WHY
-- ---
-- Migration 287 links an opponent row to `basketplan_clubs` only on an EXACT club-name match,
-- and refuses to guess: a wrong link mis-addresses a scheduling portal, which is worse than a
-- NULL. Three rows came out unlinked, and they are three different problems:
--
--   BC Weinland HU16          → the Gruppeneinteilung row carries NO Klub at all, so there was
--                               nothing to match. The club IS in the registry, spelled
--                               "Weinland BC" (id 61 on both instances). ← fixed here
--   BS Arth-Goldau H4         → no such club anywhere in basketplan_clubs.
--   TV Hünenberg Rockets MU12 → likewise.
--
-- The latter two are NOT fixed and must not be invented: with no club row, no portal can be
-- minted for them either, so the pairing has nothing to point at. If they are ever scraped
-- into the registry, re-running `node directus/scripts/gen-287-seed.mjs` picks them up only if
-- the workbook also gains a Klub for them — otherwise add them below.
--
-- ⚠ This is an ALLOW-LIST keyed on the exact team name, not a fuzzy matcher. Every row is a
-- human decision that survives a re-seed (287's UPDATE only fills, it never clears a link it
-- did not make). Keep it tiny and justified; if it grows, fix the source data instead.
--
-- ⚠ Own-club rows stay excluded. KSC Wiedikon DU18 B and DU10 are ours and carry no
-- kscw_team (no `teams` row / no active team), so they LOOK unlinked here — they must never
-- gain a bp_club, or the club would appear as its own opponent (287 asserts this).
--
-- Data-only, idempotent.

BEGIN;

UPDATE basketball_group_teams gt
SET bp_club = c.id
FROM basketplan_clubs c, (VALUES
  ('BC Weinland HU16', 'Weinland BC')
) AS v(team_name, club_name)
WHERE gt.team_name = v.team_name
  AND c.name = v.club_name
  AND c.is_own_club IS NOT TRUE
  AND gt.kscw_team IS NULL
  AND gt.bp_club IS DISTINCT FROM c.id;

DO $$
DECLARE n_linked int; n_left int;
BEGIN
  SELECT count(*) INTO n_linked
    FROM basketball_group_teams WHERE team_name = 'BC Weinland HU16' AND bp_club IS NOT NULL;
  IF n_linked <> 1 THEN
    RAISE EXCEPTION 'migration 290: expected BC Weinland HU16 to be linked, got % row(s) — is "Weinland BC" still in basketplan_clubs?', n_linked;
  END IF;

  SELECT count(*) INTO n_left
    FROM basketball_group_teams
    WHERE bp_club IS NULL AND kscw_team IS NULL AND team_name NOT ILIKE '%wiedikon%';
  RAISE NOTICE 'migration 290: BC Weinland HU16 linked; % opponent row(s) still without a club (no such club in basketplan_clubs)', n_left;
END $$;

COMMIT;
