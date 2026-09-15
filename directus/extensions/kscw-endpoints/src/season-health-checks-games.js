/**
 * Season health — games, fixtures and scheduling.
 *
 * What "this season" means here: `games.season = {{season}}` (the short label
 * every member-facing surface filters on) for inventory-style checks (team
 * has fixtures, rankings), and `THIS_SEASON` (label OR date since the Jun-1
 * rollover) for row-level hygiene. Summer fixtures (Jun–Aug) carry LAST
 * season's label by the syncs' Sep-1 rule, so a label-only scope silently
 * skips an August cup tie — `games_season_label_invalid` accepts both
 * derivations instead of flagging them. Checks about UPCOMING games anchor on
 * `{{today}}` and ignore the label altogether.
 *
 * Conventions every check below honours (see the gotchas in the domain brief):
 *   - `COALESCE(g.status,'scheduled')` — NULL status is upcoming (LIVE_GAME).
 *   - A derby is TWO `games` rows per `game_id` (one per KSCW team, home +
 *     away, both with our hall). Pairs sharing `game_id` or the same
 *     home/away labels are never a duplicate or a hall clash.
 *   - `games.type` is 'home'|'away'; there is no is_home / cup / confirmed column.
 *   - Sport comes from `lower(t.sport)` only. For rows with no team the feed
 *     key says: 'vb_…' / swiss_volley → volleyball, 'bb_…' / basketplan → basketball.
 *   - Scheduling tables key on `game_scheduling_seasons.id`, resolved by
 *     SCHED_SEASON (label match first, then status='open', then newest —
 *     the same pick the Terminplanung frontend makes). On dev the only row is
 *     status='closed' with the SHORT label, so a bare status='open' filter
 *     silently empties every scheduling check.
 *   - Basketball floor claims are read ONLY through `bb_floor_claims_all`.
 *   - `proposed_datetime_*` are Zurich wall-clock stored as UTC →
 *     `AT TIME ZONE 'UTC'`; `svrz_games.starting_date_time` is a true instant
 *     → `AT TIME ZONE 'Europe/Zurich'`.
 */
import {
  ACTIVE_TEAM, SQUAD_TEAM, LIVE_GAME, UPCOMING_GAME, GAME_COLS, TEAM_COLS,
} from './season-health-sql.js'

// ── Local helpers (games-domain only) ──────────────────────────────────

/**
 * The scheduling season every Terminplanung table's integer `season` FK
 * points to. Label match beats status beats recency, so a closed current
 * season still resolves and a stale 'open' row from last year does not win.
 * The LIMIT is on this one-row lookup, not on the check's result set.
 */
const SCHED_SEASON = `(
  SELECT ss.* FROM game_scheduling_seasons ss
   ORDER BY (ss.season = {{season}} OR ss.season = left({{season}}, 5) || '20' || right({{season}}, 2)) DESC,
            (ss.status = 'open') DESC, ss.id DESC
   LIMIT 1
)`

/** Both sides KSCW — the intra-club derby shape. Alias games as `g`. */
const DERBY_ROW = `(g.home_team ILIKE '%wiedikon%' AND g.away_team ILIKE '%wiedikon%')`

/** Sport of a feed row when there is no team to ask. Alias games as `g`. */
const FEED_SPORT = `CASE WHEN left(g.game_id, 3) = 'vb_' OR g.source = 'swiss_volley' THEN 'volleyball'
            WHEN left(g.game_id, 3) = 'bb_' OR g.source = 'basketplan' THEN 'basketball' END`

/** Last season's short label, derived from {{season}} ('2026/27' → '2025/26'). */
const PREV_SEASON = `((left({{season}}, 4)::int - 1)::text || '/' || lpad((left({{season}}, 4)::int % 100)::text, 2, '0'))`

/** KWI floors a game occupies (hall + additional_halls). Alias games as `g`. */
const GAME_FLOORS = `vb_slot_floors(g.hall, g.additional_halls::jsonb)`

/** Zurich wall-clock text for a timestamptz column. */
const ZTS = (col) => `to_char(${col} AT TIME ZONE 'Europe/Zurich', 'YYYY-MM-DD HH24:MI')`

/**
 * "This season's row" for checks that are not anchored on an upcoming date:
 * the current label, OR any date since the Jun-1 rollover. The second leg
 * matters because Jun–Aug sync fixtures carry LAST season's label (Sep-1
 * rule) and would otherwise vanish from every label-scoped check. Alias
 * games as `g`.
 */
const THIS_SEASON = `(g.season = {{season}} OR g.date >= {{rollover}})`

const GAME_ORDER = `ORDER BY g.date NULLS FIRST, g.time NULLS FIRST, g.id`

export const CHECKS = [
  // ── Fixture inventory ──────────────────────────────────────────────
  {
    key: 'games_team_zero_fixtures',
    section: 'games',
    sport: 'both',
    severity: 'warn',
    grain: 'team',
    title: 'Active team with no games this season',
    description: 'An active team has no games row carrying the current season label. Volleyball teams get their fixtures in June, so this usually means a blank teams.team_id, a team missing from the SV_TEAM_IDS allow-list in sv-sync.js, or the sync resolving to an archived row. Basketball leagues publish per league and tournament formats (no basketball_team_rules row) never get home fixtures — has_bb_rules tells the two apart.',
    sql: `
SELECT ${TEAM_COLS}, t.league,
       COALESCE(NULLIF(t.team_id, ''), NULLIF(t.bb_source_id, '')) AS sync_key,
       EXISTS (SELECT 1 FROM basketball_team_rules r WHERE r.team = t.id) AS has_bb_rules,
       (t.clubdesk_group = '') AS is_umbrella,
       (SELECT count(*) FROM games g WHERE g.kscw_team = t.id AND g.season = ${PREV_SEASON})::int AS games_last_season,
       (SELECT ${ZTS('sr.last_run_at')} FROM sync_runs sr
         WHERE sr.source = CASE lower(t.sport) WHEN 'volleyball' THEN 'sv_sync' WHEN 'basketball' THEN 'bp_sync' END) AS feed_last_run
FROM teams t
WHERE ${ACTIVE_TEAM}
  AND NOT EXISTS (SELECT 1 FROM games g WHERE g.kscw_team = t.id AND g.season = {{season}})
ORDER BY lower(t.sport), t.name`,
  },
  {
    key: 'games_orphan_no_team',
    section: 'games',
    sport: 'both',
    severity: 'error',
    grain: 'game',
    title: 'Games with no KSCW team',
    description: 'A games row with kscw_team NULL is invisible on every team-scoped surface (home page, calendar, RSVP, duties) and escapes the natural-key index. It comes from a team lookup miss at sync time — the feed key (team_id / bb_source_id) is not on any active team. Fix the team key and re-run the sync, or set kscw_team by hand.',
    sql: `
SELECT ${GAME_COLS}, ${FEED_SPORT} AS sport,
       g.source, g.season, COALESCE(g.status, 'scheduled') AS status, g.game_id AS fixture_key
FROM games g
WHERE g.kscw_team IS NULL
  AND (g.season = {{season}} OR g.date >= {{today}} - 60)
${GAME_ORDER}`,
  },
  {
    key: 'games_team_inactive',
    section: 'games',
    sport: 'both',
    severity: 'error',
    grain: 'game',
    title: 'Current-season games on an archived team',
    description: 'A game labelled with the current season (or any upcoming game) points at an inactive team, so no active roster sees it. Completed games of past seasons stay on their archived team on purpose and are not listed. When active_successor is set the next sync re-points the row (kscw_team is compared); when it is empty no active team carries the feed key and the fixture stays orphaned until the successor team is created or keyed.',
    sql: `
SELECT ${GAME_COLS}, ${TEAM_COLS}, g.source, g.season, t.season AS team_season,
       (SELECT t2.name FROM teams t2
         WHERE t2.active = true AND t2.id <> t.id
           AND ((COALESCE(t.team_id, '') <> '' AND t2.team_id = t.team_id)
             OR (COALESCE(t.bb_source_id, '') <> '' AND t2.bb_source_id = t.bb_source_id))
         ORDER BY t2.id LIMIT 1) AS active_successor
FROM games g
JOIN teams t ON t.id = g.kscw_team
WHERE t.active = false
  AND (g.season = {{season}} OR g.date >= {{today}})
ORDER BY lower(t.sport), t.name, g.date NULLS FIRST, g.time NULLS FIRST, g.id`,
  },
  {
    key: 'games_sport_source_mismatch',
    section: 'games',
    sport: 'both',
    severity: 'error',
    grain: 'game',
    title: 'Game source contradicts the team’s sport',
    description: 'A Swiss Volley row (vb_… / swiss_volley) sits on a basketball team or a Basketplan row (bb_… / basketplan) on a volleyball team — a mis-keyed teams.team_id / bb_source_id or a hand edit pointed a feed at the wrong squad. Floor claims and duty logic key off teams.sport, so everything downstream is wrong for that game.',
    sql: `
SELECT ${GAME_COLS}, ${TEAM_COLS}, g.source, g.season, ${FEED_SPORT} AS feed_sport
FROM games g
JOIN teams t ON t.id = g.kscw_team
WHERE ${THIS_SEASON}
  AND ((left(g.game_id, 3) = 'vb_' AND lower(t.sport) IS DISTINCT FROM 'volleyball')
    OR (left(g.game_id, 3) = 'bb_' AND lower(t.sport) IS DISTINCT FROM 'basketball')
    OR (g.source = 'swiss_volley' AND lower(t.sport) IS DISTINCT FROM 'volleyball')
    OR (g.source = 'basketplan' AND lower(t.sport) IS DISTINCT FROM 'basketball'))
${GAME_ORDER}`,
  },
  {
    key: 'games_missing_datetime',
    section: 'games',
    sport: 'both',
    severity: 'warn',
    grain: 'game',
    title: 'Upcoming games without a date or time',
    description: 'An upcoming fixture has no date, no time, or Basketplan’s 00:00 placeholder. A basketball home game without a time blocks its KWI floor all day; a volleyball game without a date usually means the opponent has not agreed one yet (see the scheduling checks). Never delete such rows — the next sync recreates them; fix the value at the source.',
    // Dated rows are anchored on today, not the season label: a summer
    // fixture carries last season's label (Sep-1 rule) and would be skipped.
    // Undated rows have nothing but the label to anchor on.
    sql: `
SELECT ${GAME_COLS}, ${TEAM_COLS}, g.source, g.season,
       (g.date IS NULL) AS no_date,
       (g.time IS NULL) AS no_time,
       COALESCE(g.time = TIME '00:00', false) AS placeholder_time
FROM games g
JOIN teams t ON t.id = g.kscw_team
WHERE ${LIVE_GAME}
  AND ((g.date IS NULL AND g.season = {{season}})
    OR (g.date >= {{today}} AND (g.time IS NULL OR g.time = TIME '00:00')))
ORDER BY lower(t.sport), g.date NULLS FIRST, t.name, g.id`,
  },
  {
    key: 'games_home_without_hall',
    section: 'games',
    sport: 'both',
    severity: 'error',
    grain: 'game',
    title: 'Upcoming home games with no hall',
    description: 'A home game with hall NULL shows no venue, cannot be pushed to VolleyManager with a gym and — for basketball — claims no KWI floor, so volleyball may book the same court. Volleyball: halls.sv_hall_id is missing for the feed’s hall id. Basketball: bp-sync only maps the two "Kantonsschule Wiedikon" location spellings; any other spelling lands NULL.',
    sql: `
SELECT ${GAME_COLS}, ${TEAM_COLS}, g.source, g.season
FROM games g
JOIN teams t ON t.id = g.kscw_team
WHERE g.type = 'home' AND g.hall IS NULL
  AND ${UPCOMING_GAME}
${GAME_ORDER}`,
  },
  {
    key: 'games_type_venue_mismatch',
    section: 'games',
    sport: 'both',
    severity: 'warn',
    grain: 'game',
    title: 'Away game at a KSCW hall or home game with an away venue',
    description: 'The type and venue columns disagree: an away game carries one of our halls (floor claims and duty logic will treat it as home) or a home game carries an away_hall_json. Derby rows are excluded — the away leg legitimately sits in our hall. Usually a hand edit that flipped type without clearing the other column.',
    sql: `
SELECT ${GAME_COLS}, ${TEAM_COLS}, g.source, h.name AS hall,
       (g.away_hall_json IS NOT NULL AND g.away_hall_json::text NOT IN ('null', '{}')) AS has_away_venue
FROM games g
JOIN teams t ON t.id = g.kscw_team
LEFT JOIN halls h ON h.id = g.hall
WHERE ${THIS_SEASON}
  AND ((g.type = 'away' AND g.hall IS NOT NULL AND NOT ${DERBY_ROW})
    OR (g.type = 'home' AND g.away_hall_json IS NOT NULL AND g.away_hall_json::text NOT IN ('null', '{}')))
${GAME_ORDER}`,
  },
  {
    key: 'games_past_no_result',
    section: 'games',
    sport: 'both',
    severity: 'warn',
    grain: 'game',
    title: 'Played games without a result',
    description: 'A synced game played since the Jun-1 rollover, more than two days ago, is still scheduled: either the referee or home club has not filed the result upstream, or the feed is dead — feed_status / feed_last_run say which, and one stale sync explains every row at once. Manual games are listed separately (games_past_no_result_manual).',
    // Anchored on the date, not the label: an August cup tie carries LAST
    // season's label (Sep-1 rule) and must still get its result. A NULL
    // source is not 'manual' — without the COALESCE it fell through both checks.
    sql: `
SELECT ${GAME_COLS}, ${TEAM_COLS}, g.source, g.season, COALESCE(g.status, 'scheduled') AS status,
       ({{today}} - g.date)::int AS days_ago,
       sr.status AS feed_status,
       ${ZTS('sr.last_run_at')} AS feed_last_run
FROM games g
JOIN teams t ON t.id = g.kscw_team
LEFT JOIN sync_runs sr
       ON sr.source = CASE lower(t.sport) WHEN 'volleyball' THEN 'sv_sync' WHEN 'basketball' THEN 'bp_sync' END
WHERE g.date >= {{rollover}}
  AND COALESCE(g.source, '') <> 'manual'
  AND g.date < {{today}} - 2
  AND ${LIVE_GAME}
ORDER BY g.source, g.date, g.time NULLS FIRST, g.id`,
  },
  {
    key: 'games_past_no_result_manual',
    section: 'games',
    sport: 'both',
    severity: 'info',
    grain: 'game',
    title: 'Manual games in the past still marked scheduled',
    description: 'A manually entered game is invisible to both syncs, so no feed will ever complete it. Enter the score and mark it completed (or cancelled) by hand; basketball placeholders that Basketplan has since published should have been retired by the bp-sync sweep — cross-check with bb_manual_placeholders_outstanding.',
    sql: `
SELECT ${GAME_COLS}, ${TEAM_COLS}, g.season, COALESCE(g.status, 'scheduled') AS status,
       ({{today}} - g.date)::int AS days_ago, g.home_score, g.away_score
FROM games g
JOIN teams t ON t.id = g.kscw_team
WHERE g.date >= {{rollover}}
  AND g.source = 'manual'
  AND g.date < {{today}} - 2
  AND ${LIVE_GAME}
ORDER BY g.date, g.time NULLS FIRST, g.id`,
  },
  {
    key: 'games_season_label_invalid',
    section: 'games',
    sport: 'both',
    severity: 'error',
    grain: 'game',
    title: 'Season label malformed or inconsistent with the date',
    description: 'games.season is NULL, not the short YYYY/YY form (e.g. the SVRZ long form 2026/2027), or matches neither the Sep-1 derivation the syncs use nor the Jun-1 derivation manual entry uses. Such a row saves fine and is invisible on the home page, games list and website (exact match on the label). Rewrite the season to one of the two expected labels shown.',
    sql: `
SELECT ${GAME_COLS}, t.id AS team_id, t.name AS team, COALESCE(lower(t.sport), ${FEED_SPORT}) AS sport,
       g.source, g.season, x.sep1_label AS expected_feed_label, x.jun1_label AS expected_manual_label
FROM games g
LEFT JOIN teams t ON t.id = g.kscw_team
CROSS JOIN LATERAL (
  SELECT (EXTRACT(YEAR FROM g.date)::int - CASE WHEN EXTRACT(MONTH FROM g.date) < 9 THEN 1 ELSE 0 END) AS y9,
         (EXTRACT(YEAR FROM g.date)::int - CASE WHEN EXTRACT(MONTH FROM g.date) < 6 THEN 1 ELSE 0 END) AS y6
) yy
CROSS JOIN LATERAL (
  SELECT yy.y9::text || '/' || lpad(((yy.y9 + 1) % 100)::text, 2, '0') AS sep1_label,
         yy.y6::text || '/' || lpad(((yy.y6 + 1) % 100)::text, 2, '0') AS jun1_label
) x
WHERE (g.season IS NULL
       OR g.season !~ '^[0-9]{4}/[0-9]{2}$'
       OR (g.date IS NOT NULL AND g.season NOT IN (x.sep1_label, x.jun1_label)))
  AND (g.season IS NULL OR g.season !~ '^[0-9]{4}/[0-9]{2}$' OR g.season = {{season}} OR g.date >= {{rollover}})
${GAME_ORDER}`,
  },
  {
    key: 'games_status_null',
    section: 'games',
    sport: 'both',
    severity: 'warn',
    grain: 'game',
    title: 'Games with no status',
    description: 'NULL is allowed by the status CHECK but the code base disagrees on what it means: the auto-confirm and nomination sweeps treat it as upcoming while the stats views and the nomination index exclude it. Set it to scheduled (or completed with the score) so every surface agrees. Scoped to this season (label, date since Jun 1, or no date at all).',
    sql: `
SELECT ${GAME_COLS}, t.id AS team_id, t.name AS team, COALESCE(lower(t.sport), ${FEED_SPORT}) AS sport,
       g.source, g.season, g.home_score, g.away_score
FROM games g
LEFT JOIN teams t ON t.id = g.kscw_team
WHERE g.status IS NULL
  AND (${THIS_SEASON} OR g.date IS NULL)
${GAME_ORDER}`,
  },
  {
    key: 'games_postponed_future_date',
    section: 'games',
    sport: 'both',
    severity: 'warn',
    grain: 'game',
    title: 'Postponed game that now carries a future date',
    description: 'A game marked postponed sits on a date that has not come yet. sv-sync keeps a local postponed across runs (applyLocalGuards), so when the league sets the new date the feed moves the row but the status stays postponed — the game is invisible as upcoming (no calendar, no RSVP, no duties). If the date shown is the NEW one, set the status back to scheduled; if it is still the old one, VolleyManager has not rescheduled yet. Basketplan rows are excluded: bp-sync owns their postponed state and flips it back itself.',
    sql: `
SELECT ${GAME_COLS}, t.id AS team_id, t.name AS team, COALESCE(lower(t.sport), ${FEED_SPORT}) AS sport,
       g.source, g.season, ${ZTS('g.date_updated')} AS last_updated
FROM games g
LEFT JOIN teams t ON t.id = g.kscw_team
WHERE g.status = 'postponed'
  AND g.date >= {{today}}
  AND COALESCE(g.source, '') <> 'basketplan'
${GAME_ORDER}`,
  },
  {
    key: 'games_derby_pair_incomplete',
    section: 'games',
    sport: 'both',
    severity: 'error',
    grain: 'game',
    title: 'Intra-club fixture with the wrong number of rows',
    description: 'The two-rows-per-derby convention is broken: a fixture key with three or more rows (sv-sync leaves surplus intra-club rows for a human to dedupe), an all-KSCW fixture with only one row (the other squad has no calendar entry, no RSVP, no auto-confirm), two rows for a fixture whose labels are not both KSCW (a duplicate — the natural key only covers rows with a team), or two rows that are both home or both away. Which row belongs to which team is decided by whose RSVPs hang off it — never auto-delete.',
    sql: `
SELECT min(g.id) AS game_id, min(g.date)::text AS date, to_char(min(g.time), 'HH24:MI') AS time,
       string_agg(DISTINCT g.type, '/') AS home_away,
       min(g.home_team) AS home_team, min(g.away_team) AS away_team, min(g.league) AS league,
       CASE WHEN left(g.game_id, 3) = 'vb_' THEN 'volleyball'
            WHEN left(g.game_id, 3) = 'bb_' THEN 'basketball'
            ELSE min(lower(t.sport)) END AS sport,
       g.game_id AS fixture_key,
       count(*)::int AS row_count,
       string_agg(COALESCE(t.name, '?') || ' (' || COALESCE(g.type, '?') || ')', ', ' ORDER BY g.id) AS sides,
       CASE WHEN count(*) > 2 THEN 'surplus rows'
            WHEN count(*) = 1 THEN 'second squad has no row'
            WHEN NOT bool_and(${DERBY_ROW}) THEN 'two rows for a non-derby fixture'
            ELSE 'both rows on the same side' END AS problem
FROM games g
LEFT JOIN teams t ON t.id = g.kscw_team
WHERE g.game_id IS NOT NULL AND ${THIS_SEASON}
GROUP BY g.game_id
HAVING count(*) > 2
    OR (count(*) = 1 AND bool_and(${DERBY_ROW}))
    OR (count(*) = 2 AND (count(DISTINCT g.type) < 2 OR NOT bool_and(${DERBY_ROW})))
ORDER BY min(g.date) NULLS FIRST, g.game_id`,
  },

  // ── Halls and floors ───────────────────────────────────────────────
  {
    key: 'bb_home_no_floor_claim',
    section: 'games',
    sport: 'bb',
    severity: 'error',
    grain: 'game',
    title: 'Basketball home game at KWI without a floor claim',
    description: 'A basketball home game whose hall resolves to KWI floors has no basketball_game_floor_claims rows, so volleyball scheduling cannot see the court is taken. The trigger only fires on insert or on updates of type/date/time/hall/additional_halls/kscw_team — a team whose sport changed afterwards claims nothing. A no-op UPDATE games SET hall = hall WHERE id = … re-fires it.',
    sql: `
SELECT ${GAME_COLS}, ${TEAM_COLS}, g.source, h.name AS hall,
       array_to_string(${GAME_FLOORS}, '+') AS floors
FROM games g
JOIN teams t ON t.id = g.kscw_team AND lower(t.sport) = 'basketball'
LEFT JOIN halls h ON h.id = g.hall
WHERE g.type = 'home'
  AND ${UPCOMING_GAME}
  AND cardinality(${GAME_FLOORS}) > 0
  AND NOT EXISTS (SELECT 1 FROM basketball_game_floor_claims c WHERE c.game = g.id)
${GAME_ORDER}`,
  },
  {
    key: 'bb_floor_double_claim',
    section: 'games',
    sport: 'bb',
    severity: 'error',
    grain: 'game',
    title: 'Two basketball games claiming the same KWI floor and tip-off',
    description: 'Two different games rows hold the same date, time and floor. A plan + game pair for one physical game is legitimate and excluded; two games rows means a manual placeholder the sweep did not retire next to its Basketplan twin, or a genuine double booking Basketplan published. The claims view is intentionally non-unique, so nothing else refuses this. Games without a time (claim time empty — a tournament day, say) are not compared here; games_missing_datetime lists them.',
    sql: `
SELECT a.ref_id AS game_id, a.date::text AS date, a.time AS time, 'home' AS home_away,
       a.bb_team AS home_team, a.bb_opponent AS away_team, 'basketball' AS sport,
       a.bb_team AS team, a.bb_hall AS hall,
       string_agg(a.floor, '+' ORDER BY a.floor) AS floors,
       b.ref_id AS other_game, b.bb_team AS other_team, b.bb_opponent AS other_opponent
FROM bb_floor_claims_all a
JOIN bb_floor_claims_all b
  ON b.date = a.date AND b.time = a.time AND b.floor = a.floor
 AND b.source = 'game' AND a.ref_id < b.ref_id
WHERE a.source = 'game' AND a.date >= {{today}} AND a.time <> ''
GROUP BY a.ref_id, a.date, a.time, a.bb_team, a.bb_opponent, a.bb_hall, b.ref_id, b.bb_team, b.bb_opponent
ORDER BY a.date, a.time, a.ref_id, b.ref_id`,
  },
  {
    key: 'bb_floor_claim_from_dead_game',
    section: 'games',
    sport: 'bb',
    severity: 'warn',
    grain: 'game',
    title: 'Cancelled or postponed basketball game still holding a KWI floor',
    description: 'The claim trigger fires on type/date/time/hall/team changes only, never on status, so a basketball home game that was cancelled or postponed keeps its basketball_game_floor_claims rows — and volleyball scheduling (which reads the claims view with no status filter) refuses to offer that court for a game that will not happen. Move the row’s date (a postponed game) or clear its hall (a cancelled one); either re-fires the trigger and frees the floor.',
    sql: `
SELECT ${GAME_COLS}, ${TEAM_COLS}, g.source, g.status, h.name AS hall,
       string_agg(c.floor, '+' ORDER BY c.floor) AS floors
FROM games g
JOIN teams t ON t.id = g.kscw_team
LEFT JOIN halls h ON h.id = g.hall
JOIN basketball_game_floor_claims c ON c.game = g.id
WHERE g.status IN ('cancelled', 'postponed')
  AND g.date >= {{today}}
GROUP BY g.id, t.id, h.name
${GAME_ORDER}`,
  },
  {
    key: 'vb_home_vs_bb_floor_conflict',
    section: 'games',
    sport: 'vb',
    severity: 'error',
    grain: 'game',
    title: 'Volleyball home game on a court basketball holds',
    description: 'A volleyball home game in games (including ones with no booked slot, which the basketball grid cannot see) overlaps a basketball floor claim under the same rule game-scheduling uses (volleyball start −30 min … end +30 min against tip-off … +120 min). A volleyball game with no time matches everything that day on purpose — fix the time first. When the booked slot sits on another court than the games row says, the drift is the real defect (sched_game_mirror_drift).',
    sql: `
SELECT ${GAME_COLS}, ${TEAM_COLS}, h.name AS hall,
       fc.bb_team, fc.bb_opponent, fc.time AS bb_tip_off,
       string_agg(DISTINCT fc.floor, '+') AS floors,
       string_agg(DISTINCT fc.source, '+') AS bb_source
FROM games g
JOIN teams t ON t.id = g.kscw_team AND lower(t.sport) = 'volleyball'
LEFT JOIN halls h ON h.id = g.hall
JOIN bb_floor_claims_all fc
  ON fc.date = g.date
 AND fc.floor = ANY (${GAME_FLOORS})
 AND bb_vb_time_overlap(g.time, NULL::time, fc.time)
WHERE g.type = 'home'
  AND ${UPCOMING_GAME}
GROUP BY g.id, t.id, h.name, fc.bb_team, fc.bb_opponent, fc.time
ORDER BY g.date, g.time NULLS FIRST, g.id, fc.time`,
  },
  {
    key: 'games_hall_double_booked',
    section: 'games',
    sport: 'both',
    severity: 'error',
    grain: 'game',
    title: 'Two games in the same hall at overlapping times',
    description: 'Two distinct fixtures of the same sport within two hours of each other in the same hall or on overlapping KWI floors (A+B against A or B). Derby pairs (same fixture key or the same two KSCW labels) are skipped. Cross-sport clashes are covered by vb_home_vs_bb_floor_conflict. Typically two Saturday games pushed to VolleyManager after a rebalance failed.',
    sql: `
SELECT a.id AS game_id, a.date::text AS date, to_char(a.time, 'HH24:MI') AS time,
       a.type AS home_away, a.home_team, a.away_team, a.league,
       ta.id AS team_id, ta.name AS team, lower(ta.sport) AS sport,
       ha.name AS hall, b.id AS other_game, tb.name AS other_team,
       to_char(b.time, 'HH24:MI') AS other_time, hb.name AS other_hall
FROM games a
JOIN games b
  ON b.date = a.date AND b.id > a.id
 AND a.game_id IS DISTINCT FROM b.game_id
 AND NOT (a.home_team = b.home_team AND a.away_team = b.away_team)
 AND b.time IS NOT NULL
 AND abs(EXTRACT(EPOCH FROM (a.time - b.time))) < 7200
 AND b.hall IS NOT NULL
 AND COALESCE(b.status, 'scheduled') NOT IN ('completed', 'cancelled', 'postponed')
 AND (a.hall = b.hall OR vb_slot_floors(a.hall, a.additional_halls::jsonb) && vb_slot_floors(b.hall, b.additional_halls::jsonb))
LEFT JOIN teams ta ON ta.id = a.kscw_team
LEFT JOIN teams tb ON tb.id = b.kscw_team
LEFT JOIN halls ha ON ha.id = a.hall
LEFT JOIN halls hb ON hb.id = b.hall
WHERE a.hall IS NOT NULL AND a.time IS NOT NULL
  AND a.date >= {{today}}
  AND COALESCE(a.status, 'scheduled') NOT IN ('completed', 'cancelled', 'postponed')
  AND lower(ta.sport) IS NOT DISTINCT FROM lower(tb.sport)
ORDER BY a.date, a.time, a.id, b.id`,
  },
  {
    key: 'games_on_blocked_date',
    section: 'games',
    sport: 'both',
    severity: 'warn',
    grain: 'game',
    title: 'Upcoming game on a team block or club blackout',
    description: 'A fixture sits on a date the team (scheduling_blocks: home and away) or the club (scheduling_global_blocks: home only; no sport = both) declared unavailable. The scheduling engine refuses to offer such dates, but a feed reschedule, a manual game or a block added after booking all bypass it — the team will be short of players, which is what the block was for.',
    sql: `
SELECT * FROM (
  SELECT ${GAME_COLS}, ${TEAM_COLS}, 'team' AS block_kind, sb.reason,
         sb.start_date::text AS blocked_from, sb.end_date::text AS blocked_to
  FROM games g
  JOIN teams t ON t.id = g.kscw_team
  JOIN scheduling_blocks sb ON sb.team = g.kscw_team AND g.date BETWEEN sb.start_date AND sb.end_date
  WHERE ${UPCOMING_GAME}
  UNION ALL
  SELECT ${GAME_COLS}, ${TEAM_COLS}, 'club' AS block_kind, gb.reason,
         gb.start_date::text AS blocked_from, gb.end_date::text AS blocked_to
  FROM games g
  JOIN teams t ON t.id = g.kscw_team
  JOIN scheduling_global_blocks gb
    ON g.date BETWEEN gb.start_date AND gb.end_date
   AND (gb.sport IS NULL OR lower(gb.sport) = lower(t.sport))
  WHERE g.type = 'home' AND ${UPCOMING_GAME}
) q
ORDER BY q.date, q.time NULLS FIRST, q.game_id, q.block_kind, q.blocked_from`,
  },
  {
    key: 'games_home_on_hall_closure',
    section: 'games',
    sport: 'both',
    severity: 'error',
    grain: 'game',
    title: 'Home game inside a hall closure',
    description: 'The hall (or one of its additional halls) is closed on the day of a home game — school calendar, Schulferien or a manual closure. Booking refuses such dates, but closures synced later and feed-created games are never re-checked: move the game or override the closure (hall_events.closure_override).',
    sql: `
SELECT ${GAME_COLS}, ${TEAM_COLS}, g.source, h.name AS hall, ch.name AS closed_hall,
       c.reason, c.source AS closure_source,
       c.start_date::text AS closed_from, c.end_date::text AS closed_to
FROM games g
JOIN teams t ON t.id = g.kscw_team
LEFT JOIN halls h ON h.id = g.hall
JOIN hall_closures c
  ON g.date BETWEEN c.start_date AND COALESCE(c.end_date, c.start_date)
 AND (c.hall = g.hall
      OR EXISTS (SELECT 1
                   FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(g.additional_halls::jsonb) = 'array'
                                                       THEN g.additional_halls::jsonb ELSE '[]'::jsonb END) e
                  WHERE e = c.hall::text))
LEFT JOIN halls ch ON ch.id = c.hall
WHERE g.type = 'home' AND g.hall IS NOT NULL
  AND ${UPCOMING_GAME}
ORDER BY g.date, g.time NULLS FIRST, g.id, c.id`,
  },

  // ── Volleyball scheduling (Terminplanung) ──────────────────────────
  {
    key: 'sched_confirmed_booking_no_game_row',
    section: 'games',
    sport: 'vb',
    severity: 'error',
    grain: 'team',
    title: 'Confirmed booking not mirrored into games',
    description: 'A confirmed booking has no games row for its fixture and team — members see nothing on their calendar. "not mirrored": the fixture is known but reconcileBookingsToGames skipped it (home booking without a slot, away proposal with an unparsable datetime) — POST /kscw/terminplanung/admin/reconcile-games {season, silent:true}. "no fixture linked": svrz_game_id matches no synced fixture (SVRZ renamed the opponent) — relink the booking.',
    sql: `
SELECT t.id AS team_id, t.name AS team, 'volleyball' AS sport,
       CASE WHEN sg.id IS NULL THEN 'no fixture linked' ELSE 'not mirrored' END AS problem,
       b.type AS booking_type, o.team_name AS opponent, b.id AS booking_id,
       'vb_' || sg.svrz_number AS expected_fixture, sg.display_name AS fixture,
       ${ZTS('b.confirmed_at')} AS confirmed_at
FROM game_scheduling_bookings b
JOIN ${SCHED_SEASON} s ON s.id = b.season
JOIN game_scheduling_opponents o ON o.id = b.opponent
JOIN teams t ON t.id = o.kscw_team
LEFT JOIN svrz_games sg ON sg.svrz_persistence_id = b.svrz_game_id
WHERE b.status = 'confirmed'
  AND (sg.id IS NULL
       OR NOT EXISTS (SELECT 1 FROM games gm WHERE gm.game_id = 'vb_' || sg.svrz_number AND gm.kscw_team = o.kscw_team))
ORDER BY t.name, o.team_name, b.id`,
  },
  {
    key: 'sched_game_mirror_drift',
    section: 'games',
    sport: 'vb',
    severity: 'warn',
    grain: 'game',
    title: 'Mirrored game disagrees with its confirmed booking',
    description: 'The games row members see does not match what the Spielplaner confirmed: a home game on another hall than the booked slot (sv-sync never rewrites hall — FREEZE_HALLS — so a Saturday rebalance or a feed hall id that maps to the wrong court persists silently), or a date/time that differs from the agreed slot / away proposal while the booking still owns the date (before the season’s vm_authority_date; afterwards the feed’s date wins and only the hall is compared). Halls that share a VolleyManager gym (Döltschi 1/2) count as equal. Fix: reconcile-games re-applies the slot, or move the booking to where the game really is.',
    sql: `
WITH s AS (
  SELECT cur.id, (cur.vm_authority_date IS NOT NULL AND {{today}} >= cur.vm_authority_date) AS feed_owns
  FROM ${SCHED_SEASON} cur
),
x AS (
  SELECT b.id AS booking_id, o.kscw_team, 'home' AS side, sg.svrz_number, s.feed_owns,
         sl.date AS agreed_date,
         CASE WHEN EXTRACT(ISODOW FROM sl.date) BETWEEN 1 AND 5 THEN TIME '20:00' ELSE sl.start_time END AS agreed_time,
         sl.hall AS agreed_hall
  FROM game_scheduling_bookings b
  JOIN s ON s.id = b.season
  JOIN game_scheduling_opponents o ON o.id = b.opponent
  JOIN game_scheduling_slots sl ON sl.id = b.slot
  JOIN svrz_games sg ON sg.svrz_persistence_id = b.svrz_game_id
  WHERE b.type = 'home_slot_pick' AND b.status = 'confirmed'
  UNION ALL
  SELECT b.id, o.kscw_team, 'away', sg.svrz_number, s.feed_owns,
         w.agreed_wall::date, w.agreed_wall::time, NULL
  FROM game_scheduling_bookings b
  JOIN s ON s.id = b.season
  JOIN game_scheduling_opponents o ON o.id = b.opponent
  JOIN svrz_games sg ON sg.svrz_persistence_id = b.svrz_game_id
  CROSS JOIN LATERAL (
    SELECT (CASE b.confirmed_proposal WHEN 2 THEN b.proposed_datetime_2 WHEN 3 THEN b.proposed_datetime_3
                 ELSE b.proposed_datetime_1 END) AT TIME ZONE 'UTC' AS agreed_wall
  ) w
  WHERE b.type = 'away_proposal' AND b.status = 'confirmed' AND w.agreed_wall IS NOT NULL
)
SELECT ${GAME_COLS}, t.id AS team_id, t.name AS team, 'volleyball' AS sport,
       x.agreed_date::text AS agreed_date, to_char(x.agreed_time, 'HH24:MI') AS agreed_time,
       ha.name AS agreed_hall, hg.name AS game_hall,
       (g.date IS DISTINCT FROM x.agreed_date OR to_char(g.time, 'HH24:MI') IS DISTINCT FROM to_char(x.agreed_time, 'HH24:MI')) AS datetime_differs,
       x.booking_id
FROM x
JOIN teams t ON t.id = x.kscw_team
JOIN games g ON g.game_id = 'vb_' || x.svrz_number AND g.kscw_team = x.kscw_team
LEFT JOIN halls ha ON ha.id = x.agreed_hall
LEFT JOIN halls hg ON hg.id = g.hall
WHERE COALESCE(g.status, 'scheduled') NOT IN ('completed', 'cancelled')
  AND ((NOT x.feed_owns
        AND (g.date IS DISTINCT FROM x.agreed_date
             OR to_char(g.time, 'HH24:MI') IS DISTINCT FROM to_char(x.agreed_time, 'HH24:MI')))
    OR (x.side = 'home' AND g.hall IS DISTINCT FROM x.agreed_hall
        AND NOT COALESCE(NULLIF(ha.vm_hall_id, '') = NULLIF(hg.vm_hall_id, ''), false)))
ORDER BY g.date NULLS FIRST, g.time NULLS FIRST, g.id, x.booking_id`,
  },
  {
    key: 'sched_home_not_in_vm',
    section: 'games',
    sport: 'vb',
    severity: 'error',
    grain: 'game',
    title: 'Confirmed home game not in VolleyManager',
    description: 'Our agreed home slot is not what VolleyManager shows. Mirrors GET /admin/terminplanung/home-vm-check: a fixture VM already carries at our date/time is fine whatever the push status (league-approved fixtures reject pushes), after the season’s vm_authority_date the feed owns the date, and a VM mirror older than our push is lag, not drift. Left: not_pushed (push it), mismatch (VM re-scraped a different date after our push), no_slot (home booking with no slot).',
    sql: `
WITH s AS (SELECT * FROM ${SCHED_SEASON} cur),
x AS (
  SELECT b.id AS booking_id, b.vm_push_status, b.vm_push_error, b.vm_pushed_at,
         o.kscw_team, o.team_name AS opponent, sl.date AS slot_date,
         CASE WHEN EXTRACT(ISODOW FROM sl.date) BETWEEN 1 AND 5 THEN TIME '20:00' ELSE sl.start_time END AS agreed_time,
         sg.starting_date_time AT TIME ZONE 'Europe/Zurich' AS vm_wall, sg.last_synced_at, sg.svrz_number,
         (s.vm_authority_date IS NOT NULL AND {{today}} >= s.vm_authority_date) AS feed_owns
  FROM game_scheduling_bookings b
  JOIN s ON s.id = b.season
  JOIN game_scheduling_opponents o ON o.id = b.opponent
  LEFT JOIN game_scheduling_slots sl ON sl.id = b.slot
  LEFT JOIN svrz_games sg ON sg.svrz_persistence_id = b.svrz_game_id
  WHERE b.type = 'home_slot_pick' AND b.status = 'confirmed'
),
v AS (
  SELECT x.*,
         CASE WHEN x.slot_date IS NULL THEN 'no_slot'
              WHEN x.vm_wall IS NOT NULL AND x.vm_wall::date = x.slot_date
                   AND to_char(x.vm_wall, 'HH24:MI') = to_char(x.agreed_time, 'HH24:MI') THEN 'match'
              WHEN x.feed_owns AND x.vm_wall IS NOT NULL THEN 'feed_authority'
              WHEN COALESCE(x.vm_push_status, '') NOT IN ('pushed', 'pushed_no_hall') THEN 'not_pushed'
              WHEN x.vm_wall IS NULL THEN 'no_vm'
              WHEN x.last_synced_at IS NOT NULL AND x.vm_pushed_at IS NOT NULL AND x.last_synced_at > x.vm_pushed_at THEN 'mismatch'
              ELSE 'match' END AS verdict
  FROM x
)
SELECT g.id AS game_id, COALESCE(g.date, v.slot_date)::text AS date,
       to_char(COALESCE(g.time, v.agreed_time), 'HH24:MI') AS time, 'home' AS home_away,
       COALESCE(g.home_team, t.name) AS home_team, COALESCE(g.away_team, v.opponent) AS away_team, g.league,
       t.id AS team_id, t.name AS team, 'volleyball' AS sport,
       v.verdict, v.vm_push_status AS push_status, left(v.vm_push_error, 120) AS push_error,
       to_char(v.vm_wall, 'YYYY-MM-DD HH24:MI') AS vm_datetime,
       v.slot_date::text AS agreed_date, to_char(v.agreed_time, 'HH24:MI') AS agreed_time,
       v.booking_id
FROM v
JOIN teams t ON t.id = v.kscw_team
LEFT JOIN games g ON g.game_id = 'vb_' || v.svrz_number AND g.kscw_team = v.kscw_team
WHERE v.verdict IN ('no_slot', 'not_pushed', 'mismatch')
ORDER BY v.slot_date NULLS FIRST, t.name, v.booking_id`,
  },
  {
    key: 'sched_away_vm_placeholder',
    section: 'games',
    sport: 'vb',
    severity: 'warn',
    grain: 'game',
    title: 'Confirmed away game the opponent has not entered in VolleyManager',
    description: 'The away date we agreed is not in VolleyManager. unset: VM still shows the league’s unscheduled placeholder (on or before the season-open date) — the opponent must enter it. mismatch: VM has a different real date (rescheduled outside the tool; sync-away-from-vm adopts it). no_vm: no fixture linked to the booking. Same logic as GET /admin/terminplanung/away-vm-check.',
    sql: `
WITH s AS (
  SELECT cur.id, COALESCE(cur.season_opens, make_date(substring(cur.season FROM '^[0-9]{4}')::int, 9, 1)) AS opens
  FROM ${SCHED_SEASON} cur
),
x AS (
  SELECT b.id AS booking_id, o.kscw_team, o.team_name AS opponent, s.opens,
         (CASE b.confirmed_proposal WHEN 2 THEN b.proposed_datetime_2 WHEN 3 THEN b.proposed_datetime_3
               ELSE b.proposed_datetime_1 END) AT TIME ZONE 'UTC' AS agreed_wall,
         sg.starting_date_time AT TIME ZONE 'Europe/Zurich' AS vm_wall, sg.svrz_number
  FROM game_scheduling_bookings b
  JOIN s ON s.id = b.season
  JOIN game_scheduling_opponents o ON o.id = b.opponent
  LEFT JOIN svrz_games sg ON sg.svrz_persistence_id = b.svrz_game_id
  WHERE b.type = 'away_proposal' AND b.status = 'confirmed'
),
v AS (
  SELECT x.*,
         CASE WHEN x.vm_wall IS NULL THEN 'no_vm'
              WHEN to_char(x.vm_wall, 'YYYY-MM-DD HH24:MI') = to_char(x.agreed_wall, 'YYYY-MM-DD HH24:MI') THEN 'match'
              WHEN x.opens IS NOT NULL AND x.vm_wall::date <= x.opens THEN 'unset'
              ELSE 'mismatch' END AS verdict
  FROM x
)
SELECT g.id AS game_id, COALESCE(g.date, v.agreed_wall::date)::text AS date,
       to_char(COALESCE(g.time, v.agreed_wall::time), 'HH24:MI') AS time, 'away' AS home_away,
       COALESCE(g.home_team, v.opponent) AS home_team, COALESCE(g.away_team, t.name) AS away_team, g.league,
       t.id AS team_id, t.name AS team, 'volleyball' AS sport,
       v.verdict, to_char(v.agreed_wall, 'YYYY-MM-DD HH24:MI') AS agreed_datetime,
       to_char(v.vm_wall, 'YYYY-MM-DD HH24:MI') AS vm_datetime, v.booking_id
FROM v
JOIN teams t ON t.id = v.kscw_team
LEFT JOIN games g ON g.game_id = 'vb_' || v.svrz_number AND g.kscw_team = v.kscw_team
WHERE v.verdict <> 'match'
ORDER BY v.agreed_wall NULLS FIRST, t.name, v.booking_id`,
  },
  {
    key: 'sched_pending_bookings_stale',
    section: 'games',
    sport: 'vb',
    severity: 'warn',
    grain: 'team',
    title: 'Opponent proposals awaiting confirmation for more than 7 days',
    description: 'An opponent proposed home slots or away dates and no Spielplaner confirmed or rejected within a week; the held first choice keeps blocking other opponents meanwhile. Whether the proposal is still valid (slot booked elsewhere, closure, spacing) is what GET /admin/terminplanung/proposal-health computes — check there, then confirm or reject.',
    sql: `
SELECT t.id AS team_id, t.name AS team, 'volleyball' AS sport,
       b.type AS booking_type, o.club_name, o.team_name AS opponent,
       to_char(b.date_created AT TIME ZONE 'Europe/Zurich', 'YYYY-MM-DD') AS proposed_on,
       ({{today}} - (b.date_created AT TIME ZONE 'Europe/Zurich')::date)::int AS days_waiting,
       b.id AS booking_id
FROM game_scheduling_bookings b
JOIN ${SCHED_SEASON} s ON s.id = b.season
JOIN game_scheduling_opponents o ON o.id = b.opponent
JOIN teams t ON t.id = o.kscw_team
WHERE b.status = 'pending'
  AND (b.date_created AT TIME ZONE 'Europe/Zurich')::date < {{today}} - 7
ORDER BY b.date_created, b.id`,
  },
  {
    key: 'sched_opponent_nothing_confirmed',
    section: 'games',
    sport: 'vb',
    severity: 'warn',
    grain: 'team',
    title: 'Opponent with no confirmed game after the season opened',
    description: 'A league pairing with zero confirmed bookings once the fixture window has opened: the invite was never sent (invited_on empty), never opened (first_viewed_on empty), or the club never answered. feed_games_dated counts this pairing’s games rows already carrying a real date past the season-open placeholder — when it is not zero the games were fixed outside the tool (the opponent entered them in VolleyManager) and sync-away-from-vm can adopt them. Expected games per pairing are not derivable in SQL — for confirmed/total per team use GET /admin/terminplanung/season-summary.',
    sql: `
WITH s AS (
  SELECT cur.id, COALESCE(cur.season_opens, make_date(substring(cur.season FROM '^[0-9]{4}')::int, 9, 1)) AS opens
  FROM ${SCHED_SEASON} cur
)
SELECT t.id AS team_id, t.name AS team, 'volleyball' AS sport,
       o.club_name, o.team_name AS opponent, o.status AS invite_status, o.source,
       to_char(o.email_sent_at AT TIME ZONE 'Europe/Zurich', 'YYYY-MM-DD') AS invited_on,
       to_char(o.first_viewed_at AT TIME ZONE 'Europe/Zurich', 'YYYY-MM-DD') AS first_viewed_on,
       (SELECT count(*) FROM game_scheduling_bookings b WHERE b.opponent = o.id AND b.status = 'pending')::int AS pending_proposals,
       (SELECT count(*) FROM games g
         WHERE g.kscw_team = o.kscw_team AND g.date > s.opens
           AND (g.home_team = o.team_name OR g.away_team = o.team_name))::int AS feed_games_dated,
       o.id AS opponent_id
FROM game_scheduling_opponents o
JOIN s ON s.id = o.season
JOIN teams t ON t.id = o.kscw_team
WHERE o.status NOT IN ('revoked', 'expired')
  AND {{today}} >= s.opens
  AND NOT EXISTS (SELECT 1 FROM game_scheduling_bookings b WHERE b.opponent = o.id AND b.status = 'confirmed')
ORDER BY t.name, o.team_name, o.id`,
  },
  {
    key: 'sched_booked_slot_unreferenced',
    section: 'games',
    sport: 'vb',
    severity: 'warn',
    grain: 'team',
    title: 'Booked home slot that no confirmed booking references',
    description: 'A game_scheduling_slots row is booked but no confirmed booking points at it — the leak from two planners confirming different proposals of one booking. The slot is withheld from the offer pool for the rest of the season and delete-booking cannot free it. Derby-sourced slots are excluded (they are booked by hand, no opponent row exists).',
    sql: `
SELECT t.id AS team_id, t.name AS team, 'volleyball' AS sport,
       sl.date::text AS date, to_char(sl.start_time, 'HH24:MI') AS time, h.name AS hall,
       sl.source AS slot_source, sl.id AS slot_id
FROM game_scheduling_slots sl
JOIN ${SCHED_SEASON} s ON s.id = sl.season
LEFT JOIN teams t ON t.id = sl.kscw_team
LEFT JOIN halls h ON h.id = sl.hall
WHERE sl.status = 'booked'
  AND COALESCE(sl.source, '') <> 'derby'
  AND NOT EXISTS (SELECT 1 FROM game_scheduling_bookings b WHERE b.slot = sl.id AND b.status = 'confirmed')
ORDER BY sl.date, sl.start_time, sl.id`,
  },

  // ── Basketball scheduling ──────────────────────────────────────────
  {
    key: 'bb_manual_placeholders_outstanding',
    section: 'games',
    sport: 'bb',
    severity: 'info',
    grain: 'team',
    title: 'Basketball manual placeholders still standing',
    description: 'Context, not a defect: before Basketplan publishes, basketball fixtures live as manual placeholders that the bp-sync sweep retires once they fall inside the published range. Placeholders next to published rows are either out-of-range (Rückrunde not yet published) or post-publish extras (friendlies, cups). Preview tonight’s sweep via GET /kscw/admin/bp-sync/manual-sweep-preview.',
    sql: `
SELECT ${TEAM_COLS},
       count(*) FILTER (WHERE g.source = 'manual')::int AS manual_rows,
       count(*) FILTER (WHERE g.source = 'basketplan')::int AS basketplan_rows,
       min(g.date) FILTER (WHERE g.source = 'manual')::text AS first_placeholder,
       min(g.date) FILTER (WHERE g.source = 'basketplan')::text AS published_from,
       max(g.date) FILTER (WHERE g.source = 'basketplan')::text AS published_to,
       count(*) FILTER (WHERE g.source = 'manual' AND g.date < {{today}})::int AS placeholders_in_past
FROM games g
JOIN teams t ON t.id = g.kscw_team AND lower(t.sport) = 'basketball'
WHERE g.season = {{season}}
GROUP BY t.id
HAVING count(*) FILTER (WHERE g.source = 'manual') > 0
ORDER BY t.name`,
  },

  // ── Feeds and standings ────────────────────────────────────────────
  {
    key: 'rankings_missing_for_team',
    section: 'games',
    sport: 'both',
    severity: 'warn',
    grain: 'team',
    title: 'League team with synced games but no ranking row this season',
    description: 'The team has feed fixtures this season but the ranking sync never wrote a row for it (rankings.team_id = vb_… / bb_…, short season label), so the standings widget and the website table show nothing. Both feeds publish the table together with the schedule (played = 0 rows), so fixtures without a ranking row mean the key is missing on the ranking side — usually the team is absent from SV_TEAM_IDS, or the Basketplan group table is not scraped for that league.',
    sql: `
SELECT ${TEAM_COLS}, t.league,
       COALESCE(NULLIF(t.team_id, ''), 'bb_' || NULLIF(t.bb_source_id, '')) AS ranking_key,
       (SELECT count(*) FROM games g WHERE g.kscw_team = t.id AND g.season = {{season}} AND g.source <> 'manual')::int AS synced_games,
       (SELECT count(*) FROM games g WHERE g.kscw_team = t.id AND g.season = {{season}} AND COALESCE(g.status, '') = 'completed')::int AS games_completed,
       (SELECT min(g.date) FROM games g WHERE g.kscw_team = t.id AND g.season = {{season}})::text AS first_game
FROM teams t
WHERE ${ACTIVE_TEAM} AND ${SQUAD_TEAM}
  AND NULLIF(btrim(t.league), '') IS NOT NULL
  AND EXISTS (SELECT 1 FROM games g WHERE g.kscw_team = t.id AND g.season = {{season}} AND g.source <> 'manual')
  AND NOT EXISTS (SELECT 1 FROM rankings r
                   WHERE r.season = {{season}}
                     AND (r.team = t.id
                          OR r.team_id = COALESCE(NULLIF(t.team_id, ''), 'bb_' || NULLIF(t.bb_source_id, ''))))
ORDER BY lower(t.sport), t.name`,
  },
  {
    key: 'rankings_team_key_mismatch',
    section: 'games',
    sport: 'both',
    severity: 'warn',
    grain: 'team',
    title: 'Federation lists a KSCW team our team keys do not match',
    description: 'The ranking feed carries a KSC Wiedikon team this season whose key (vb_… / bb_…) is on no active team, or is on a team whose name the feed does not use — both team lookups are active-only and key-based, so the first case orphans every game of that squad the day the fixtures arrive, and the second means the key sits on the wrong squad (e.g. Basketplan renamed last year’s DU18 to DU18 Fire and minted a new id for DU18 Spark). Move the key (teams.team_id / bb_source_id) to the squad the feed names, or create the missing team.',
    // The name test is containment of OUR name in THEIR label ('KSC Wiedikon
    // Herren 2 H2' ⊇ 'Herren 2'), which every current row satisfies. Current
    // season only: historical rows carry renamed squads (D1 ↔ D2 in 2025/26).
    sql: `
SELECT t.id AS team_id, t.name AS team,
       CASE WHEN left(r.team_id, 3) = 'vb_' THEN 'volleyball'
            WHEN left(r.team_id, 3) = 'bb_' THEN 'basketball'
            ELSE lower(t.sport) END AS sport,
       r.team_id AS ranking_key, r.team_name AS feed_team_name, r.league AS feed_league,
       CASE WHEN t.id IS NULL THEN 'no active team carries this key'
            ELSE 'feed names this key differently' END AS problem
FROM (
  SELECT DISTINCT ON (rk.team_id) rk.team_id, rk.team_name, rk.league
  FROM rankings rk
  WHERE rk.season = {{season}} AND rk.team_name ILIKE '%wiedikon%'
  ORDER BY rk.team_id, rk.updated_at DESC NULLS LAST, rk.id DESC
) r
LEFT JOIN teams t
  ON t.active = true
 AND (t.team_id = r.team_id OR 'bb_' || NULLIF(t.bb_source_id, '') = r.team_id)
WHERE t.id IS NULL
   OR position(lower(btrim(t.name)) IN lower(r.team_name)) = 0
ORDER BY r.team_id, t.id`,
  },
  {
    key: 'sync_runs_stale_or_errored',
    section: 'games',
    sport: 'both',
    severity: 'warn',
    grain: 'club',
    title: 'Background sync stale or failing',
    description: 'One row per cron source whose last heartbeat errored or is older than its cadence allows (8 days — covers the weekly Monday VolleyManager sync and VIS check; 35 days for the monthly Schulferien import). Any row means the season data downstream (fixtures, rankings, licences, closures) is not being refreshed; a stale sv_sync or bp_sync explains every "result missing" finding at once. A 1970 timestamp is the migration seed — the cron has never run. On-demand admin actions that also log here (vm_team_assign) are judged on errors only, never on age.',
    sql: `
SELECT sr.source, sr.status,
       ${ZTS('sr.last_run_at')} AS last_run,
       (EXTRACT(EPOCH FROM ({{now}} - (sr.last_run_at AT TIME ZONE 'Europe/Zurich'))) / 86400)::int AS age_days,
       left(sr.error_message, 160) AS error, sr.rows_changed
FROM sync_runs sr
WHERE sr.status = 'error'
   OR (sr.source NOT IN ('vm_team_assign')
       AND (sr.last_run_at AT TIME ZONE 'Europe/Zurich')
           < {{now}} - CASE WHEN sr.source = 'schulferien_sync' THEN INTERVAL '35 days' ELSE INTERVAL '8 days' END)
ORDER BY sr.source`,
  },
]
