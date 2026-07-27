-- Migration 250 — games natural key, sync join keys, and the silent
-- un-cancel notification hole
--
-- Context (DB review 2026-07-27, findings GAMES-02, GAMES-10, GAMES-12,
-- GAMES-01 trigger half, GAMES-07 games half).
--
-- GAMES-02 — every writer treats (game_id, kscw_team) as the row identity
-- (reconcileBookingsToGames upsert, delete-booking update, sv-sync feed
-- pairing), and the intentional derby convention is exactly two rows per
-- game_id, one per KSCW team — but the only protection against a third
-- accidental row was a log.warn. games.game_id had no index of any kind.
-- The partial unique index below encodes the convention: derby pairs pass
-- (different kscw_team), duplicates become hard errors, and the reconcile
-- lookups get an index for free.
--
-- GAMES-10 — svrz_number is the join key bridging svrz_games → games.game_id
-- ('vb_<svrz_number>'), unconstrained. GAMES-12 — hall_events.uid is the
-- gcal reconcile upsert key, unconstrained; hall_closures had no date-range
-- sanity CHECK.
--
-- GAMES-01 (trigger half) — trg_games_notify emits 'game_deleted' when a game
-- flips TO cancelled, but the reverse flip cancelled→scheduled with unchanged
-- date/time fell into the cosmetic-mute branch: the team was told the game is
-- gone, then it silently reappeared. New 'game_reinstated' branch (i18n key
-- added to all five locale files in the same change). The sync-side
-- preservation of local cancels ships separately in sv-sync/bp-sync.
--
-- GAMES-07 (games half) — games.status becomes CHECK-constrained. Vocabulary:
-- live data holds scheduled|completed; the app writes cancelled
-- (CancelActivityButton); 'postponed' is honored by existing coverage SQL
-- (migration 236's NOT IN) and bp-sync's STATUS_MAP maps Basketplan
-- withdrawals to it. Union: scheduled, completed, cancelled, postponed.
--
-- Schema + trigger; idempotent (safe to re-run).

BEGIN;

-- ── (1) Natural key (game_id, kscw_team) ─────────────────────────────────
-- Pre-dedupe guard for divergent clones (0 duplicate pairs live 2026-07-27):
-- keep the newest row (highest id) — the one the last sync maintained.
DELETE FROM games a USING games b
WHERE a.id < b.id
  AND a.game_id IS NOT NULL AND a.kscw_team IS NOT NULL
  AND a.game_id = b.game_id AND a.kscw_team = b.kscw_team;

CREATE UNIQUE INDEX IF NOT EXISTS games_gameid_team_uq
  ON games (game_id, kscw_team)
  WHERE game_id IS NOT NULL AND kscw_team IS NOT NULL;

-- ── (2) External join keys ───────────────────────────────────────────────
DELETE FROM svrz_games a USING svrz_games b
WHERE a.id < b.id AND a.svrz_number IS NOT NULL AND a.svrz_number = b.svrz_number;
CREATE UNIQUE INDEX IF NOT EXISTS svrz_games_svrz_number_uq
  ON svrz_games (svrz_number) WHERE svrz_number IS NOT NULL;

DELETE FROM hall_events a USING hall_events b
WHERE a.id < b.id AND a.uid IS NOT NULL AND a.uid = b.uid;
CREATE UNIQUE INDEX IF NOT EXISTS hall_events_uid_uq
  ON hall_events (uid) WHERE uid IS NOT NULL;

-- hall_closures range sanity (0 violations live; NULL-tolerant).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'hall_closures_range_chk' AND conrelid = 'hall_closures'::regclass
  ) THEN
    ALTER TABLE hall_closures
      ADD CONSTRAINT hall_closures_range_chk
      CHECK (start_date IS NULL OR end_date IS NULL OR end_date >= start_date);
  END IF;
END $$;

-- ── (3) games.status vocabulary ──────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'games_status_chk' AND conrelid = 'games'::regclass
  ) THEN
    ALTER TABLE games
      ADD CONSTRAINT games_status_chk
      CHECK (status IS NULL OR status IN ('scheduled', 'completed', 'cancelled', 'postponed'));
  END IF;
END $$;

-- ── (4) trg_games_notify: notify the un-cancel ───────────────────────────
-- Full replacement of the function; only the cancelled→(re)scheduled branch
-- is new — everything else is byte-for-byte the deployed behavior.
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
    ELSIF OLD.status = 'cancelled' AND NEW.status = 'scheduled' THEN
      -- Un-cancel: the team was told "game cancelled" — a silent reappearance
      -- (previously the cosmetic-mute branch when date/time were unchanged)
      -- must not happen. completed is handled above; cancelled→postponed
      -- deliberately does NOT announce "reinstated" (still not happening).
      v_type := 'activity_change'; v_title := 'game_reinstated';
      v_body := json_build_object(
        'home_team', COALESCE(NEW.home_team, ''), 'away_team', COALESCE(NEW.away_team, ''),
        'date', COALESCE(to_char(NEW.date, 'DD.MM.YY'), ''),
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

COMMIT;
