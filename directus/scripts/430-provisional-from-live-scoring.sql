-- 430 — a finished live score becomes the game's provisional result.
--
-- WHY
-- ---
-- 27.10.2026, H1 at TV Muttenz (cup): the match was scored live on a phone to 3:0
-- and ended with "End match", yet the game card and the game modal showed no score
-- at all — the provisional result (migration 395) only ever came from a member's
-- result entry or from VolleyManager, and nobody enters a result at 23:00 after a
-- cup game. The live row already holds the sets.
--
-- WHAT
-- ----
-- 1. `games.provisional_source` may also be 'live': written by live-scoring.js when
--    a phone (or the hall board's game row) publishes a FINISHED, valid result.
--    Priority, highest first: official (status 'completed') > confirmed >
--    vm_official > own > live > opponent. So a live score replaces nothing a member
--    entered, VM's official result replaces it, the opponent's report does not.
--    Reopening the match takes a 'live' result back.
-- 2. Backfill: every finished volleyball live row of the last 14 days whose game is
--    still 'scheduled' with no provisional result — both copies of a derby (the live
--    row sits on the home copy, see live-scoring.js liveGameId). Only decided matches
--    (3 sets won); a match ended early stays without a provisional score, as it would
--    going forward.
--
-- Idempotent.

BEGIN;

ALTER TABLE games DROP CONSTRAINT IF EXISTS games_provisional_source_check;
ALTER TABLE games
  ADD CONSTRAINT games_provisional_source_check
  CHECK (provisional_source IN ('own', 'opponent', 'confirmed', 'vm_official', 'live'));

WITH live AS (
  SELECT ls.game_id AS live_id, ls.sets_won_a, ls.sets_won_b,
    (SELECT json_agg(json_build_object('home', (r->>'a')::int, 'away', (r->>'b')::int) ORDER BY ord)
       FROM jsonb_array_elements(ls.set_results) WITH ORDINALITY AS t(r, ord)) AS sets
  FROM live_scores ls
  WHERE ls.status = 'final'
    AND ls.game_id IS NOT NULL
    AND COALESCE(ls.sport, 'volleyball') = 'volleyball'
    AND (ls.sets_won_a = 3 OR ls.sets_won_b = 3)
    AND ls.sets_won_a + ls.sets_won_b = jsonb_array_length(ls.set_results)
)
UPDATE games g
SET provisional_sets_json = l.sets,
    provisional_home_score = l.sets_won_a,
    provisional_away_score = l.sets_won_b,
    provisional_source = 'live',
    provisional_by_name = NULL,
    provisional_at = now()
FROM live l
JOIN games h ON h.id = l.live_id
WHERE (g.id = h.id OR (h.game_id IS NOT NULL AND g.game_id = h.game_id))
  AND g.status = 'scheduled'
  AND g.provisional_source IS NULL
  AND g.date >= current_date - 14;

COMMIT;
