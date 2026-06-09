-- 095: Allow the season rollover to silence games UPDATE notifications while it
-- re-points future MANUAL games from the archived team to the new-season team.
--
-- Context: `trg_games_notify` fans out a push/notification to every team member
-- on every INSERT/UPDATE/DELETE of a `games` row (the UPDATE branch sends
-- "game_updated"). The rollover endpoint re-points future `source='manual'`
-- games old team -> new team (synced games re-sync on their own and were
-- therefore never re-pointed). Without a silencer that bulk move would spam
-- "game updated" to the new team's whole roster.
--
-- Solution: a transaction-scoped GUC `kscw.skip_games_notify`, mirroring
-- `kscw.skip_trainings_notify` (migration 054). The trigger short-circuits when
-- it is set; the rollover wraps its manual-game UPDATE in a transaction that
-- calls `SELECT set_config('kscw.skip_games_notify', 'on', true)` (third arg =
-- transaction-local, so it never leaks to other sessions on the pooled conn).
--
-- The function body below is byte-identical to the live definition (SCHEMA.sql)
-- apart from the added guard at the top. Idempotent: CREATE OR REPLACE on the
-- function. No data changes, no permission changes.

CREATE OR REPLACE FUNCTION public.trg_games_notify() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
DECLARE
  v_type text; v_title text; v_body text; v_team_id int; v_game_id int;
  v_hall text; v_rec record;
BEGIN
  -- Silencer for bulk re-point during season rollover. Second arg `true` =
  -- return empty string if unset instead of raising.
  IF current_setting('kscw.skip_games_notify', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  -- Pick the right row for field access
  IF TG_OP = 'DELETE' THEN v_rec := OLD; ELSE v_rec := NEW; END IF;
  v_team_id := v_rec.kscw_team; v_game_id := v_rec.id;
  IF v_team_id IS NULL THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  -- Resolve hall name
  SELECT COALESCE(h.name, '') INTO v_hall FROM halls h WHERE h.id = v_rec.hall;
  v_hall := COALESCE(v_hall, '');

  IF TG_OP = 'INSERT' THEN
    v_type := 'activity_change'; v_title := 'game_created';
    v_body := json_build_object(
      'home_team', COALESCE(NEW.home_team, ''), 'away_team', COALESCE(NEW.away_team, ''),
      'date', COALESCE(to_char(NEW.date, 'DD.MM.YY'), ''),
      'time', COALESCE(to_char(NEW.time, 'HH24:MI'), ''), 'hall', v_hall
    )::text;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.status = 'completed' AND (OLD.status IS DISTINCT FROM 'completed') THEN
      v_type := 'result_available'; v_title := 'game_result';
      v_body := json_build_object(
        'home_team', COALESCE(NEW.home_team, ''), 'away_team', COALESCE(NEW.away_team, ''),
        'home_score', COALESCE(NEW.home_score::text, '0'), 'away_score', COALESCE(NEW.away_score::text, '0')
      )::text;
    ELSIF NEW.status = 'cancelled' AND (OLD.status IS DISTINCT FROM 'cancelled') THEN
      v_type := 'activity_change'; v_title := 'game_deleted';
      v_body := json_build_object(
        'home_team', COALESCE(NEW.home_team, ''), 'away_team', COALESCE(NEW.away_team, ''),
        'date', COALESCE(to_char(NEW.date, 'DD.MM.YY'), '')
      )::text;
    ELSE
      v_type := 'activity_change'; v_title := 'game_updated';
      v_body := json_build_object(
        'home_team', COALESCE(NEW.home_team, ''), 'away_team', COALESCE(NEW.away_team, ''),
        'date', COALESCE(to_char(NEW.date, 'DD.MM.YY'), ''),
        'time', COALESCE(to_char(NEW.time, 'HH24:MI'), ''), 'hall', v_hall
      )::text;
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    v_type := 'activity_change'; v_title := 'game_deleted';
    v_body := json_build_object(
      'home_team', COALESCE(OLD.home_team, ''), 'away_team', COALESCE(OLD.away_team, ''),
      'date', COALESCE(to_char(OLD.date, 'DD.MM.YY'), '')
    )::text;
  END IF;

  -- Skip notifications for past games (allow result_available up to 3 days after)
  IF v_type = 'result_available' THEN
    IF NEW.date < CURRENT_DATE - INTERVAL '3 days' THEN RETURN NEW; END IF;
  ELSE
    IF TG_OP = 'DELETE' THEN
      IF OLD.date < CURRENT_DATE THEN RETURN OLD; END IF;
    ELSE
      IF NEW.date < CURRENT_DATE THEN RETURN NEW; END IF;
    END IF;
  END IF;

  INSERT INTO notifications (member, type, title, body, activity_type, activity_id, team, read)
  SELECT mt.member, v_type, v_title, v_body, 'game', v_game_id::text, v_team_id, false
  FROM member_teams mt WHERE mt.team = v_team_id;

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;
