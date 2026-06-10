-- 105: Multi-game per opponent — key bookings per SVRZ fixture.
--
-- Junior leagues are a triple round-robin: a pairing is played 3× (2 home +
-- 1 away, or 1 home + 2 away). Bookings were keyed (opponent, type) — one home
-- pick + one away proposal per opponent — so the 2nd game of a pairing could
-- not be scheduled through the tool at all. This adds the per-fixture anchor:
-- `svrz_game_id` = svrz_games.svrz_persistence_id (soft reference, no FK —
-- svrz_games rows are re-synced from the feed). NULL = legacy/non-SVRZ booking,
-- which the code treats as "the first fixture of its side".
--
-- Schema-only + idempotent. No permission change: `game_scheduling_bookings`
-- is fields:['*'] in setup-permissions, so the new column is exposed as-is.

ALTER TABLE public.game_scheduling_bookings
  ADD COLUMN IF NOT EXISTS svrz_game_id character varying(255);

CREATE INDEX IF NOT EXISTS game_scheduling_bookings_svrz_game_id_index
  ON public.game_scheduling_bookings (svrz_game_id);

-- One booking per (opponent, type, fixture). Partial: legacy NULL rows (one per
-- opponent+type by the old model) stay valid without tripping the constraint.
CREATE UNIQUE INDEX IF NOT EXISTS game_scheduling_bookings_opp_type_fixture_unique
  ON public.game_scheduling_bookings (opponent, type, svrz_game_id)
  WHERE svrz_game_id IS NOT NULL;

-- Backfill: attach each existing booking to the FIRST fixture of its side
-- (ordered starting_date_time, then svrz_persistence_id — the same order the
-- endpoint uses). Fixture match mirrors opponentSvrzFixtures():
--   * season_name = the season's start year ("2026/27" → "2026")
--   * status open/waitingForApproval (played/finalized games drop out)
--   * KSCW club (912530) on one side, the opponent's team_name on the other
--   * the KSCW side is THIS kscw_team — matched by staticTeamIdentifier from
--     raw JSON vs teams.team_id ('vb_<id>'); when EITHER id is missing, fall
--     back to the feed name label ("KSC Wiedikon <name>") — mirrors the JS.
-- Old model guarantees ≤1 home + ≤1 away booking per opponent, so rn=1 is safe.
-- Idempotent via "svrz_game_id IS NULL".
WITH fixture AS (
  SELECT
    o.id AS opponent_id,
    (g.home_club_id = '912530') AS is_home_kscw,
    g.svrz_persistence_id,
    ROW_NUMBER() OVER (
      PARTITION BY o.id, (g.home_club_id = '912530')
      ORDER BY g.starting_date_time, g.svrz_persistence_id
    ) AS rn
  FROM public.game_scheduling_opponents o
  JOIN public.game_scheduling_seasons s ON s.id = o.season
  JOIN public.teams t ON t.id = o.kscw_team
  JOIN public.svrz_games g
    ON g.season_name = split_part(s.season, '/', 1)
   AND g.status IN ('open', 'waitingForApproval')
   AND (
         (g.home_club_id = '912530' AND g.away_team_name = o.team_name)
      OR (g.away_club_id = '912530' AND g.home_team_name = o.team_name)
       )
  CROSS JOIN LATERAL (
    SELECT
      CASE WHEN g.home_club_id = '912530'
           THEN g.raw::jsonb -> 'encounter' -> 'teamHome' ->> 'staticTeamIdentifier'
           ELSE g.raw::jsonb -> 'encounter' -> 'teamAway' ->> 'staticTeamIdentifier'
      END AS fixture_sid,
      NULLIF(substring(COALESCE(t.team_id, '') FROM '(\d+)\s*$'), '') AS team_sid,
      CASE WHEN g.home_club_id = '912530' THEN g.home_team_name ELSE g.away_team_name END AS kscw_side_name
  ) m
  WHERE o.team_name IS NOT NULL
    AND (
          (m.fixture_sid IS NOT NULL AND m.team_sid IS NOT NULL AND m.fixture_sid = m.team_sid)
       OR (
            (m.fixture_sid IS NULL OR m.team_sid IS NULL)
            AND LOWER(COALESCE(m.kscw_side_name, '')) = LOWER('KSC Wiedikon ' || COALESCE(t.name, ''))
          )
        )
)
UPDATE public.game_scheduling_bookings b
SET svrz_game_id = f.svrz_persistence_id
FROM fixture f
WHERE b.svrz_game_id IS NULL
  AND b.opponent = f.opponent_id
  AND f.rn = 1
  AND (
        (b.type = 'home_slot_pick' AND f.is_home_kscw)
     OR (b.type = 'away_proposal' AND NOT f.is_home_kscw)
      );
