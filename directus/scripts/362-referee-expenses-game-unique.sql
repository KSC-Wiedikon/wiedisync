-- 362 — one referee_expenses row per game.
--
-- The referee-fee editor (RefereeExpenseSection in GameDetailModal) reads the
-- game's row with `filter: { game }` + `limit 1` and then UPDATEs it, so a
-- second row for the same game would be invisible to the editor and yet still
-- count in every read-time derivation the finance module builds on this table
-- (member view, team page, season-end payout run). Nothing has ever enforced
-- the "one per game" shape; this index does.
--
-- Prod holds 0 rows today (2026-09-15), so the guard below is for the future
-- deployer, not for a known duplicate: if two rows share a game the migration
-- refuses rather than picking one, and the treasurer merges them by hand.
--
-- Partial (`game IS NOT NULL`): migration 254 nulls `game` when the game is
-- deleted, and orphaned fee rows must not collide with each other.
--
-- Schema-only + idempotent (per CLAUDE.md hard rule). No permission rows.

BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM referee_expenses
    WHERE game IS NOT NULL
    GROUP BY game HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'referee_expenses: duplicate rows per game — merge by hand before 362';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS referee_expenses_game_uidx
  ON referee_expenses (game) WHERE game IS NOT NULL;

COMMIT;
