-- Migration 440: car pooling is on by default for every game
--
-- Owner, 02.11.2026: "by default each game has carpool activated". Migration 378
-- made `games.carpool_enabled` default OFF so nothing showed until a coach asked
-- for it; in practice the switch was rarely flipped and members never saw the
-- board. Games now start with it ON — the coach/TR can still switch it off per
-- game in the game modal. Trainings and events keep their default (off): they
-- are set up by hand in a form that carries the switch.
--
-- New rows: the syncs (sv-sync, bp-sync, bp-tournaments) and the Spielplanung
-- insert games without naming the column, so the column default is enough.
--
-- Existing rows: upcoming scheduled games are switched on, EXCEPT a game someone
-- switched off on purpose — the settings endpoint logs every switch in
-- `user_logs` (carpools.js, PATCH /carpools/game/:id/settings), and a coach's
-- items-API edit leaves a `directus_revisions` delta. Past and cancelled games
-- are left alone. Idempotent: a re-run finds nothing left to switch.

ALTER TABLE games ALTER COLUMN carpool_enabled SET DEFAULT true;

COMMENT ON COLUMN games.carpool_enabled IS
  'Car pooling board shown on this game (offer rides, Going / Return). Default ON since migration 440; the coach/TR can switch it off per game. Rides live in carpools (migration 378).';

UPDATE games g
   SET carpool_enabled = true
 WHERE g.carpool_enabled = false
   AND g.status = 'scheduled'
   AND g.date >= (now() AT TIME ZONE 'Europe/Zurich')::date
   AND NOT EXISTS (
         SELECT 1 FROM user_logs l
          WHERE l.collection_name = 'games'
            AND l.record_id = g.id::text
            AND l.data::jsonb ? 'carpool_enabled'
       )
   AND NOT EXISTS (
         SELECT 1 FROM directus_revisions r
          WHERE r.collection = 'games'
            AND r.item = g.id::text
            AND r.delta::jsonb ? 'carpool_enabled'
       );
