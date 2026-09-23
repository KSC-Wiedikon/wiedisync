-- 371 — A basketball home game can have more than one duty team.
--
-- Basketball staffs the table per GAME (one team brings the whole crew), unlike
-- volleyball's per-seat teams. The DU18 Spark–Fire derby on 28.09.2026 is
-- covered by the women jointly: any OTR1 holder of Lions D1 OR Rhinos D3 may
-- take either seat (reported 23.09.2026).
--
-- `bb_extra_duty_teams` (json) lists the teams sharing the duty besides the
-- primary `bb_duty_team`:  [89]  or  [86, 89].
--
-- `bb_duty_team` stays the primary — auto-assign, stats views and every older
-- reader keep working on it. Readers that decide WHO may take a seat use the
-- union (src/modules/scorer/lib/bbDutyTeams.ts, scorer-claim.js,
-- scorer-contacts.js).
--
-- Schema only; no backfill.

BEGIN;

ALTER TABLE public.games ADD COLUMN IF NOT EXISTS bb_extra_duty_teams json;

INSERT INTO directus_fields (collection, field, special, interface, options, note, width)
SELECT 'games', 'bb_extra_duty_teams', 'cast-json', 'input-code', '{"language":"json"}',
       'Basketball: further teams sharing this game''s table duty besides bb_duty_team, as a team-id array. Null = single team. See migration 371.',
       'full'
 WHERE NOT EXISTS (SELECT 1 FROM directus_fields f WHERE f.collection = 'games' AND f.field = 'bb_extra_duty_teams');

-- Normalises to a clean int array (or NULL). Rejects unknown teams; drops the
-- primary and duplicates; promotes the first extra when there is no primary,
-- so `bb_duty_team` is set whenever any duty team is.
CREATE OR REPLACE FUNCTION public.games_normalize_bb_extra_duty_teams()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  e       jsonb;
  t       int;
  cleaned int[] := '{}';
BEGIN
  IF NEW.bb_extra_duty_teams IS NULL OR jsonb_typeof(NEW.bb_extra_duty_teams::jsonb) = 'null' THEN
    NEW.bb_extra_duty_teams := NULL;
    RETURN NEW;
  END IF;
  IF jsonb_typeof(NEW.bb_extra_duty_teams::jsonb) <> 'array' THEN
    RAISE EXCEPTION 'bb_extra_duty_teams must be an array' USING ERRCODE = 'check_violation';
  END IF;
  FOR e IN SELECT * FROM jsonb_array_elements(NEW.bb_extra_duty_teams::jsonb) LOOP
    IF jsonb_typeof(e) = 'object' AND e ? 'id' THEN e := e->'id'; END IF;
    IF jsonb_typeof(e) NOT IN ('number', 'string') THEN
      RAISE EXCEPTION 'bb_extra_duty_teams entries must be team ids' USING ERRCODE = 'check_violation';
    END IF;
    t := (e #>> '{}')::int;
    IF NOT EXISTS (SELECT 1 FROM teams WHERE id = t) THEN
      RAISE EXCEPTION 'bb_extra_duty_teams: team % does not exist', t USING ERRCODE = 'foreign_key_violation';
    END IF;
    IF t IS DISTINCT FROM NEW.bb_duty_team AND NOT (t = ANY (cleaned)) THEN
      cleaned := cleaned || t;
    END IF;
  END LOOP;
  IF NEW.bb_duty_team IS NULL AND array_length(cleaned, 1) > 0 THEN
    NEW.bb_duty_team := cleaned[1];
    cleaned := cleaned[2:];
  END IF;
  NEW.bb_extra_duty_teams := CASE WHEN coalesce(array_length(cleaned, 1), 0) = 0 THEN NULL ELSE to_json(cleaned) END;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_games_normalize_bb_extra_duty_teams ON public.games;
CREATE TRIGGER trg_games_normalize_bb_extra_duty_teams
  BEFORE INSERT OR UPDATE OF bb_extra_duty_teams, bb_duty_team ON public.games
  FOR EACH ROW EXECUTE FUNCTION public.games_normalize_bb_extra_duty_teams();

COMMIT;
