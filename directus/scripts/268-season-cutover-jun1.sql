-- 268 — Align kscw_current_season_start() with the Jun 1 season cutover
--
-- The club rolls over to the next season on **Jun 1** (Swiss Volley publishes
-- new-season fixtures in June). The JS has said so for a while:
--
--   src/utils/dateHelpers.ts        getCurrentSeason()      month < 5  → prev season
--   gameScheduling/…/formatSeason   currentSeasonLong()     same
--   kscw-endpoints                  event-notify.js / forms.js / clubdesk-update.js
--                                                            same (local copies)
--
-- but kscw_current_season_start() (migration 069) still used a **Sep 1**
-- cutover, and its COMMENT claimed it mirrored getCurrentSeason() — which had
-- stopped being true. Between June and August the two disagreed about which
-- season we are in *by a whole season*:
--
--   on 2026-07-29   JS  → 2026/27  (season start 2026-09-01)
--                   PG  → 2025/26  (season start 2025-09-01)
--
-- Surfaced 2026-07-29 while bounding the iCal feed to the current season: had
-- the feed anchored on the PG function it would have kept serving all of
-- 2025/26 — exactly the duties the floor exists to remove — so ical-feed.js
-- reimplemented the JS cutover locally rather than call this. This migration
-- removes the reason for that divergence.
--
-- Idempotent: CREATE OR REPLACE only, no DDL, no data. Safe to re-run.

-- ── kscw_current_season_start() — cutover month only ─────────────────────────
-- Return value is unchanged in kind (still Sep 1 of the current season); only
-- WHICH season that is changes, for the Jun–Aug window.
CREATE OR REPLACE FUNCTION kscw_current_season_start()
RETURNS date AS $$
DECLARE
  v_now date := (now() AT TIME ZONE 'Europe/Zurich')::date;
  v_year int := EXTRACT(YEAR FROM v_now)::int;
  v_month int := EXTRACT(MONTH FROM v_now)::int;
BEGIN
  -- JS getMonth() is 0-indexed (May=4, Jun=5); PG EXTRACT MONTH is 1-indexed.
  -- JS check: month < 5 (Jan–May) → previous Sep.
  -- PG equivalent: month <= 5 (Jan–May) → previous Sep. Jun flips both ways:
  -- JS month 5 (Jun) < 5 = false; PG month 6 (Jun) <= 5 = false. Aligned.
  IF v_month <= 5 THEN
    RETURN make_date(v_year - 1, 9, 1);
  ELSE
    RETURN make_date(v_year, 9, 1);
  END IF;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION kscw_current_season_start() IS
  'Sep 1 of the current season, where "current" flips on the Jun 1 cutover (migration 268). Mirrors getCurrentSeason() in src/utils/dateHelpers.ts — keep the two in lockstep. NOTE between Jun 1 and Aug 31 this returns a date in the FUTURE (the season has rolled over but its fixture calendar has not started); callers that need a window START must not anchor on it naked — see kscw_fine_window_start. STABLE (not IMMUTABLE — depends on now()); do not use in indexes or generated columns.';

-- ── kscw_fine_window_start() — close the Jun–Aug hole ────────────────────────
-- With the Jun 1 cutover, 'season' can no longer anchor on Sep 1: from Jun 1 to
-- Aug 31 that date is in the future, so every offense committed over the summer
-- would sort BEFORE the window start and never be counted — a fine issued
-- 2026-07-10 would sit outside the 2026/27 window forever.
--
-- The counter therefore resets on the rollover date itself (Jun 1 = season start
-- − 3 months), which is stable within the season and derives from the same single
-- source. Every other branch is byte-identical to 069.
CREATE OR REPLACE FUNCTION kscw_fine_window_start(p_window text, p_ts timestamptz)
RETURNS timestamptz AS $$
BEGIN
  CASE p_window
    WHEN 'calendar_month' THEN
      RETURN date_trunc('month', p_ts AT TIME ZONE 'Europe/Zurich')
             AT TIME ZONE 'Europe/Zurich';
    WHEN 'rolling_30d' THEN
      RETURN p_ts - interval '30 days';
    WHEN 'rolling_90d' THEN
      RETURN p_ts - interval '90 days';
    WHEN 'season' THEN
      RETURN (((kscw_current_season_start() - interval '3 months')::date)::timestamp
              AT TIME ZONE 'Europe/Zurich');
    WHEN 'never' THEN
      RETURN 'epoch'::timestamptz;
    ELSE
      -- Unknown window — be conservative and count everything.
      RETURN 'epoch'::timestamptz;
  END CASE;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION kscw_fine_window_start(text, timestamptz) IS
  'Start timestamp of the offense-counter window for a fine_rules.reset_window value. calendar_month anchors to the 1st of the month; season anchors to the Jun 1 season rollover (migration 268 — NOT Sep 1, which is in the future for a third of the season and would drop every summer offense); rolling windows subtract N days from now. All wall-clock anchors are Europe/Zurich.';

-- 071 set an explicit search_path on both functions; CREATE OR REPLACE drops it,
-- so re-apply (idempotent, and keeps the 071 hardening intact).
ALTER FUNCTION kscw_current_season_start() SET search_path = public;
ALTER FUNCTION kscw_fine_window_start(text, timestamptz) SET search_path = public;
