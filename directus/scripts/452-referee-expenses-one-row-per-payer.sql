-- 452 — referee_expenses: one row per payer per game, no longer one per game.
--
-- A referee fee can be shared: two or more people each lay out part of it at
-- the game. Every read-time derivation already works per row (the member's own
-- fees, the team totals, and the season-end run, which sums a member's rows into
-- one payout), so a share is simply a row, with that person's amount.
--
-- 362 made `game` unique because the editor only ever read one row, and a second
-- one would have been invisible yet still paid out. RefereeExpenseSection now
-- reads and writes all of a game's rows, so that reason is gone. What stays
-- forbidden is the same person twice on one game, which is what these two indexes
-- enforce: by member, or by the free-text name when there is no member.
--
-- Two coaches recording the same game no longer collide here. The editor checks
-- the stored rows again right before it writes, and stops if they have changed.
--
-- Schema-only + idempotent (per CLAUDE.md hard rule). No permission rows: leaders
-- and sport admins already hold create, update and delete on unpaid rows.

BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS referee_expenses_game_member_uidx
  ON referee_expenses (game, paid_by_member)
  WHERE game IS NOT NULL AND paid_by_member IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS referee_expenses_game_other_uidx
  ON referee_expenses (game, lower(btrim(paid_by_other)))
  WHERE game IS NOT NULL AND paid_by_member IS NULL;

DROP INDEX IF EXISTS referee_expenses_game_uidx;

COMMIT;
