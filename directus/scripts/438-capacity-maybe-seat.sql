-- Migration 438: a Maybe holds a seat; Maybes turn into No at the deadline of a capped activity
--
-- Owner decisions, 30.10.2026, on top of migration 437 (max participants + waiting list):
--   1. A Maybe (`tentative`) takes a seat like a Yes. A Maybe on a full activity goes on
--      the waiting list, and comes back as a Maybe when a seat frees up — so the row has to
--      remember which answer it waits with: `requested_status` (trigger-owned).
--   2. On every training / event with a max, Maybes turn into No at the respond-by
--      deadline, whatever the team setting — so the waiting list moves up. A waiting
--      Maybe leaves the list at the same moment (it would only be promoted to a Maybe
--      that is already past its deadline). kscw-hooks calls
--      kscw_capacity_maybe_deadline_sweep() every minute.
--   3. People on the waiting list, or moved up from it after the deadline, may still say
--      No in the app. The app needs to know who was moved up: `promoted_at`
--      (trigger-owned, set when the rebalance moves a row from waitlisted to a seat).
--
-- Seat set is now confirmed + tentative + waitlisted (was confirmed + waitlisted).
-- claimed_at keeps its contract: stamped on entering that set, kept while moving inside
-- it — so Yes ↔ Maybe ↔ waiting never loses (or jumps) a place in the queue.

BEGIN;

ALTER TABLE participations ADD COLUMN IF NOT EXISTS requested_status character varying(16);
ALTER TABLE participations ADD COLUMN IF NOT EXISTS promoted_at timestamptz;

COMMENT ON COLUMN public.participations.requested_status IS
  'System-set (trg_participations_capacity_stamp): the answer this RSVP holds a seat with — '
  'confirmed (Yes) or tentative (Maybe). Kept while the row is `waitlisted`, so a promotion '
  'gives back the answer the member gave.';
COMMENT ON COLUMN public.participations.promoted_at IS
  'System-set: when the capacity rebalance moved this RSVP from the waiting list to a seat. '
  'Cleared when it leaves the seat. The app lets a member moved up after the deadline still say No.';

-- Backfill. The stamp trigger owns both columns (and claimed_at) and ignores written
-- values, so it is off for these two statements. Existing waiting rows all came from a
-- Yes (437 only seated confirmed rows); existing Maybes now hold a claim.
ALTER TABLE participations DISABLE TRIGGER trg_participations_capacity_stamp;
UPDATE participations
   SET requested_status = CASE status WHEN 'waitlisted' THEN 'confirmed' ELSE status END
 WHERE requested_status IS NULL
   AND activity_type IN ('training', 'event')
   AND status IN ('confirmed', 'tentative', 'waitlisted');
UPDATE participations
   SET claimed_at = COALESCE(last_status_edited_at, date_created, date_updated, TIMESTAMPTZ 'epoch')
 WHERE claimed_at IS NULL
   AND activity_type IN ('training', 'event')
   AND status = 'tentative';
ALTER TABLE participations ENABLE TRIGGER trg_participations_capacity_stamp;

-- ── Stamp: claimed_at, requested_status, promoted_at, waitlisted_at ──
CREATE OR REPLACE FUNCTION trg_participations_capacity_stamp()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- claimed_at: entering the seat set from outside (members write their own rows with
  -- every field, so a written value is ignored — a backdated claim would jump the queue).
  IF TG_OP = 'INSERT' THEN
    NEW.claimed_at := CASE WHEN NEW.status IN ('confirmed', 'tentative', 'waitlisted') THEN clock_timestamp() END;
  ELSIF NEW.status IN ('confirmed', 'tentative', 'waitlisted')
        AND (OLD.status IS NULL OR OLD.status NOT IN ('confirmed', 'tentative', 'waitlisted')) THEN
    NEW.claimed_at := clock_timestamp();
  ELSE
    NEW.claimed_at := OLD.claimed_at;
  END IF;

  -- requested_status: the answer a seat gives back.
  IF NEW.status IN ('confirmed', 'tentative') THEN
    NEW.requested_status := NEW.status;
  ELSIF TG_OP = 'INSERT' THEN
    NEW.requested_status := CASE WHEN NEW.status = 'waitlisted' THEN 'confirmed' END;
  ELSE
    NEW.requested_status := OLD.requested_status;
  END IF;

  -- promoted_at: from the waiting list to a seat; gone when the seat is.
  IF TG_OP = 'UPDATE' AND OLD.status = 'waitlisted' AND NEW.status IN ('confirmed', 'tentative') THEN
    NEW.promoted_at := clock_timestamp();
  ELSIF TG_OP = 'INSERT' OR NEW.status IS NULL OR NEW.status NOT IN ('confirmed', 'tentative') THEN
    NEW.promoted_at := NULL;
  ELSE
    NEW.promoted_at := OLD.promoted_at;
  END IF;

  -- waitlisted_at: set on entering the waiting list, cleared on leaving it unless the
  -- writer sets it (the 1970 auto-decline sentinel lives on declined rows only).
  IF NEW.status = 'waitlisted' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'waitlisted') THEN
    NEW.waitlisted_at := clock_timestamp();
  ELSIF TG_OP = 'UPDATE' AND OLD.status = 'waitlisted' AND NEW.status IS DISTINCT FROM 'waitlisted'
        AND NEW.waitlisted_at IS NOT DISTINCT FROM OLD.waitlisted_at THEN
    NEW.waitlisted_at := NULL;
  END IF;

  RETURN NEW;
END;
$$;

-- ── The rebalance: Maybes hold seats, a promotion gives the asked answer back ──
CREATE OR REPLACE FUNCTION kscw_rebalance_capacity(p_type text, p_activity text, p_session text, p_written integer DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_cap integer;
  v_team integer;
  v_closed boolean;
  v_moved integer := 0;
BEGIN
  IF p_type IS NULL OR p_type NOT IN ('training', 'event')
     OR p_activity IS NULL OR p_activity !~ '^[0-9]{1,9}$' THEN
    RETURN 0;
  END IF;

  -- Most activities have no cap: leave before the lock when there is nothing to do
  -- (no cap and nobody waiting), or the activity is over / cancelled / gone.
  SELECT c.cap, c.closed INTO v_cap, v_closed FROM kscw_activity_capacity(p_type, p_activity) c;
  IF NOT FOUND OR v_closed THEN
    RETURN 0;
  END IF;
  IF v_cap IS NULL AND NOT EXISTS (
    SELECT 1 FROM participations p
     WHERE p.activity_type = p_type AND p.activity_id = p_activity
       AND p.session_id IS NOT DISTINCT FROM p_session
       AND p.status = 'waitlisted') THEN
    RETURN 0;
  END IF;

  -- One rebalance per activity at a time (see migration 437 for the lock rationale).
  PERFORM pg_advisory_xact_lock(437, hashtext(p_type || ':' || p_activity));

  SELECT c.cap, c.team, c.closed INTO v_cap, v_team, v_closed FROM kscw_activity_capacity(p_type, p_activity) c;
  IF NOT FOUND OR v_closed THEN
    RETURN 0;
  END IF;

  PERFORM set_config('kscw.capacity_rebalancing', 'on', true);

  WITH pool AS (
    SELECT p.id, p.member, p.status, p.requested_status,
           1 + GREATEST(COALESCE(p.guest_count, 0), 0) AS seats,
           kscw_capacity_guest_level(p_type, p_activity, v_team, p.member) AS lvl,
           p.claimed_at AS claimed
      FROM participations p
     WHERE p.activity_type = p_type
       AND p.activity_id = p_activity
       AND p.session_id IS NOT DISTINCT FROM p_session
       AND NOT p.is_staff
       AND p.status IN ('confirmed', 'tentative', 'waitlisted')
  ), ranked AS (
    SELECT id,
           CASE
             WHEN v_cap IS NULL
               OR sum(seats) OVER (ORDER BY (lvl > 0), lvl, claimed NULLS FIRST, id
                                   ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) <= v_cap
               THEN CASE WHEN status = 'waitlisted' THEN COALESCE(requested_status, 'confirmed') ELSE status END
             ELSE 'waitlisted'
           END AS want
      FROM pool
  ), moved AS (
    UPDATE participations p
       SET status = r.want
      FROM ranked r
     WHERE p.id = r.id
       AND p.status IS DISTINCT FROM r.want
    RETURNING p.id, p.member, p.status, p.claimed_at
  ), queued AS (
    -- move 'confirmed' = got a seat (as a Yes or a Maybe), 'waitlisted' = lost it.
    INSERT INTO participation_capacity_moves (participation, member, activity_type, activity_id, session_id, move)
    SELECT m.id, m.member, p_type, p_activity, p_session,
           CASE WHEN m.status = 'waitlisted' THEN 'waitlisted' ELSE 'confirmed' END
      FROM moved m
     WHERE m.id IS DISTINCT FROM p_written
       AND m.member IS NOT NULL
       AND COALESCE(m.claimed_at, '-infinity'::timestamptz) < transaction_timestamp()
    RETURNING 1
  )
  SELECT count(*) INTO v_moved FROM moved;

  PERFORM set_config('kscw.capacity_rebalancing', 'off', true);
  RETURN v_moved;
END;
$$;

-- ── After-write trigger: tentative now counts ─────────────────────────
CREATE OR REPLACE FUNCTION trg_participations_capacity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_setting('kscw.capacity_rebalancing', true) = 'on' THEN
    RETURN NULL;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD.activity_type IN ('training', 'event')
       AND OLD.status IN ('confirmed', 'tentative', 'waitlisted') AND NOT OLD.is_staff THEN
      PERFORM kscw_rebalance_capacity(OLD.activity_type, OLD.activity_id, OLD.session_id, NULL);
    END IF;
    RETURN NULL;
  END IF;

  IF NEW.activity_type IS NULL OR NEW.activity_type NOT IN ('training', 'event') THEN
    RETURN NULL;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status IN ('confirmed', 'tentative', 'waitlisted') AND NOT NEW.is_staff THEN
      PERFORM kscw_rebalance_capacity(NEW.activity_type, NEW.activity_id, NEW.session_id, NEW.id);
    END IF;
    RETURN NULL;
  END IF;

  IF ((OLD.status IN ('confirmed', 'tentative', 'waitlisted') AND NOT OLD.is_staff)
      OR (NEW.status IN ('confirmed', 'tentative', 'waitlisted') AND NOT NEW.is_staff))
     AND (OLD.status IS DISTINCT FROM NEW.status
          OR OLD.is_staff IS DISTINCT FROM NEW.is_staff
          OR OLD.guest_count IS DISTINCT FROM NEW.guest_count) THEN
    PERFORM kscw_rebalance_capacity(NEW.activity_type, NEW.activity_id, NEW.session_id, NEW.id);
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION trg_activity_capacity_changed()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_type text := CASE TG_TABLE_NAME WHEN 'trainings' THEN 'training' ELSE 'event' END;
  v_session text;
BEGIN
  FOR v_session IN
    SELECT DISTINCT p.session_id FROM participations p
     WHERE p.activity_type = v_type
       AND p.activity_id = NEW.id::text
       AND p.status IN ('confirmed', 'tentative', 'waitlisted')
       AND NOT p.is_staff
  LOOP
    PERFORM kscw_rebalance_capacity(v_type, NEW.id::text, v_session, NULL);
  END LOOP;
  RETURN NULL;
END;
$$;

-- ── Maybe → No at the deadline of a capped activity ───────────────────
-- Same deadline reading as the app's getDeadlineDate() and kscw-hooks
-- effectiveDeadlineSql(): a Zurich wall time of exactly 00:00 is the "no time given"
-- sentinel and means the activity's own start time (else 23:59), not midnight.
CREATE OR REPLACE FUNCTION kscw_capacity_effective_deadline(p_respond_by timestamptz, p_start time)
RETURNS timestamptz
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN (p_respond_by AT TIME ZONE 'Europe/Zurich')::time = '00:00:00'
      THEN (((p_respond_by AT TIME ZONE 'Europe/Zurich')::date + COALESCE(p_start, '23:59'::time))
            AT TIME ZONE 'Europe/Zurich')
    ELSE p_respond_by
  END
$$;

-- Declines every non-staff Maybe — seated, or waiting with a Maybe — of each upcoming,
-- not cancelled training / event with a max whose deadline has passed. Each declined
-- seat goes to the waiting list through trg_participations_capacity. Idempotent; returns
-- the number of RSVPs it declined.
CREATE OR REPLACE FUNCTION kscw_capacity_maybe_deadline_sweep()
RETURNS integer
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_n integer;
BEGIN
  WITH due AS (
    SELECT 'training'::text AS atype, t.id::text AS aid
      FROM trainings t
     WHERE t.max_participants > 0 AND NOT t.cancelled AND t.respond_by IS NOT NULL
       AND t.date >= (now() AT TIME ZONE 'Europe/Zurich')::date
       AND kscw_capacity_effective_deadline(t.respond_by, t.start_time) < now()
    UNION ALL
    SELECT 'event'::text, e.id::text
      FROM events e
     WHERE e.max_players > 0 AND NOT e.cancelled AND e.respond_by IS NOT NULL
       AND (e.start_date IS NULL OR COALESCE(e.end_date, e.start_date) >= now())
       AND kscw_capacity_effective_deadline(e.respond_by, (e.start_date AT TIME ZONE 'Europe/Zurich')::time) < now()
  )
  UPDATE participations p
     SET status = 'declined'
    FROM due
   WHERE p.activity_type = due.atype
     AND p.activity_id = due.aid
     AND NOT p.is_staff
     AND (p.status = 'tentative' OR (p.status = 'waitlisted' AND p.requested_status = 'tentative'));
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

-- ── Directus admin metadata ───────────────────────────────────────────
INSERT INTO directus_fields (collection, field, interface, options, readonly, hidden, sort, width, note)
SELECT 'participations', 'requested_status', 'input', NULL::json, true, false, NULL::integer, 'half',
       'System-set: the answer (Yes or Maybe) this RSVP holds a seat with — kept while on the waiting list.'
WHERE NOT EXISTS (
  SELECT 1 FROM directus_fields WHERE collection = 'participations' AND field = 'requested_status'
);
INSERT INTO directus_fields (collection, field, interface, options, readonly, hidden, sort, width, note)
SELECT 'participations', 'promoted_at', 'datetime', NULL::json, true, false, NULL::integer, 'half',
       'System-set: when this RSVP moved up from the waiting list to a seat.'
WHERE NOT EXISTS (
  SELECT 1 FROM directus_fields WHERE collection = 'participations' AND field = 'promoted_at'
);

COMMIT;

-- Verification (dev/prod):
--   \d participations                                   -- requested_status, promoted_at
--   SELECT kscw_capacity_maybe_deadline_sweep();        -- 0 when no capped activity is past its deadline
