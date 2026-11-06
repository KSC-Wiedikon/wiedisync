-- Migration 448: upcoming HU20 home games get a Schreiber from their referee team (owner, 06.11.2026).
--
-- Backfill only. Opens the scorer spot by setting scorer_duty_team and leaves
-- scorer_member empty, so somebody from the team claims it on /scorer. Games already
-- played stay as they are, and a game with a scorer spot is not touched.
--
-- Idempotent.

BEGIN;

UPDATE games g
SET scorer_duty_team = g.referee_duty_team
FROM teams t
WHERE t.id = g.kscw_team
  AND t.sport = 'volleyball'
  AND t.name LIKE 'HU20%'
  AND g.type = 'home'
  AND g.date >= CURRENT_DATE
  AND g.status IS DISTINCT FROM 'completed'
  AND g.referee_duty_team IS NOT NULL
  AND g.scorer_duty_team IS NULL
  AND g.scorer_member IS NULL;

COMMIT;
