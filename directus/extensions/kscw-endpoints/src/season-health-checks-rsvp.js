/**
 * Season health — RSVP / participations.
 *
 * Everything here is a static SQL string composed from season-health-sql.js
 * (read its header first). Domain rules the checks encode, each learned the
 * hard way at least once:
 *
 *   - `participations.activity_id` is TEXT and POLYMORPHIC: training and game
 *     id spaces overlap, so every correlation carries `activity_type` with
 *     `activity_id = x.id::text`. The int is cast UP; the text is only cast
 *     down behind a `~ '^[0-9]+$'` guard.
 *   - "Who should answer" differs per activity: games = core roster
 *     (guest_level 0) ∪ called-up `game_guests` ∪ staff-only; trainings =
 *     roster minus `excluded_guest_levels` ∪ staff-only. `member_teams` alone
 *     is players only — staff live in teams_coaches / teams_responsibles.
 *   - There is no responded_at. `last_status_edited_by` is stamped on human
 *     writes only; NULL on a confirmed row = auto-confirmed by a sweep.
 *     `auto_declined_deadline = true` is a NON-response, not a decline.
 *   - A shell member or one without a directus user cannot respond — the
 *     "never responds" checks drop them (`CAN_RESPOND`).
 *   - `respond_by` whose Zurich wall time is exactly 00:00:00 is the "no
 *     time" sentinel (migration 322) → the activity's own start time, else
 *     23:59. `effectiveDeadline()` mirrors kscw-hooks effectiveDeadlineSql.
 *   - Absence coverage: date range (indefinite = 2099-12-31), `affects`
 *     ('all' or the kind; NULL / `[]` mean 'all' — absenceCoversActivity() and
 *     autoDeclineForAbsence() both read it that way), weekly rows by
 *     Mon=0..Sun=6 day list. All three absence columns are `json`, hence the
 *     `::jsonb` casts.
 *   - The DB session runs in UTC, so a bare `timestamptz >= {{rollover}}`
 *     starts the window at 02:00 Zurich on Jun 1. `ROLLOVER_TS` pins it to
 *     Zurich midnight.
 */
import {
  SQUAD_TEAM, ACTIVE_TEAM, TEAM_SPORT, CORE_PLAYER, REAL_PERSON,
  UPCOMING_GAME, GAME_START, teamPeopleSql, MEMBER_COLS, TEAM_COLS, GAME_COLS,
} from './season-health-sql.js'

// ── Local predicates (rsvp-only; not promoted to season-health-sql.js) ──

/** Training still on the calendar and not before today. Alias trainings as `tr`. */
const UPCOMING_TRAINING = `tr.cancelled = false AND tr.date >= {{today}}`

/** Past-window activity (since the Jun-1 rollover, before today). */
const PAST_GAME = `g.date >= {{rollover}} AND g.date < {{today}} AND COALESCE(g.status, 'scheduled') NOT IN ('cancelled', 'postponed')`
const PAST_TRAINING = `tr.date >= {{rollover}} AND tr.date < {{today}} AND tr.cancelled = false`

/** Jun 1 00:00 Zurich as a timestamptz, for bounding `*_at` columns. */
const ROLLOVER_TS = `(({{rollover}} + TIME '00:00') AT TIME ZONE 'Europe/Zurich')`

/** A member who is physically able to answer an RSVP. Alias members as `m`. */
const CAN_RESPOND = `m.wiedisync_active = true AND m.shell = false AND m."user" IS NOT NULL`

/** Coaches ∪ team responsibles as (teams_id, members_id). */
const STAFF = `(SELECT teams_id, members_id FROM teams_coaches UNION SELECT teams_id, members_id FROM teams_responsibles)`

/** The absence sweep's "row created by the sweep" sentinel. Alias participations as `p`. */
const SWEEP_CREATED = `COALESCE(p.waitlisted_at = TIMESTAMPTZ '1970-01-01 00:00:00+00', false)`

/** Effective team auto-confirm for a training / game (mirrors the two sweeps). */
const TRAINING_AUTO_CONFIRM = `COALESCE(tr.auto_confirm_rsvp, NULLIF(t.features_enabled->>'training_auto_confirm', '')::boolean, false)`
const GAME_AUTO_CONFIRM = `COALESCE(g.auto_confirm_rsvp, NULLIF(t.features_enabled->>'game_auto_confirm', '')::boolean, false)`

/**
 * Absence `a` covers calendar date `dateExpr` for activity kind `kindExpr`
 * (an SQL text expression: `'games'`, `'trainings'` or `(x.atype || 's')`).
 * Mirrors absenceCoversActivity() — including its reading of a NULL or empty
 * `affects` as 'all', which the roster modal and the absence create hook
 * share (the nightly sweep's bare `@>` does not, so such a row shows up in
 * rsvp_absence_missing_decline_row until somebody fixes the sweep).
 */
function absenceCovers(dateExpr, kindExpr) {
  return `a.start_date <= ${dateExpr} AND a.end_date >= ${dateExpr}
      AND (COALESCE(NULLIF(a.affects::jsonb, '[]'::jsonb), '["all"]'::jsonb) @> '"all"'::jsonb
           OR a.affects::jsonb @> to_jsonb((${kindExpr})::text))
      AND (a.type IS DISTINCT FROM 'weekly'
           OR a.days_of_week::jsonb @> to_jsonb((EXTRACT(DOW FROM ${dateExpr})::int + 6) % 7))`
}

/**
 * Effective RSVP deadline as a tz-naive Zurich timestamp (comparable with
 * `{{now}}` and with `date + time`). NULL when `col` is NULL.
 */
function effectiveDeadline(col, startCol) {
  return `((CASE
      WHEN (${col} AT TIME ZONE 'Europe/Zurich')::time = TIME '00:00:00'
      THEN (((${col} AT TIME ZONE 'Europe/Zurich')::date + COALESCE(${startCol}, TIME '23:59')) AT TIME ZONE 'Europe/Zurich')
      ELSE ${col}
    END) AT TIME ZONE 'Europe/Zurich')`
}

/** Naive Zurich timestamp → 'YYYY-MM-DD HH24:MI' text. */
const stamp = (expr) => `to_char(${expr}, 'YYYY-MM-DD HH24:MI')`

const GAME_DEADLINE = effectiveDeadline('g.respond_by', 'g."time"')
const TRAINING_DEADLINE = effectiveDeadline('tr.respond_by', 'tr.start_time')

/**
 * Everyone expected at ONE game: roster (with guest_level) ∪ called-up
 * `game_guests` (guest_level 0) ∪ staff-only (not on the roster, not called
 * up). Per-game LATERAL twin of kscw-hooks GAME_SQUAD_JOIN. Filter
 * `guest_level = 0` for "may play / must answer".
 */
function gameSquadSql(gameExpr, teamExpr) {
  return `(
    SELECT mt.member, COALESCE(mt.guest_level, 0) AS guest_level, false AS is_staff
      FROM member_teams mt WHERE mt.team = ${teamExpr}
    UNION
    SELECT gg.member, 0, false FROM game_guests gg WHERE gg.game = ${gameExpr}
    UNION
    SELECT s.members_id, 0, true
      FROM ${STAFF} s
     WHERE s.teams_id = ${teamExpr}
       AND NOT EXISTS (SELECT 1 FROM member_teams m2 WHERE m2.team = ${teamExpr} AND m2.member = s.members_id)
       AND NOT EXISTS (SELECT 1 FROM game_guests gg2 WHERE gg2.game = ${gameExpr} AND gg2.member = s.members_id)
  )`
}

/** VB field player = confirmed, not staff, not a libero. Alias members as `m`, teams as `t`. */
const FIELD_PLAYER_ROW = `NOT (${TEAM_SPORT} = 'volleyball' AND COALESCE(m."position", '[]'::jsonb) @> '"libero"'::jsonb)`

/** Game minimum as the UI applies it (games.min_participants || VB 6 / BB 5). */
const GAME_MIN = `COALESCE(NULLIF(g.min_participants, 0), CASE WHEN ${TEAM_SPORT} = 'volleyball' THEN 6 ELSE 5 END)`

export const CHECKS = [
  {
    key: 'rsvp_game_low_confirmed_7d',
    section: 'rsvp',
    sport: 'both',
    severity: 'error',
    grain: 'game',
    title: 'Games in the next 7 days below the minimum confirmed players',
    description: 'Mirrors the red roster warning: confirmed non-staff players (volleyball: non-libero) are below games.min_participants or the sport default (VB 6, BB 5). Chase the squad or call up guests before kick-off.',
    sql: `
SELECT ${GAME_COLS}, ${TEAM_COLS},
       COUNT(p.id) FILTER (WHERE ${FIELD_PLAYER_ROW}) AS confirmed_players,
       ${GAME_MIN} AS min_needed,
       ${stamp(GAME_DEADLINE)} AS respond_by
FROM games g
JOIN teams t ON t.id = g.kscw_team AND ${ACTIVE_TEAM}
LEFT JOIN participations p
       ON p.activity_type = 'game' AND p.activity_id = g.id::text
      AND p.status = 'confirmed' AND p.is_staff = false
LEFT JOIN members m ON m.id = p.member
WHERE ${UPCOMING_GAME} AND g.date <= {{today}} + 7
GROUP BY g.id, t.id
HAVING COUNT(p.id) FILTER (WHERE ${FIELD_PLAYER_ROW}) < ${GAME_MIN}
ORDER BY g.date, g."time", g.id`,
  },

  {
    key: 'rsvp_game_players_no_response_14d',
    section: 'rsvp',
    sport: 'both',
    severity: 'warn',
    grain: 'player',
    title: 'Squad members with no RSVP on a game past its deadline or this week',
    description: 'The roster modal\'s "not responded" population (core roster, called-up guests, staff) minus absence-covered members, for games in the next 14 days whose effective deadline has passed — or, when the game has no deadline, that are within 7 days. Chase them or set a deadline.',
    sql: `
SELECT ${MEMBER_COLS}, ${TEAM_COLS},
       g.id AS game_id, g.date::text AS date, g.home_team, g.away_team,
       sq.is_staff,
       ${stamp(GAME_DEADLINE)} AS respond_by,
       COALESCE(${GAME_DEADLINE} < {{now}}, false) AS deadline_passed
FROM games g
JOIN teams t ON t.id = g.kscw_team AND ${ACTIVE_TEAM}
JOIN LATERAL ${gameSquadSql('g.id', 'g.kscw_team')} sq ON sq.guest_level = 0
JOIN members m ON m.id = sq.member AND ${CAN_RESPOND} AND ${REAL_PERSON}
WHERE ${UPCOMING_GAME} AND g.date <= {{today}} + 14
  AND NOT EXISTS (
    SELECT 1 FROM participations p
    WHERE p.activity_type = 'game' AND p.activity_id = g.id::text AND p.member = sq.member)
  AND NOT EXISTS (
    SELECT 1 FROM absences a
    WHERE a.member = sq.member AND ${absenceCovers('g.date', "'games'")})
  AND (${GAME_DEADLINE} < {{now}} OR (g.respond_by IS NULL AND g.date <= {{today}} + 7))
ORDER BY deadline_passed DESC, g.date, t.name, m.last_name, m.first_name, g.id`,
  },

  {
    key: 'rsvp_game_no_coach_confirmed_14d',
    section: 'rsvp',
    sport: 'both',
    severity: 'warn',
    grain: 'game',
    title: 'Games in the next 14 days with no coach or team responsible confirmed',
    description: 'Mirrors the yellow "no coach" warning, keyed on the staff junctions so a player-coach\'s confirmed row counts. Only teams that have staff are listed; a staff member should confirm or the bench is empty.',
    sql: `
SELECT ${GAME_COLS}, ${TEAM_COLS},
       (SELECT count(*) FROM ${STAFF} s WHERE s.teams_id = g.kscw_team) AS staff_count,
       (SELECT count(*) FROM participations p
          JOIN ${STAFF} s ON s.members_id = p.member AND s.teams_id = g.kscw_team
         WHERE p.activity_type = 'game' AND p.activity_id = g.id::text AND p.status = 'declined') AS staff_declined,
       ${stamp(GAME_DEADLINE)} AS respond_by
FROM games g
JOIN teams t ON t.id = g.kscw_team AND ${ACTIVE_TEAM}
WHERE ${UPCOMING_GAME} AND g.date <= {{today}} + 14
  AND EXISTS (SELECT 1 FROM ${STAFF} s WHERE s.teams_id = g.kscw_team)
  AND NOT EXISTS (
    SELECT 1 FROM participations p
    JOIN ${STAFF} s ON s.members_id = p.member AND s.teams_id = g.kscw_team
    WHERE p.activity_type = 'game' AND p.activity_id = g.id::text AND p.status = 'confirmed')
ORDER BY g.date, g."time", g.id`,
  },

  {
    key: 'rsvp_team_response_rate_season',
    section: 'rsvp',
    sport: 'both',
    severity: 'info',
    grain: 'team',
    title: 'Teams where under half of the expected RSVPs were answered this season',
    description: 'Denominator = today\'s core roster × past games and trainings since 1 June (over-counts mid-season joiners; there is no join date). Deadline auto-declines count as non-answers; pct_self is the share the members answered themselves. Below 50 % means RSVPs are effectively unused — turn on auto-confirm or nudge the team.',
    sql: `
WITH acts AS (
  SELECT 'game' AS atype, g.id, g.kscw_team AS team
    FROM games g WHERE g.kscw_team IS NOT NULL AND ${PAST_GAME}
  UNION ALL
  SELECT 'training', tr.id, tr.team
    FROM trainings tr WHERE ${PAST_TRAINING}
), expected AS (
  SELECT a.atype, a.id, a.team, mt.member, m."user" AS member_user
  FROM acts a
  JOIN member_teams mt ON mt.team = a.team AND ${CORE_PLAYER}
  JOIN members m ON m.id = mt.member AND m.wiedisync_active = true AND m.shell = false AND ${REAL_PERSON}
), answered AS (
  SELECT e.atype, e.id, e.team,
         (p.id IS NOT NULL AND p.auto_declined_deadline = false) AS answered,
         (p.last_status_edited_by IS NOT NULL AND p.last_status_edited_by = e.member_user) AS self_answered
  FROM expected e
  LEFT JOIN participations p
         ON p.activity_type = e.atype AND p.activity_id = e.id::text
        AND p.member = e.member AND p.session_id IS NULL
)
SELECT ${TEAM_COLS},
       COUNT(DISTINCT (x.atype, x.id)) AS past_activities,
       COUNT(*) AS expected_answers,
       COUNT(*) FILTER (WHERE x.answered) AS answered,
       COUNT(*) FILTER (WHERE x.self_answered) AS self_answered,
       ROUND(100.0 * COUNT(*) FILTER (WHERE x.answered) / COUNT(*))::int AS pct_answered,
       ROUND(100.0 * COUNT(*) FILTER (WHERE x.self_answered) / COUNT(*))::int AS pct_self
FROM answered x
JOIN teams t ON t.id = x.team AND ${ACTIVE_TEAM} AND ${SQUAD_TEAM}
GROUP BY t.id
HAVING COUNT(DISTINCT (x.atype, x.id)) >= 5
   AND 100.0 * COUNT(*) FILTER (WHERE x.answered) / COUNT(*) < 50
ORDER BY pct_answered, t.name, t.id`,
  },

  {
    key: 'rsvp_member_never_self_responds_season',
    section: 'rsvp',
    sport: 'both',
    severity: 'warn',
    grain: 'player',
    memberIdColumn: 'member_id',
    title: 'Roster players who never answered an RSVP themselves this season',
    description: 'A self-answer is a row whose last_status_edited_by is the member\'s own login (sweeps leave it NULL, a coach stamps the coach; a guardian acting for a household member resolves as that member). Only teams where a player self-answered since 1 June count (teams not using RSVPs are the team-rate check\'s job). 8+ past activities and zero self-answers: not using the app (see last_online), living on auto-confirm, or a login that only arrived recently — ask them.',
    sql: `
WITH acts AS (
  SELECT 'game' AS atype, g.id, g.kscw_team AS team
    FROM games g WHERE g.kscw_team IS NOT NULL AND ${PAST_GAME}
  UNION ALL
  SELECT 'training', tr.id, tr.team
    FROM trainings tr WHERE ${PAST_TRAINING}
), rsvp_teams AS (
  SELECT a.team, COUNT(DISTINCT (a.atype, a.id)) AS n
  FROM acts a
  WHERE EXISTS (
    SELECT 1 FROM participations p
    JOIN members mm ON mm.id = p.member AND p.last_status_edited_by = mm."user"
    WHERE p.activity_type = a.atype AND p.activity_id = a.id::text AND p.is_staff = false)
  GROUP BY a.team
), roster AS (
  SELECT mt.member,
         string_agg(t.name, ', ' ORDER BY t.name) AS teams,
         SUM((SELECT count(*) FROM acts a WHERE a.team = t.id))::int AS past_activities
  FROM member_teams mt
  JOIN teams t ON t.id = mt.team AND ${ACTIVE_TEAM} AND ${SQUAD_TEAM}
  JOIN rsvp_teams rt ON rt.team = t.id
  WHERE ${CORE_PLAYER}
  GROUP BY mt.member
)
SELECT ${MEMBER_COLS}, r.teams, r.past_activities,
       (SELECT count(*) FROM participations p
         WHERE p.member = m.id AND p.last_status_edited_by IS NOT NULL
           AND p.last_status_edited_at >= ${ROLLOVER_TS}) AS rows_edited_by_others,
       (m.auto_confirm_trainings OR m.auto_confirm_games) AS personal_auto_confirm,
       to_char(m.last_online_at AT TIME ZONE 'Europe/Zurich', 'YYYY-MM-DD') AS last_online
FROM roster r
JOIN members m ON m.id = r.member
WHERE ${CAN_RESPOND} AND ${REAL_PERSON}
  AND r.past_activities >= 8
  AND NOT EXISTS (
    SELECT 1 FROM participations p
    WHERE p.member = m.id AND p.last_status_edited_by = m."user"
      AND p.last_status_edited_at >= ${ROLLOVER_TS})
ORDER BY r.past_activities DESC, m.last_name, m.first_name, m.id`,
  },

  {
    key: 'rsvp_member_low_attendance_season',
    section: 'rsvp',
    sport: 'both',
    severity: 'info',
    grain: 'player',
    title: 'Roster players present at under 30 % of tracked team activities',
    description: 'Coach-dashboard rule on past activities since 1 June that the team actually tracked (at least one confirmed player RSVP — a coach\'s own auto-confirm does not make an activity tracked): confirmed = present, anything else (declined, absence, no row) = absent; 8+ such activities required. A retention or roster-hygiene signal — the player may have left while the roster row stayed, or joined mid-season (there is no join date).',
    sql: `
WITH cells AS (
  SELECT mt.member, t.id AS team_id, a.atype, a.id AS aid
  FROM member_teams mt
  JOIN teams t ON t.id = mt.team AND ${ACTIVE_TEAM} AND ${SQUAD_TEAM}
  JOIN LATERAL (
    SELECT 'game' AS atype, g.id FROM games g WHERE g.kscw_team = mt.team AND ${PAST_GAME}
    UNION ALL
    SELECT 'training', tr.id FROM trainings tr WHERE tr.team = mt.team AND ${PAST_TRAINING}
  ) a ON EXISTS (
    SELECT 1 FROM participations tp
    WHERE tp.activity_type = a.atype AND tp.activity_id = a.id::text
      AND tp.status = 'confirmed' AND tp.is_staff = false)
  WHERE ${CORE_PLAYER}
)
SELECT ${MEMBER_COLS}, ${TEAM_COLS},
       COUNT(*) AS tracked_activities,
       COUNT(p.id) AS present,
       ROUND(100.0 * COUNT(p.id) / COUNT(*))::int AS pct_present,
       to_char(m.last_online_at AT TIME ZONE 'Europe/Zurich', 'YYYY-MM-DD') AS last_online
FROM cells c
JOIN teams t ON t.id = c.team_id
JOIN members m ON m.id = c.member AND m.wiedisync_active = true AND m.shell = false AND ${REAL_PERSON}
LEFT JOIN participations p
       ON p.activity_type = c.atype AND p.activity_id = c.aid::text
      AND p.member = c.member AND p.session_id IS NULL AND p.status = 'confirmed'
GROUP BY m.id, t.id
HAVING COUNT(*) >= 8 AND COUNT(p.id) < 0.3 * COUNT(*)
ORDER BY pct_present, t.name, m.last_name, m.first_name, m.id`,
  },

  {
    key: 'rsvp_training_upcoming_below_min',
    section: 'rsvp',
    sport: 'both',
    severity: 'warn',
    grain: 'training',
    title: 'Trainings in the next 7 days below their minimum participants',
    description: 'Same gate as the half-hourly auto-cancel (confirmed non-staff players < min_participants). With auto_cancel_on_min and a passed deadline the cron cancels it via raw SQL and nobody is notified — decide before that happens.',
    sql: `
SELECT tr.id AS training_id, tr.date::text AS date, to_char(tr.start_time, 'HH24:MI') AS time, ${TEAM_COLS},
       tr.min_participants, c.confirmed_players, tr.auto_cancel_on_min,
       ${stamp(TRAINING_DEADLINE)} AS respond_by,
       COALESCE(${TRAINING_DEADLINE} < {{now}}, false) AS deadline_passed
FROM trainings tr
JOIN teams t ON t.id = tr.team AND ${ACTIVE_TEAM}
JOIN LATERAL (
  SELECT count(*) AS confirmed_players FROM participations p
  WHERE p.activity_type = 'training' AND p.activity_id = tr.id::text
    AND p.status = 'confirmed' AND p.is_staff = false
) c ON true
WHERE ${UPCOMING_TRAINING} AND tr.date <= {{today}} + 7
  AND COALESCE(tr.min_participants, 0) > 0
  AND c.confirmed_players < tr.min_participants
ORDER BY tr.date, tr.start_time, tr.id`,
  },

  {
    key: 'rsvp_absence_vs_confirmed',
    section: 'rsvp',
    sport: 'both',
    severity: 'warn',
    grain: 'player',
    title: 'Auto-confirmed RSVPs on upcoming activities despite a covering absence',
    description: 'Drift: the activity was auto-confirmed (no human editor) with no absence check — synced games, and trainings generated after the absence was entered — and the nightly absence sweep never overturns an existing row. Decline these by hand. A member who confirmed themselves despite an absence is allowed and not listed.',
    sql: `
SELECT * FROM (
  SELECT DISTINCT ON (x.atype, x.id, p.member)
         ${MEMBER_COLS}, ${TEAM_COLS},
         x.atype AS activity_type,
         CASE WHEN x.atype = 'game' THEN x.id END AS game_id,
         CASE WHEN x.atype = 'training' THEN x.id END AS training_id,
         x.date::text AS date,
         a.reason AS absence_reason, a.start_date::text AS absence_from, a.end_date::text AS absence_until,
         p.is_staff
  FROM (
    SELECT 'game' AS atype, g.id, g.kscw_team AS team, g.date FROM games g
     WHERE g.kscw_team IS NOT NULL AND ${UPCOMING_GAME}
    UNION ALL
    SELECT 'training', tr.id, tr.team, tr.date FROM trainings tr WHERE ${UPCOMING_TRAINING}
  ) x
  JOIN teams t ON t.id = x.team AND ${ACTIVE_TEAM}
  JOIN participations p
        ON p.activity_type = x.atype AND p.activity_id = x.id::text
       AND p.status = 'confirmed' AND p.session_id IS NULL
       AND p.last_status_edited_by IS NULL
  JOIN members m ON m.id = p.member
  JOIN absences a ON a.member = p.member AND ${absenceCovers('x.date', "x.atype || 's'")}
  ORDER BY x.atype, x.id, p.member, a.end_date DESC, a.id
) q
ORDER BY date, team, last_name, first_name, activity_type, game_id, training_id, member_id`,
  },

  {
    key: 'rsvp_absence_missing_decline_row',
    section: 'rsvp',
    sport: 'both',
    severity: 'warn',
    grain: 'player',
    title: 'Covering absence on an upcoming activity but no RSVP row',
    description: 'The absence create hook and the 01:30 UTC sweep should have written a declined row for each of these. Legitimate until the next sweep: games synced since it ran (the syncs run no absence pass). Anything older means the sweep errored (error logs "cron.absence_sweep") or cannot see the absence (NULL / empty affects).',
    sql: `
SELECT * FROM (
  SELECT DISTINCT ON (x.atype, x.id, x.member)
         ${MEMBER_COLS}, ${TEAM_COLS},
         x.atype AS activity_type,
         CASE WHEN x.atype = 'game' THEN x.id END AS game_id,
         CASE WHEN x.atype = 'training' THEN x.id END AS training_id,
         x.date::text AS date,
         x.is_staff,
         a.reason AS absence_reason,
         to_char(a.date_created AT TIME ZONE 'Europe/Zurich', 'YYYY-MM-DD') AS absence_created
  FROM (
    SELECT 'game' AS atype, g.id, g.kscw_team AS team, g.date, sq.member, sq.is_staff
      FROM games g
      JOIN LATERAL ${gameSquadSql('g.id', 'g.kscw_team')} sq ON sq.guest_level = 0
     WHERE g.kscw_team IS NOT NULL AND ${UPCOMING_GAME}
    UNION ALL
    SELECT 'training', tr.id, tr.team, tr.date, e.member, e.is_staff
      FROM trainings tr
      JOIN LATERAL ${teamPeopleSql('tr.team')} e
        ON NOT (COALESCE(tr.excluded_guest_levels, '[]'::jsonb) @> to_jsonb(e.guest_level))
     WHERE ${UPCOMING_TRAINING}
  ) x
  JOIN teams t ON t.id = x.team AND ${ACTIVE_TEAM}
  JOIN members m ON m.id = x.member
  JOIN absences a ON a.member = x.member AND a.end_date >= {{today}} AND ${absenceCovers('x.date', "x.atype || 's'")}
  WHERE NOT EXISTS (
    SELECT 1 FROM participations p
    WHERE p.activity_type = x.atype AND p.activity_id = x.id::text AND p.member = x.member)
  ORDER BY x.atype, x.id, x.member, a.date_created DESC, a.id
) q
ORDER BY date, team, last_name, first_name, activity_type, game_id, training_id, member_id`,
  },

  {
    key: 'rsvp_guest_rows_on_games',
    section: 'rsvp',
    sport: 'both',
    severity: 'warn',
    grain: 'player',
    title: 'Game RSVP rows for team guests who were not called up',
    description: 'A guest_level > 0 player cannot answer a game and the roster hides them, yet the bricks count these rows (migration 345 class A). Usually written by the nightly absence sweep; delete the rows and fix the writer.',
    sql: `
SELECT ${MEMBER_COLS}, ${TEAM_COLS},
       g.id AS game_id, g.date::text AS date,
       mt.guest_level, p.status, ${SWEEP_CREATED} AS sweep_created,
       p.id AS participation_id
FROM participations p
JOIN games g ON p.activity_type = 'game' AND p.activity_id = g.id::text
JOIN teams t ON t.id = g.kscw_team
JOIN member_teams mt ON mt.team = g.kscw_team AND mt.member = p.member AND mt.guest_level > 0
JOIN members m ON m.id = p.member
WHERE g.date >= {{today}}
  AND NOT EXISTS (SELECT 1 FROM game_guests gg WHERE gg.game = g.id AND gg.member = p.member)
ORDER BY g.date, t.name, m.last_name, m.first_name, g.id`,
  },

  {
    key: 'rsvp_rows_outside_squad',
    section: 'rsvp',
    sport: 'both',
    severity: 'warn',
    grain: 'player',
    title: 'Game RSVP rows for people outside the squad',
    description: 'Upcoming-game rows whose member is neither on the roster, called up, a coach nor a team responsible (migration 345 class B): a derby row hijacked by sv-sync or a member removed after answering. sweep_created rows are safe to delete; the rest need a look.',
    sql: `
SELECT ${MEMBER_COLS}, ${TEAM_COLS},
       g.id AS game_id, g.game_id AS federation_id, g.date::text AS date,
       p.status, p.is_staff, ${SWEEP_CREATED} AS sweep_created,
       p.id AS participation_id
FROM participations p
JOIN games g ON p.activity_type = 'game' AND p.activity_id = g.id::text
JOIN teams t ON t.id = g.kscw_team
JOIN members m ON m.id = p.member
WHERE g.date >= {{today}}
  AND NOT EXISTS (SELECT 1 FROM member_teams mt WHERE mt.team = g.kscw_team AND mt.member = p.member)
  AND NOT EXISTS (SELECT 1 FROM game_guests gg WHERE gg.game = g.id AND gg.member = p.member)
  AND NOT EXISTS (SELECT 1 FROM ${STAFF} s WHERE s.teams_id = g.kscw_team AND s.members_id = p.member)
ORDER BY g.date, t.name, m.last_name, m.first_name, g.id`,
  },

  {
    key: 'rsvp_orphan_rows',
    section: 'rsvp',
    sport: 'both',
    severity: 'error',
    grain: 'club',
    title: 'RSVP rows pointing at a missing activity or event session',
    description: 'Since migration 246 the AFTER DELETE purge triggers make activity orphans impossible through normal paths; session orphans (sessions regenerated) and session-less rows on per-day events have no trigger. Any row means a raw path bypassed the trigger — delete or re-point it.',
    sql: `
WITH p AS (
  SELECT p.*,
         CASE WHEN p.activity_id ~ '^[0-9]{1,9}$' THEN p.activity_id::int END AS aid,
         CASE WHEN p.session_id ~ '^[0-9]{1,9}$' THEN p.session_id::int END AS sid
  FROM participations p
)
SELECT p.id AS participation_id, p.activity_type, p.activity_id AS activity_ref, p.session_id AS session_ref,
       p.member AS member_id, m.first_name, m.last_name, p.status,
       CASE
         WHEN p.aid IS NULL THEN 'non_numeric_activity_id'
         WHEN p.activity_type = 'event' AND NOT EXISTS (SELECT 1 FROM events e WHERE e.id = p.aid) THEN 'missing_event'
         WHEN p.activity_type = 'event' AND p.session_id IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM event_sessions s WHERE s.id = p.sid AND s.event = p.aid) THEN 'missing_session'
         WHEN p.activity_type = 'event' THEN 'no_session_on_per_day_event'
         ELSE 'missing_' || p.activity_type
       END AS problem,
       to_char(p.date_created AT TIME ZONE 'Europe/Zurich', 'YYYY-MM-DD') AS created
FROM p
LEFT JOIN members m ON m.id = p.member
WHERE p.aid IS NULL
   OR (p.activity_type = 'training' AND NOT EXISTS (SELECT 1 FROM trainings x WHERE x.id = p.aid))
   OR (p.activity_type = 'game' AND NOT EXISTS (SELECT 1 FROM games x WHERE x.id = p.aid))
   OR (p.activity_type = 'event' AND NOT EXISTS (SELECT 1 FROM events x WHERE x.id = p.aid))
   OR (p.activity_type = 'event' AND p.session_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM event_sessions s WHERE s.id = p.sid AND s.event = p.aid))
   OR (p.activity_type = 'event' AND p.session_id IS NULL
       AND EXISTS (SELECT 1 FROM events e WHERE e.id = p.aid AND e.participation_mode IN ('per_day', 'per_session')))
ORDER BY p.activity_type, p.activity_id, p.id`,
  },

  {
    key: 'rsvp_visibility_drift',
    section: 'rsvp',
    sport: 'both',
    severity: 'error',
    grain: 'club',
    title: 'Game RSVP visibility table disagrees with its expected view',
    description: 'kind = extra means a viewer can read a game RSVP they should not — treat as a security incident (a trigger source is missing). kind = missing means a squad member cannot see the roster. The 04:20 UTC cron self-heals by refresh; a row persisting after it means the view itself is wrong.',
    sql: `
SELECT v.kind, v.participation AS participation_id,
       CASE WHEN p.activity_type = 'game' AND p.activity_id ~ '^[0-9]{1,9}$' THEN p.activity_id::int END AS game_id,
       p.member AS member_id, m.first_name, m.last_name, p.status,
       du.email AS viewer_email,
       NULLIF(btrim(COALESCE(du.first_name, '') || ' ' || COALESCE(du.last_name, '')), '') AS viewer_name
FROM verify_participation_visibility() v
LEFT JOIN participations p ON p.id = v.participation
LEFT JOIN members m ON m.id = p.member
LEFT JOIN directus_users du ON du.id = v.viewer_user
ORDER BY CASE v.kind WHEN 'extra' THEN 0 ELSE 1 END, v.participation, v.viewer_user`,
  },

  {
    key: 'rsvp_deadline_sweep_armed',
    section: 'rsvp',
    sport: 'both',
    severity: 'info',
    grain: 'team',
    title: 'Teams with the late sign-in sweep armed, and what it did this season',
    description: 'An enabled late_signin fine rule (general, or a training / game override — an event override arms nothing, the sweep only knows those two) makes the 07:00 UTC cron auto-decline non-responders past the deadline and charge them. tiers = 0 declines without charging; a high auto_fines count means members are not being warned. Counters are per team, so a team with two rules shows them twice. Make sure the team knows.',
    sql: `
SELECT ${TEAM_COLS},
       COALESCE(fr.activity_type, 'all') AS activity_scope,
       CASE WHEN jsonb_typeof(fr.tiers) = 'array' THEN jsonb_array_length(fr.tiers) ELSE 0 END AS tiers,
       fr.reset_window,
       (SELECT count(*) FROM participations p
          JOIN games g ON p.activity_type = 'game' AND p.activity_id = g.id::text
         WHERE g.kscw_team = t.id AND p.auto_declined_deadline = true AND g.date >= {{rollover}}) AS game_auto_declines,
       (SELECT count(*) FROM participations p
          JOIN trainings tr ON p.activity_type = 'training' AND p.activity_id = tr.id::text
         WHERE tr.team = t.id AND p.auto_declined_deadline = true AND tr.date >= {{rollover}}) AS training_auto_declines,
       (SELECT count(*) FROM fines f
         WHERE f.team = t.id AND f.category = 'late_signin' AND f.auto_issued = true
           AND f.issued_at >= ${ROLLOVER_TS} AND f.waived_at IS NULL) AS auto_fines,
       (SELECT COALESCE(SUM(f.amount), 0)::text FROM fines f
         WHERE f.team = t.id AND f.category = 'late_signin' AND f.auto_issued = true
           AND f.issued_at >= ${ROLLOVER_TS} AND f.waived_at IS NULL) AS auto_fines_chf
FROM fine_rules fr
JOIN teams t ON t.id = fr.team AND ${ACTIVE_TEAM}
WHERE fr.category = 'late_signin' AND fr.enabled = true
  AND (fr.activity_type IS NULL OR fr.activity_type IN ('training', 'game'))
ORDER BY t.name, activity_scope, fr.id`,
  },

  {
    key: 'rsvp_respond_by_missing',
    section: 'rsvp',
    sport: 'both',
    severity: 'warn',
    grain: 'game',
    title: 'Upcoming games without a deadline on teams that configured one',
    description: 'Without respond_by nothing deadline-driven fires (reminder, tentative auto-decline, late sign-in sweep). Only sv-sync and bp-sync stamp it, at insert, and both skip game_respond_by_days = 0 (unlike trainings, where 0 means "by the start"); nothing backfills fixtures that predate the setting. Set the deadline on each game or fix the team setting.',
    sql: `
SELECT ${GAME_COLS}, ${TEAM_COLS}, g.source,
       t.features_enabled->>'game_respond_by_days' AS configured_days
FROM games g
JOIN teams t ON t.id = g.kscw_team AND ${ACTIVE_TEAM}
WHERE ${UPCOMING_GAME}
  AND g.respond_by IS NULL
  AND NULLIF(t.features_enabled->>'game_respond_by_days', '') IS NOT NULL
ORDER BY g.date, g."time", g.id`,
  },

  {
    key: 'rsvp_respond_by_missing_trainings',
    section: 'rsvp',
    sport: 'both',
    severity: 'warn',
    grain: 'training',
    title: 'Upcoming trainings without a deadline on teams that configured one',
    description: 'trainings.respond_by is trigger-derived from training_respond_by_days since migration 322, but only on insert or a date move — trainings generated before the team configured the setting keep NULL, and nothing backfills them. The trigger re-derives on a date or time change, so touch the time or backfill by SQL.',
    sql: `
SELECT tr.id AS training_id, tr.date::text AS date, to_char(tr.start_time, 'HH24:MI') AS time, ${TEAM_COLS},
       t.features_enabled->>'training_respond_by_days' AS configured_days
FROM trainings tr
JOIN teams t ON t.id = tr.team AND ${ACTIVE_TEAM}
WHERE ${UPCOMING_TRAINING}
  AND tr.respond_by IS NULL
  AND NULLIF(t.features_enabled->>'training_respond_by_days', '') IS NOT NULL
ORDER BY tr.date, tr.start_time, tr.id`,
  },

  {
    key: 'rsvp_respond_by_after_start',
    section: 'rsvp',
    sport: 'both',
    severity: 'warn',
    grain: 'game',
    title: 'Games whose effective RSVP deadline is after kick-off',
    description: 'Uses the 00:00 "no time" sentinel rule. A deadline after kick-off lets the sweep and the reminder fire after the game was played, and fine people for it. Games with no kick-off time yet (00:00) are skipped. Move the deadline before the start.',
    sql: `
SELECT ${GAME_COLS}, ${TEAM_COLS},
       ${stamp(GAME_DEADLINE)} AS respond_by,
       ${stamp(GAME_START)} AS starts_at
FROM games g
JOIN teams t ON t.id = g.kscw_team AND ${ACTIVE_TEAM}
WHERE ${UPCOMING_GAME}
  AND g.respond_by IS NOT NULL
  AND g."time" IS NOT NULL AND g."time" <> TIME '00:00'
  AND ${GAME_DEADLINE} > ${GAME_START}
ORDER BY g.date, g."time", g.id`,
  },

  {
    key: 'rsvp_respond_by_after_start_trainings',
    section: 'rsvp',
    sport: 'both',
    severity: 'warn',
    grain: 'training',
    title: 'Trainings whose effective RSVP deadline is after the start',
    description: 'Uses the 00:00 "no time" sentinel rule. The deadline sweep, tentative auto-decline and auto-cancel all key on it, so a deadline after the start makes them fire on a training that already happened. Fix the team\'s respond-by days.',
    sql: `
SELECT tr.id AS training_id, tr.date::text AS date, to_char(tr.start_time, 'HH24:MI') AS time, ${TEAM_COLS},
       ${stamp(TRAINING_DEADLINE)} AS respond_by,
       to_char(tr.date + tr.start_time, 'YYYY-MM-DD HH24:MI') AS starts_at
FROM trainings tr
JOIN teams t ON t.id = tr.team AND ${ACTIVE_TEAM}
WHERE ${UPCOMING_TRAINING}
  AND tr.respond_by IS NOT NULL AND tr.start_time IS NOT NULL
  AND ${TRAINING_DEADLINE} > (tr.date + tr.start_time)
ORDER BY tr.date, tr.start_time, tr.id`,
  },

  {
    key: 'rsvp_autoconfirm_gap',
    section: 'rsvp',
    sport: 'both',
    severity: 'warn',
    grain: 'training',
    title: 'Auto-confirm trainings with eligible people who have no RSVP row',
    description: 'Exactly the nightly training auto-confirm sweep\'s eligibility (team or per-activity toggle, or a personal opt-in; excluded guest levels dropped; staff included). Should be empty after the nightly run; rows on trainings created before yesterday mean the sweep is erroring (error logs "training-auto-confirm-sweep").',
    sql: `
SELECT tr.id AS training_id, tr.date::text AS date, to_char(tr.start_time, 'HH24:MI') AS time, ${TEAM_COLS},
       COUNT(*) AS missing_rows,
       COUNT(*) FILTER (WHERE e.is_staff) AS missing_staff,
       ${TRAINING_AUTO_CONFIRM} AS team_auto_confirm,
       to_char(tr.date_created AT TIME ZONE 'Europe/Zurich', 'YYYY-MM-DD') AS training_created
FROM trainings tr
JOIN teams t ON t.id = tr.team
JOIN LATERAL ${teamPeopleSql('tr.team')} e ON true
JOIN members m ON m.id = e.member
WHERE ${UPCOMING_TRAINING}
  AND (${TRAINING_AUTO_CONFIRM} = true OR m.auto_confirm_trainings = true)
  AND NOT (COALESCE(tr.excluded_guest_levels, '[]'::jsonb) @> to_jsonb(e.guest_level))
  AND NOT EXISTS (
    SELECT 1 FROM participations p
    WHERE p.activity_type = 'training' AND p.activity_id = tr.id::text AND p.member = e.member)
GROUP BY tr.id, t.id
ORDER BY tr.date, tr.start_time, tr.id`,
  },

  {
    key: 'rsvp_autoconfirm_gap_games',
    section: 'rsvp',
    sport: 'both',
    severity: 'warn',
    grain: 'game',
    title: 'Auto-confirm games with eligible people who have no RSVP row',
    description: 'Exactly the game auto-confirm sweep\'s eligibility (runs after every sync: team or per-game toggle, or a personal opt-in; core players and staff who guest nowhere). Rows older than the last sync mean the sweep is erroring (error logs "game-auto-confirm-sweep").',
    sql: `
SELECT ${GAME_COLS}, ${TEAM_COLS},
       COUNT(*) AS missing_rows,
       COUNT(*) FILTER (WHERE e.is_staff) AS missing_staff,
       ${GAME_AUTO_CONFIRM} AS team_auto_confirm,
       to_char(g.date_created AT TIME ZONE 'Europe/Zurich', 'YYYY-MM-DD') AS game_created
FROM games g
JOIN teams t ON t.id = g.kscw_team
JOIN LATERAL ${teamPeopleSql('g.kscw_team')} e ON true
JOIN members m ON m.id = e.member
WHERE ${UPCOMING_GAME}
  AND e.guest_level = 0
  AND NOT EXISTS (SELECT 1 FROM member_teams gmt WHERE gmt.member = e.member AND COALESCE(gmt.guest_level, 0) > 0)
  AND (${GAME_AUTO_CONFIRM} = true OR m.auto_confirm_games = true)
  AND NOT EXISTS (
    SELECT 1 FROM participations p
    WHERE p.activity_type = 'game' AND p.activity_id = g.id::text AND p.member = e.member)
GROUP BY g.id, t.id
ORDER BY g.date, g."time", g.id`,
  },
]
