-- Migration 450: upcoming HU20 home games get a Täfeler from their referee team (owner, 06.11.2026).
--
-- Corrects the backfill in migration 448, which opened a Schreiber spot. The owner's
-- correction: for these games it is a Täfeler, with no licence. This clears the
-- scorer team 448 set and sets scoreboard_duty_team to the referee's team instead.
--
-- Backfill only. Nobody is assigned, so somebody from the team claims it on /scorer.
-- Games already played stay as they are. A game whose Täfeler spot is already set, or
-- with a scorer or a scorer team other than the referee's, is not touched.
--
-- Idempotent.

BEGIN;

UPDATE games g
SET scoreboard_duty_team = g.referee_duty_team,
    scorer_duty_team = NULL
FROM teams t
WHERE t.id = g.kscw_team
  AND t.sport = 'volleyball'
  AND t.name LIKE 'HU20%'
  AND g.type = 'home'
  AND g.date >= CURRENT_DATE
  AND g.status IS DISTINCT FROM 'completed'
  AND g.referee_duty_team IS NOT NULL
  AND g.scoreboard_duty_team IS NULL
  AND g.scoreboard_member IS NULL
  AND g.scorer_member IS NULL
  AND (g.scorer_duty_team IS NULL OR g.scorer_duty_team = g.referee_duty_team);

COMMIT;
