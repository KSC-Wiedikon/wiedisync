-- Migration 441: car pooling on by default only for AWAY games, from a week before
--
-- Owner, 02.11.2026, the evening after 440: with every game switched on, the Home
-- "Car pooling" card listed every home game of the season too. New rule: an away
-- game gets its board automatically 7 days before it is played; home games stay
-- off unless the coach switches them on. The coach/TR can still switch any game
-- on or off by hand at any time.
--
--   * Column default back to OFF (as in 378).
--   * carpool_auto_enable_away_games() switches on scheduled away games dated
--     today … today + 7 (Europe/Zurich) that are still off, EXCEPT a game someone
--     switched on or off by hand — every hand switch leaves a trace: the settings
--     endpoint logs it in `user_logs` (carpools.js), an items-API edit leaves a
--     `directus_revisions` delta. Returns how many games it switched on.
--     kscw-hooks calls it every hour (games synced in later are picked up too).
--   * Undo what 440 switched on outside the new rule: upcoming scheduled games
--     that are home games or more than 7 days out go back to off — unless a hand
--     switch touched them or the game already has rides (nobody loses sight of
--     the car they are in).
-- Idempotent: re-running changes nothing.

ALTER TABLE games ALTER COLUMN carpool_enabled SET DEFAULT false;

COMMENT ON COLUMN games.carpool_enabled IS
  'Car pooling board shown on this game (offer rides, Going / Return). Default off; away games are switched on automatically 7 days before (carpool_auto_enable_away_games(), migration 441); the coach/TR can switch any game on or off. Rides live in carpools (migration 378).';

-- True when someone switched this game's car pooling by hand (on or off).
CREATE OR REPLACE FUNCTION carpool_switched_by_hand(p_game integer)
RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
           SELECT 1 FROM user_logs l
            WHERE l.collection_name = 'games'
              AND l.record_id = p_game::text
              AND l.data::jsonb ? 'carpool_enabled'
         )
      OR EXISTS (
           SELECT 1 FROM directus_revisions r
            WHERE r.collection = 'games'
              AND r.item = p_game::text
              AND r.delta::jsonb ? 'carpool_enabled'
         )
$$;

CREATE OR REPLACE FUNCTION carpool_auto_enable_away_games()
RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
  today date := (now() AT TIME ZONE 'Europe/Zurich')::date;
  n integer;
BEGIN
  UPDATE games g
     SET carpool_enabled = true
   WHERE g.carpool_enabled = false
     AND g.status = 'scheduled'
     AND g.type = 'away'
     AND g.date BETWEEN today AND today + 7
     AND NOT carpool_switched_by_hand(g.id);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END
$$;

UPDATE games g
   SET carpool_enabled = false
 WHERE g.carpool_enabled = true
   AND g.status = 'scheduled'
   AND g.date >= (now() AT TIME ZONE 'Europe/Zurich')::date
   AND (g.type IS DISTINCT FROM 'away' OR g.date > (now() AT TIME ZONE 'Europe/Zurich')::date + 7)
   AND NOT carpool_switched_by_hand(g.id)
   AND NOT EXISTS (SELECT 1 FROM carpools c WHERE c.game = g.id);

SELECT carpool_auto_enable_away_games();
