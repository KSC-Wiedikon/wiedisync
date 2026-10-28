-- 432: activity-change bells reach coaches and team responsibles who don't play
--
-- trg_trainings_notify, trg_games_notify and trg_events_notify picked their
-- recipients from `member_teams` — the PLAYER roster. Coaches and team
-- responsibles live in `teams_coaches` / `teams_responsibles` and get no
-- roster row unless they also play (member_teams role model), so a coach who
-- only coaches never got a bell when their training was cancelled, moved or
-- auto-shortened, a game was rescheduled, or a team event changed.
-- Surfaced 28.10.2026 auditing a VB H2/H3 coach who saw no teams on /profile.
--
-- team_people_ids(team) = roster ∪ coaches ∪ team responsibles, deduplicated
-- (UNION), so a player-coach still gets ONE bell. It mirrors teamPeopleSql()
-- in kscw-endpoints/src/activity-roster-sql.js minus the is_staff/guest_level
-- columns a notification doesn't need. Guests stay included, as before.
--
-- The three functions are copied verbatim from the live definitions (381 / 357)
-- — only the recipient FROM changes. Schema-only: no permission rows.

BEGIN;

CREATE OR REPLACE FUNCTION public.team_people_ids(p_team integer)
 RETURNS SETOF integer
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT member FROM member_teams WHERE team = p_team
  UNION
  SELECT members_id FROM teams_coaches WHERE teams_id = p_team
  UNION
  SELECT members_id FROM teams_responsibles WHERE teams_id = p_team
$function$;

CREATE OR REPLACE FUNCTION public.trg_trainings_notify()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_type text; v_title text; v_body text; v_team_id int; v_id int;
  v_hall text;
BEGIN
  -- Silencer for bulk auto-generation (slot-cascade hook). Second arg
  -- `true` means "return empty string if not set" instead of raising.
  IF current_setting('kscw.skip_trainings_notify', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_team_id := NEW.team; v_id := NEW.id;
    IF v_team_id IS NULL THEN RETURN NEW; END IF;
    SELECT COALESCE(h.name, '') INTO v_hall FROM halls h WHERE h.id = NEW.hall;
    v_hall := COALESCE(v_hall, '');
    v_type := 'activity_change';
    v_title := 'training_created';
    v_body := json_build_object(
      'date', COALESCE(to_char(NEW.date, 'DD.MM.YYYY'), ''),
      'time', COALESCE(to_char(NEW.start_time, 'HH24:MI'), ''),
      'hall', v_hall
    )::text;
  ELSIF TG_OP = 'UPDATE' THEN
    v_team_id := NEW.team; v_id := NEW.id;
    IF v_team_id IS NULL THEN RETURN NEW; END IF;
    -- Migration 381: only a change a member would care about is news (see
    -- trg_events_notify). Auto-cancel / auto-shorten change cancelled / end_time
    -- and still notify, as before.
    IF NEW.date       IS NOT DISTINCT FROM OLD.date
       AND NEW.start_time IS NOT DISTINCT FROM OLD.start_time
       AND NEW.end_time   IS NOT DISTINCT FROM OLD.end_time
       AND NEW.hall       IS NOT DISTINCT FROM OLD.hall
       AND NEW.hall_name  IS NOT DISTINCT FROM OLD.hall_name
       AND NEW.notes      IS NOT DISTINCT FROM OLD.notes
       AND NEW.team       IS NOT DISTINCT FROM OLD.team
       AND NEW.cancelled  IS NOT DISTINCT FROM OLD.cancelled THEN
      RETURN NEW;
    END IF;
    SELECT COALESCE(h.name, '') INTO v_hall FROM halls h WHERE h.id = NEW.hall;
    v_hall := COALESCE(v_hall, '');
    IF NEW.cancelled = true AND OLD.cancelled IS DISTINCT FROM true THEN
      v_type := 'activity_change'; v_title := 'training_cancelled';
    ELSE
      v_type := 'activity_change'; v_title := 'training_updated';
    END IF;
    v_body := json_build_object(
      'date', COALESCE(to_char(NEW.date, 'DD.MM.YYYY'), ''),
      'hall', v_hall
    )::text;
  ELSIF TG_OP = 'DELETE' THEN
    v_team_id := OLD.team; v_id := OLD.id;
    IF v_team_id IS NULL THEN RETURN OLD; END IF;
    v_type := 'activity_change'; v_title := 'training_deleted';
    v_body := json_build_object(
      'date', COALESCE(to_char(OLD.date, 'DD.MM.YYYY'), '')
    )::text;
  END IF;

  -- Skip notifications for past trainings
  IF TG_OP = 'DELETE' THEN
    IF OLD.date < CURRENT_DATE THEN RETURN OLD; END IF;
  ELSE
    IF NEW.date < CURRENT_DATE THEN RETURN NEW; END IF;
  END IF;

  INSERT INTO notifications (member, type, title, body, activity_type, activity_id, team, read)
  SELECT p.member, v_type, v_title, v_body, 'training', v_id::text, v_team_id, false
  FROM team_people_ids(v_team_id) p(member);

  RETURN COALESCE(NEW, OLD);
END;
$function$;

CREATE OR REPLACE FUNCTION public.trg_games_notify()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
      'date', COALESCE(to_char(NEW.date, 'DD.MM.YYYY'), ''),
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
        'date', COALESCE(to_char(NEW.date, 'DD.MM.YYYY'), '')
      )::text;
    ELSIF OLD.status = 'cancelled' AND NEW.status = 'scheduled' THEN
      -- Un-cancel: the team was told "game cancelled" — a silent reappearance
      -- (previously the cosmetic-mute branch when date/time were unchanged)
      -- must not happen. completed is handled above; cancelled→postponed
      -- deliberately does NOT announce "reinstated" (still not happening).
      v_type := 'activity_change'; v_title := 'game_reinstated';
      v_body := json_build_object(
        'home_team', COALESCE(NEW.home_team, ''), 'away_team', COALESCE(NEW.away_team, ''),
        'date', COALESCE(to_char(NEW.date, 'DD.MM.YYYY'), ''),
        'time', COALESCE(to_char(NEW.time, 'HH24:MI'), ''), 'hall', v_hall
      )::text;
    ELSE
      -- Mute cosmetic updates: only notify when the game was actually rescheduled
      -- (date or time changed). Everything else (referee/set/league/round churn
      -- from the SV feed, in-progress scores) writes the row silently.
      IF NEW.date IS NOT DISTINCT FROM OLD.date AND NEW.time IS NOT DISTINCT FROM OLD.time THEN
        RETURN NEW;
      END IF;
      v_type := 'activity_change'; v_title := 'game_updated';
      v_body := json_build_object(
        'home_team', COALESCE(NEW.home_team, ''), 'away_team', COALESCE(NEW.away_team, ''),
        'date', COALESCE(to_char(NEW.date, 'DD.MM.YYYY'), ''),
        'time', COALESCE(to_char(NEW.time, 'HH24:MI'), ''), 'hall', v_hall
      )::text;
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    v_type := 'activity_change'; v_title := 'game_deleted';
    v_body := json_build_object(
      'home_team', COALESCE(OLD.home_team, ''), 'away_team', COALESCE(OLD.away_team, ''),
      'date', COALESCE(to_char(OLD.date, 'DD.MM.YYYY'), '')
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
  SELECT p.member, v_type, v_title, v_body, 'game', v_game_id::text, v_team_id, false
  FROM team_people_ids(v_team_id) p(member);

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.trg_events_notify()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_type text;
  v_title_key text;
  v_body text;
  v_id integer;
  v_location text;
BEGIN
  IF TG_OP = 'DELETE' THEN v_id := OLD.id; ELSE v_id := NEW.id; END IF;

  v_location := '';
  IF TG_OP != 'DELETE' AND NEW.location IS NOT NULL THEN
    v_location := NEW.location;
  END IF;

  -- `events.start_date` is timestamptz and the server runs on UTC, so a bare
  -- to_char rendered a 19:00 Zurich event as "17:00" — and bucketed a 00:30
  -- Zurich event onto the previous day. Localize, exactly like the cron
  -- reminder in kscw-hooks already does for the same field.
  IF TG_OP = 'INSERT' THEN
    v_type := 'activity_change'; v_title_key := 'event_created';
    v_body := json_build_object(
      'title', COALESCE(NEW.title, ''),
      'date', COALESCE(to_char(NEW.start_date AT TIME ZONE 'Europe/Zurich', 'DD.MM.YYYY'), ''),
      'time', COALESCE(to_char(NEW.start_date AT TIME ZONE 'Europe/Zurich', 'HH24:MI'), ''),
      'location', v_location
    )::text;
  ELSIF TG_OP = 'UPDATE' THEN
    -- Migration 381: only a change a member would care about is news. Every
    -- other write (an RSVP-side bookkeeping column, a form re-saving the same
    -- values, the carpool toggle) used to fan out another `event_updated`.
    IF NEW.title       IS NOT DISTINCT FROM OLD.title
       AND NEW.start_date  IS NOT DISTINCT FROM OLD.start_date
       AND NEW.end_date    IS NOT DISTINCT FROM OLD.end_date
       AND NEW.all_day     IS NOT DISTINCT FROM OLD.all_day
       AND NEW.meeting_time IS NOT DISTINCT FROM OLD.meeting_time
       AND NEW.location    IS NOT DISTINCT FROM OLD.location
       AND NEW.hall        IS NOT DISTINCT FROM OLD.hall
       AND NEW.description IS NOT DISTINCT FROM OLD.description
       AND NEW.cancelled   IS NOT DISTINCT FROM OLD.cancelled THEN
      RETURN NEW;
    END IF;
    v_type := 'activity_change'; v_title_key := 'event_updated';
    v_body := json_build_object(
      'title', COALESCE(NEW.title, ''),
      'date', COALESCE(to_char(NEW.start_date AT TIME ZONE 'Europe/Zurich', 'DD.MM.YYYY'), ''),
      'time', COALESCE(to_char(NEW.start_date AT TIME ZONE 'Europe/Zurich', 'HH24:MI'), ''),
      'location', v_location
    )::text;
  ELSIF TG_OP = 'DELETE' THEN
    v_type := 'activity_change'; v_title_key := 'event_deleted';
    v_body := json_build_object(
      'title', COALESCE(OLD.title, '')
    )::text;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD.start_date < CURRENT_DATE THEN RETURN OLD; END IF;
  ELSE
    IF NEW.start_date < CURRENT_DATE THEN RETURN NEW; END IF;
  END IF;

  INSERT INTO notifications (member, type, title, body, activity_type, activity_id, team, read)
  SELECT DISTINCT p.member, v_type, v_title_key, v_body, 'event', v_id::text, et.teams_id, false
  FROM events_teams et
  CROSS JOIN LATERAL team_people_ids(et.teams_id) p(member)
  WHERE et.events_id = v_id;

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$function$;

COMMIT;
