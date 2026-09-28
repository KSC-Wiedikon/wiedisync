-- 381: event / training "updated" notifications only for a real change
--
-- Security audit 2026-09-28, F79 (Info). trg_events_notify and
-- trg_trainings_notify inserted an `event_updated` / `training_updated` bell
-- entry for EVERY row of the invited teams on EVERY UPDATE of the row —
-- including writes that change nothing a member sees (a form re-saving the
-- same values, a bookkeeping column, the carpool toggle). One event on prod
-- carried 37 `event_updated` notifications. Each is also a cheap way for any
-- coach with an update grant to spam a whole team's bell.
--
-- The UPDATE arm now returns early unless a member-visible column actually
-- changed (IS DISTINCT FROM, so NULL ↔ value counts). INSERT, DELETE and the
-- cancel transition are unchanged; everything else in both functions is
-- byte-identical to the prod definitions in SCHEMA.sql (357 for the bodies,
-- 054 for the trainings silencer). Triggers are untouched — CREATE OR REPLACE
-- on the functions is the whole change.
--
-- Not changed here: the audit's second half of F79 (events ignore
-- `invite_guests = false` in this fan-out) — that is an audience rule, not a
-- volume fix, and belongs with the event-notify endpoint's audience logic.
--
-- No directus_fields / permission rows; no restart needed.
-- Schema-only + idempotent per the CLAUDE.md migration policy.

BEGIN;

CREATE OR REPLACE FUNCTION public.trg_events_notify() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
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
  SELECT DISTINCT mt.member, v_type, v_title_key, v_body, 'event', v_id::text, et.teams_id, false
  FROM events_teams et
  JOIN member_teams mt ON mt.team = et.teams_id
  WHERE et.events_id = v_id;

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;


CREATE OR REPLACE FUNCTION public.trg_trainings_notify() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
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
  SELECT mt.member, v_type, v_title, v_body, 'training', v_id::text, v_team_id, false
  FROM member_teams mt WHERE mt.team = v_team_id;

  RETURN COALESCE(NEW, OLD);
END;
$$;


COMMIT;
