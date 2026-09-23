/**
 * Season health — scorer / referee duties.
 *
 * Everything a duty "is" lives on the `games` row (no duties table): seven
 * role columns (VB scorer / scoreboard / scorer_scoreboard / referee, BB
 * bb_scorer / bb_timekeeper / bb_24s_official), each with a `*_member`
 * assignee and a `*_duty_team`. The rules these checks mirror, and where they
 * come from:
 *
 *   - Spot semantics ............ src/modules/scorer/lib/dutySpots.ts
 *       a spot EXISTS when its duty team or an assignee is set; it is OPEN
 *       when the assignee is NULL. BB per-role teams fall back to
 *       `bb_duty_team`; the BB 24s desk is optional and only counts once
 *       `bb_24s_duty_team` or `bb_24s_official` is set. Cup ties get no duty
 *       team on purpose (Pikett) — they never yield a spot unless somebody
 *       set one by hand.
 *   - Licence per role .......... scorer-claim.js CLAIM_DEFS
 *       scorer → scorer_vb; bb_scorer + bb_timekeeper → otr1_bb;
 *       bb_24s_official → otr2_bb | otn1_bb | otn2_bb; every other role → none.
 *   - Duty pool ................. teamPeopleSql (players guest_level 0 ∪ staff)
 *   - VB layout ................. AssignmentAlgorithm.ts classifyVbMode
 *       HU20* → referee only; DU23* + teams.league 4L/5L → combined;
 *       HU23* + ≤3L → separate. MiniVB / DU20 never provide duty.
 *   - Overlap ................... engine hard rule: VB < 120 min, BB same day;
 *       the playing team (and, for a derby, the sibling away row's team) is
 *       always excluded.
 *
 * Scope: home games of `{{season}}` (the short label every member-facing
 * surface filters by). "Upcoming" is `UPCOMING_GAME` (NULL status = still on
 * the calendar); "ended" is kick-off + 3 h in Zurich wall-clock.
 */
import {
  UPCOMING_GAME, LIVE_GAME, GAME_START, GAME_ENDED, CUP_GAME, VM_JOIN, REAL_PERSON,
  SQUAD_TEAM, ACTIVE_TEAM, TEAM_SPORT, GAME_COLS, MEMBER_COLS, TEAM_COLS, teamPeopleSql,
} from './season-health-sql.js'

// ── Local fragments ─────────────────────────────────────────────────────────

/** Home fixtures of this season — the only games that carry our duties. Alias games as `g`. */
const HOME_SEASON = `g.type = 'home' AND g.season = {{season}}`
const UPCOMING_HOME = `${HOME_SEASON} AND ${UPCOMING_GAME}`

/** Engine exclusions: VB teams that never provide duty (EXCLUDED_DUTY_TEAM_NAMES). Alias teams as `t`. */
const NEVER_ON_DUTY = `(${TEAM_SPORT} = 'volleyball' AND t.name IN ('MiniVB', 'DU20'))`

/**
 * Basketball juniors up to U14 are not expected to hold an OTR1 licence (the
 * crew for their games comes from other teams), so licence-pool checks skip
 * them. Alias teams as `t`.
 */
const BB_JUNIOR_TEAM = `(${TEAM_SPORT} = 'basketball' AND t.name ~* '(^|[^0-9])U ?(8|10|12|14)([^0-9]|$)')`

/**
 * One (role, duty_team, member, is_spot) row per game × role, exactly as
 * dutySpots.ts builds them. `duty_team` is the POOL team (BB roles fall back
 * to bb_duty_team); `is_spot` says whether the row is an obligation at all
 * (the 24s desk only once it has its own team or an assignee). Alias games `g`.
 */
const SPOT_ROWS = `CROSS JOIN LATERAL (VALUES
    ('scorer',            g.scorer_duty_team,            g.scorer_member,
       (g.scorer_duty_team IS NOT NULL OR g.scorer_member IS NOT NULL)),
    ('scoreboard',        g.scoreboard_duty_team,        g.scoreboard_member,
       (g.scoreboard_duty_team IS NOT NULL OR g.scoreboard_member IS NOT NULL)),
    ('scorer_scoreboard', g.scorer_scoreboard_duty_team, g.scorer_scoreboard_member,
       (g.scorer_scoreboard_duty_team IS NOT NULL OR g.scorer_scoreboard_member IS NOT NULL)),
    ('referee',           g.referee_duty_team,           g.referee_member,
       (g.referee_duty_team IS NOT NULL OR g.referee_member IS NOT NULL)),
    ('bb_scorer',         COALESCE(g.bb_scorer_duty_team, g.bb_duty_team),     g.bb_scorer_member,
       (COALESCE(g.bb_scorer_duty_team, g.bb_duty_team) IS NOT NULL OR g.bb_scorer_member IS NOT NULL)),
    ('bb_timekeeper',     COALESCE(g.bb_timekeeper_duty_team, g.bb_duty_team), g.bb_timekeeper_member,
       (COALESCE(g.bb_timekeeper_duty_team, g.bb_duty_team) IS NOT NULL OR g.bb_timekeeper_member IS NOT NULL)),
    ('bb_24s_official',   COALESCE(g.bb_24s_duty_team, g.bb_duty_team),        g.bb_24s_official,
       (g.bb_24s_duty_team IS NOT NULL OR g.bb_24s_official IS NOT NULL))
  ) AS r(role, duty_team, member, is_spot)`

/** The role belongs to the playing team's sport. Alias teams `t`, spot rows `r`. */
const ROLE_MATCHES_SPORT = `((${TEAM_SPORT} = 'volleyball' AND left(r.role, 3) <> 'bb_')
       OR (${TEAM_SPORT} = 'basketball' AND left(r.role, 3) = 'bb_'))`

/** (role, member) for every assignee column, sport-agnostic — any person set is a duty. Alias games `g`. */
const ASSIGNEE_ROWS = `CROSS JOIN LATERAL (VALUES
    ('scorer', g.scorer_member), ('scoreboard', g.scoreboard_member),
    ('scorer_scoreboard', g.scorer_scoreboard_member), ('referee', g.referee_member),
    ('bb_scorer', g.bb_scorer_member), ('bb_timekeeper', g.bb_timekeeper_member),
    ('bb_24s_official', g.bb_24s_official)
  ) AS r(role, member)`

/** (role, duty_team) for every duty-team column, the shared BB crew included. Alias games `g`. */
const DUTY_TEAM_ROWS = `CROSS JOIN LATERAL (VALUES
    ('scorer', g.scorer_duty_team), ('scoreboard', g.scoreboard_duty_team),
    ('scorer_scoreboard', g.scorer_scoreboard_duty_team), ('referee', g.referee_duty_team),
    ('bb_crew', g.bb_duty_team), ('bb_scorer', g.bb_scorer_duty_team),
    ('bb_timekeeper', g.bb_timekeeper_duty_team), ('bb_24s_official', g.bb_24s_duty_team)
  ) AS r(role, duty_team)`

/**
 * The member has explicitly declined the game whose row id is `rowExpr`
 * (games never use participations.session_id). A declined player or coach is
 * demonstrably not playing, so the person-level "plays the game" checks skip
 * them — the engine's team-level exclusion still applies to the duty team.
 */
const declinedGame = (rowExpr, memberExpr) => `EXISTS (
    SELECT 1 FROM participations pd WHERE pd.activity_type = 'game' AND pd.activity_id = ${rowExpr}::text
      AND pd.member = ${memberExpr} AND pd.status = 'declined' AND pd.session_id IS NULL)`

/** The assignee column a delegation role moves. Alias games `g`, scorer_delegations `sd`. */
const ROLE_HOLDER = `CASE sd.role
    WHEN 'scorer' THEN g.scorer_member WHEN 'scoreboard' THEN g.scoreboard_member
    WHEN 'scorer_scoreboard' THEN g.scorer_scoreboard_member WHEN 'referee' THEN g.referee_member
    WHEN 'bb_scorer' THEN g.bb_scorer_member WHEN 'bb_timekeeper' THEN g.bb_timekeeper_member
    WHEN 'bb_24s_official' THEN g.bb_24s_official END`

/**
 * Teams that play a home row: its own kscw_team and, for an intra-club derby
 * (two games rows per game_id), the sibling row's team. Yields (game_id,
 * team_id, row_id) — row_id is the games row that team's players RSVP on.
 */
const PLAYING_TEAMS = `playing AS (
    SELECT g.id AS game_id, g.kscw_team AS team_id, g.id AS row_id
    FROM games g WHERE ${HOME_SEASON} AND g.kscw_team IS NOT NULL
    UNION
    SELECT h.id, a.kscw_team, a.id
    FROM games h JOIN games a ON a.game_id = h.game_id AND a.id <> h.id AND a.kscw_team IS NOT NULL
    WHERE h.type = 'home' AND h.season = {{season}} AND NULLIF(h.game_id, '') IS NOT NULL
  )`

/** classifyVbMode() in SQL. Alias teams `t`. */
const VB_EXPECTED_MODE = `CASE
    WHEN t.name LIKE 'HU20%' THEN 'referee'
    WHEN t.name LIKE 'DU23%' THEN 'combined'
    WHEN t.name LIKE 'HU23%' THEN 'separate'
    WHEN substring(btrim(COALESCE(t.league, '')) FROM '^([0-9]+)L') IS NOT NULL
      THEN CASE WHEN substring(btrim(t.league) FROM '^([0-9]+)L')::int >= 4 THEN 'combined' ELSE 'separate' END
    ELSE 'separate' END`

/**
 * Kick-offs less than the engine's 120-minute window apart (both Zurich
 * wall-clock, same date). An unknown kick-off (NULL, or bp-sync's '00:00'
 * placeholder) falls back to same-day = overlap, exactly as scoreTeam() does
 * when `timeToMin` yields null — a COALESCE to midnight would instead put the
 * unknown game 20 h away from every evening fixture and hide the clash.
 */
const UNKNOWN_TIME = (x) => `(${x}.time IS NULL OR ${x}.time = TIME '00:00')`
const within120 = (a, b) =>
  `(${UNKNOWN_TIME(a)} OR ${UNKNOWN_TIME(b)}
       OR abs(extract(epoch FROM ((${a}.date + ${a}.time) - (${b}.date + ${b}.time)))) < 7200)`

/** Not the same fixture: a different row AND not the derby sibling (same external game_id). */
const otherFixture = (o, d) =>
  `${o}.id <> ${d}.id AND (NULLIF(${o}.game_id, '') IS NULL OR NULLIF(${d}.game_id, '') IS NULL OR ${o}.game_id <> ${d}.game_id)`

/** Open duty spots (sport-gated, cup ties fall out because they carry no duty team). */
const OPEN_SPOTS = `spots AS (
    SELECT ${GAME_COLS}, ${TEAM_SPORT} AS sport, r.role, r.duty_team, (g.date - {{today}}) AS days_out
    FROM games g JOIN teams t ON t.id = g.kscw_team
    ${SPOT_ROWS}
    WHERE ${UPCOMING_HOME} AND ${ROLE_MATCHES_SPORT}
      AND r.is_spot AND r.duty_team IS NOT NULL AND r.member IS NULL
  )`

const OPEN_SPOT_SELECT = `SELECT s.game_id, s.date, s.time, s.home_away, s.home_team, s.away_team, s.sport,
         s.role, dt.name AS duty_team, s.days_out
  FROM spots s LEFT JOIN teams dt ON dt.id = s.duty_team`

// ── Checks ──────────────────────────────────────────────────────────────────

export const CHECKS = [
  {
    key: 'duty_spot_open_due',
    section: 'duties', sport: 'both', severity: 'error', grain: 'game',
    title: 'Open duty spot on a home game within the next 7 days',
    description: 'A duty team was rolled out for this role but nobody has signed up and the game is at most a week away. Somebody from the duty team must claim it on /scorer, or an admin assigns a name on /admin/scorer-assign.',
    sql: `WITH ${OPEN_SPOTS}
  ${OPEN_SPOT_SELECT}
  WHERE s.days_out <= 7
  ORDER BY s.date, s.time, s.game_id, s.role`,
  },
  {
    key: 'duty_spot_open',
    section: 'duties', sport: 'both', severity: 'warn', grain: 'game',
    title: 'Open duty spot on a home game more than 7 days out',
    description: 'A duty team was rolled out for this role but nobody has signed up yet. Not urgent, but every row here becomes an error the week before the game — nudge the duty team early.',
    sql: `WITH ${OPEN_SPOTS}
  ${OPEN_SPOT_SELECT}
  WHERE s.days_out > 7
  ORDER BY s.date, s.time, s.game_id, s.role`,
  },
  {
    key: 'duty_not_rolled_out',
    section: 'duties', sport: 'both', severity: 'warn', grain: 'game',
    title: 'Upcoming home game with no duty team at all',
    description: 'The assignment engine has never touched this home game: no duty team and no official on any role. Typical for a manual game added after the roll-out or a sport whose plan was never run. Cup ties are skipped (on call by design). Run /admin/scorer-assign and roll out.',
    sql: `SELECT ${GAME_COLS}, ${TEAM_SPORT} AS sport, t.name AS playing_team,
         CASE WHEN ${TEAM_SPORT} = 'volleyball' THEN ${VB_EXPECTED_MODE} ELSE 'bb_crew' END AS expected_mode,
         (g.date - {{today}}) AS days_out
  FROM games g JOIN teams t ON t.id = g.kscw_team
  WHERE ${UPCOMING_HOME} AND NOT ${CUP_GAME}
    AND g.scorer_duty_team IS NULL AND g.scoreboard_duty_team IS NULL
    AND g.scorer_scoreboard_duty_team IS NULL AND g.referee_duty_team IS NULL
    AND g.bb_duty_team IS NULL AND g.bb_scorer_duty_team IS NULL
    AND g.bb_timekeeper_duty_team IS NULL AND g.bb_24s_duty_team IS NULL
    AND g.scorer_member IS NULL AND g.scoreboard_member IS NULL
    AND g.scorer_scoreboard_member IS NULL AND g.referee_member IS NULL
    AND g.bb_scorer_member IS NULL AND g.bb_timekeeper_member IS NULL AND g.bb_24s_official IS NULL
  ORDER BY g.date, g.time, g.id`,
  },
  {
    key: 'duty_assignee_unlicensed',
    section: 'duties', sport: 'both', severity: 'error', grain: 'game',
    title: 'Assigned official lacks the licence the role requires',
    description: 'Mirrors the claim gate (CLAIM_DEFS): the separate-mode scorer needs scorer_vb, BB scorer and timekeeper need OTR1, the 24s desk needs OTR2 or an OTN licence. An admin override bypassed the gate or the register sync cleared the flag after the assignment. BB officials who hold OTR2/OTN but not OTR1 are listed separately as a warning.',
    sql: `SELECT ${GAME_COLS}, ${TEAM_SPORT} AS sport, r.role, ${MEMBER_COLS},
         CASE r.role WHEN 'scorer' THEN 'scorer_vb' WHEN 'bb_24s_official' THEN 'otr2_bb | otn1_bb | otn2_bb' ELSE 'otr1_bb' END AS licence_required,
         COALESCE(NULLIF(concat_ws(', ', CASE WHEN m.scorer_vb THEN 'scorer_vb' END, CASE WHEN m.referee_vb THEN 'referee_vb' END,
           CASE WHEN m.otr1_bb THEN 'otr1_bb' END, CASE WHEN m.otr2_bb THEN 'otr2_bb' END,
           CASE WHEN m.otn1_bb THEN 'otn1_bb' END, CASE WHEN m.otn2_bb THEN 'otn2_bb' END), ''), 'none') AS licences_held
  FROM games g JOIN teams t ON t.id = g.kscw_team
  ${ASSIGNEE_ROWS}
  JOIN members m ON m.id = r.member
  WHERE ${UPCOMING_HOME}
    AND ((r.role = 'scorer' AND NOT m.scorer_vb)
      OR (r.role IN ('bb_scorer', 'bb_timekeeper') AND NOT m.otr1_bb AND NOT (m.otr2_bb OR m.otn1_bb OR m.otn2_bb))
      OR (r.role = 'bb_24s_official' AND NOT (m.otr2_bb OR m.otn1_bb OR m.otn2_bb)))
  ORDER BY g.date, g.time, g.id, r.role`,
  },
  {
    key: 'duty_bb_assignee_otr2_only',
    section: 'duties', sport: 'bb', severity: 'warn', grain: 'game',
    title: 'BB scorer or timekeeper holds OTR2/OTN but not OTR1',
    description: 'The claim gate requires OTR1 for the scorer and timekeeper desks, but ClubDesk stores a single "Offiziellen Lizenz" value, so an OTR2 holder reads as unlicensed for these roles and cannot self-claim. Decide with the club whether OTR2 should imply OTR1; until then these assignments only work through an admin.',
    sql: `SELECT ${GAME_COLS}, r.role, ${MEMBER_COLS}, m.otr2_bb, (m.otn1_bb OR m.otn2_bb) AS otn_bb
  FROM games g JOIN teams t ON t.id = g.kscw_team
  ${ASSIGNEE_ROWS}
  JOIN members m ON m.id = r.member
  WHERE ${UPCOMING_HOME} AND r.role IN ('bb_scorer', 'bb_timekeeper')
    AND NOT m.otr1_bb AND (m.otr2_bb OR m.otn1_bb OR m.otn2_bb)
  ORDER BY g.date, g.time, g.id, r.role`,
  },
  {
    key: 'duty_official_plays_this_game',
    section: 'duties', sport: 'both', severity: 'error', grain: 'game',
    title: 'Official is on the team playing the game they officiate',
    description: 'The engine always excludes the playing team, but a manual override, a self-claim or a delegation can put a player or coach of the home team (or, in a derby, of the sibling away row) at the table. Relation says how: confirmed to play, called up for this game, a core roster player, or staff; somebody who declined the game is not listed. Re-assign the spot.',
    sql: `WITH ${PLAYING_TEAMS}
  SELECT ${GAME_COLS}, ${TEAM_SPORT} AS sport, r.role, ${MEMBER_COLS}, pt.name AS playing_team,
         CASE
           WHEN EXISTS (SELECT 1 FROM participations pa WHERE pa.activity_type = 'game'
                          AND pa.activity_id = p.row_id::text AND pa.member = m.id AND pa.status = 'confirmed')
             THEN 'rsvp_confirmed'
           WHEN EXISTS (SELECT 1 FROM game_guests gg WHERE gg.game = p.row_id AND gg.member = m.id)
             THEN 'called_up'
           WHEN EXISTS (SELECT 1 FROM member_teams mt WHERE mt.team = p.team_id AND mt.member = m.id
                          AND COALESCE(mt.guest_level, 0) = 0)
             THEN 'player'
           ELSE 'staff' END AS relation
  FROM games g JOIN teams t ON t.id = g.kscw_team
  ${ASSIGNEE_ROWS}
  JOIN members m ON m.id = r.member
  JOIN playing p ON p.game_id = g.id
  JOIN teams pt ON pt.id = p.team_id
  WHERE ${UPCOMING_HOME}
    AND NOT ${declinedGame('p.row_id', 'm.id')}
    AND (EXISTS (SELECT 1 FROM participations pa WHERE pa.activity_type = 'game'
                   AND pa.activity_id = p.row_id::text AND pa.member = m.id AND pa.status = 'confirmed')
      OR EXISTS (SELECT 1 FROM game_guests gg WHERE gg.game = p.row_id AND gg.member = m.id)
      OR EXISTS (SELECT 1 FROM ${teamPeopleSql('p.team_id')} tp WHERE tp.member = m.id AND tp.guest_level = 0))
  ORDER BY g.date, g.time, g.id, r.role, pt.name`,
  },
  {
    key: 'duty_official_double_booked',
    section: 'duties', sport: 'both', severity: 'error', grain: 'player',
    title: 'Official holds two overlapping duties',
    description: 'The same person is on two roles of one game, or on two games whose kick-offs are less than 120 minutes apart. same_hall false is the worst case: two buildings at once. Re-assign one of the two spots.',
    sql: `WITH duties AS (
    SELECT g.id, g.game_id AS ext_id, g.date, g.time, g.home_team, g.away_team, g.hall,
           ${TEAM_SPORT} AS sport, r.role, r.member
    FROM games g JOIN teams t ON t.id = g.kscw_team
    ${ASSIGNEE_ROWS}
    WHERE ${UPCOMING_HOME} AND r.member IS NOT NULL
  )
  SELECT a.member AS member_id, m.first_name, m.last_name, a.sport,
         a.date::text AS date, a.id AS game_id, to_char(a.time, 'HH24:MI') AS time,
         concat_ws(' – ', a.home_team, a.away_team) AS match, a.role,
         b.id AS other_game_id, to_char(b.time, 'HH24:MI') AS other_time,
         concat_ws(' – ', b.home_team, b.away_team) AS other_match, b.role AS other_role,
         (a.hall IS NOT NULL AND a.hall = b.hall) AS same_hall
  FROM duties a
  JOIN duties b ON b.member = a.member AND b.date = a.date
               AND (b.id > a.id OR (b.id = a.id AND b.role > a.role))
  JOIN members m ON m.id = a.member
  WHERE b.id = a.id OR ${within120('a', 'b')}
  ORDER BY a.date, a.time, a.id, a.role, b.id, b.role`,
  },
  {
    key: 'duty_official_plays_overlapping_game',
    section: 'duties', sport: 'both', severity: 'error', grain: 'player',
    title: 'Official has their own game overlapping the duty',
    description: 'Person-level version of the engine hard rule: a team the official plays for or staffs has a game (home or away) kicking off within 120 minutes of the duty, or the official has confirmed to play in one. own_rsvp confirmed makes it certain; an official who declined that game is not listed. Re-assign the spot.',
    sql: `WITH duties AS (
    SELECT g.id, g.game_id, g.date, g.time, g.home_team, g.away_team,
           ${TEAM_SPORT} AS sport, r.role, r.member
    FROM games g JOIN teams t ON t.id = g.kscw_team
    ${ASSIGNEE_ROWS}
    WHERE ${UPCOMING_HOME} AND r.member IS NOT NULL
  )
  SELECT d.member AS member_id, m.first_name, m.last_name, d.sport,
         d.date::text AS date, d.id AS game_id, to_char(d.time, 'HH24:MI') AS time,
         concat_ws(' – ', d.home_team, d.away_team) AS match, d.role,
         o.id AS own_game_id, ot.name AS own_team,
         to_char(o.time, 'HH24:MI') AS own_time, concat_ws(' – ', o.home_team, o.away_team) AS own_match,
         (SELECT pa.status FROM participations pa WHERE pa.activity_type = 'game'
            AND pa.activity_id = o.id::text AND pa.member = d.member AND pa.session_id IS NULL) AS own_rsvp
  FROM duties d
  JOIN members m ON m.id = d.member
  JOIN games o ON o.date = d.date AND ${otherFixture('o', 'd')}
              AND COALESCE(o.status, 'scheduled') NOT IN ('completed', 'cancelled', 'postponed')
  JOIN teams ot ON ot.id = o.kscw_team AND ot.active = true
  WHERE ${within120('d', 'o')}
    AND NOT ${declinedGame('o.id', 'd.member')}
    AND (EXISTS (SELECT 1 FROM ${teamPeopleSql('o.kscw_team')} tp WHERE tp.member = d.member AND tp.guest_level = 0)
      OR EXISTS (SELECT 1 FROM participations pa WHERE pa.activity_type = 'game'
                   AND pa.activity_id = o.id::text AND pa.member = d.member AND pa.status = 'confirmed'))
  ORDER BY d.date, d.time, d.id, d.role, o.id`,
  },
  {
    key: 'duty_team_plays_overlapping_game',
    section: 'duties', sport: 'both', severity: 'warn', grain: 'team',
    title: 'Duty team has its own game overlapping the duty',
    description: 'The engine disqualifies a team whose own game kicks off within 120 minutes (VB) or on the same day (BB). This appears when a game was moved or added after the roll-out. Re-assign the spot on /admin/scorer-assign.',
    sql: `WITH spots AS (
    SELECT g.id, g.game_id, g.date, g.time, g.home_team, g.away_team, ${TEAM_SPORT} AS sport, r.role, r.duty_team
    FROM games g JOIN teams t ON t.id = g.kscw_team
    ${DUTY_TEAM_ROWS}
    WHERE ${UPCOMING_HOME} AND r.duty_team IS NOT NULL
  )
  SELECT dt.id AS team_id, dt.name AS team, s.sport,
         s.date::text AS date, s.id AS game_id, to_char(s.time, 'HH24:MI') AS time,
         concat_ws(' – ', s.home_team, s.away_team) AS match, s.role,
         o.id AS own_game_id, o.type AS own_home_away, to_char(o.time, 'HH24:MI') AS own_time,
         concat_ws(' – ', o.home_team, o.away_team) AS own_match
  FROM spots s
  JOIN teams dt ON dt.id = s.duty_team
  JOIN games o ON o.kscw_team = s.duty_team AND o.date = s.date AND ${otherFixture('o', 's')}
              AND COALESCE(o.status, 'scheduled') NOT IN ('completed', 'cancelled', 'postponed')
  WHERE s.sport = 'basketball' OR ${within120('s', 'o')}
  ORDER BY s.date, s.time, s.id, s.role, o.id`,
  },
  {
    key: 'duty_team_invalid',
    section: 'duties', sport: 'both', severity: 'error', grain: 'game',
    title: 'Duty team is the playing team, archived, wrong sport or excluded',
    description: 'Four engine invariants: a team never does its own duty (derby sibling included), a duty team must be active, of the same sport, and not MiniVB / DU20. Usually a manual assignment or a season rollover that left last season\'s team clone on the game. Re-assign the spot.',
    sql: `WITH ${PLAYING_TEAMS}
  SELECT ${GAME_COLS}, ${TEAM_SPORT} AS sport, r.role, dt.id AS duty_team_id, dt.name AS duty_team,
         CASE
           WHEN EXISTS (SELECT 1 FROM playing p WHERE p.game_id = g.id AND p.team_id = r.duty_team) THEN 'is_playing_team'
           WHEN NOT dt.active THEN 'archived_team'
           WHEN lower(dt.sport) IS DISTINCT FROM ${TEAM_SPORT} THEN 'wrong_sport'
           ELSE 'excluded_team' END AS issue
  FROM games g JOIN teams t ON t.id = g.kscw_team
  ${DUTY_TEAM_ROWS}
  JOIN teams dt ON dt.id = r.duty_team
  WHERE ${UPCOMING_HOME}
    AND (EXISTS (SELECT 1 FROM playing p WHERE p.game_id = g.id AND p.team_id = r.duty_team)
      OR NOT dt.active
      OR lower(dt.sport) IS DISTINCT FROM ${TEAM_SPORT}
      OR (${TEAM_SPORT} = 'volleyball' AND dt.name IN ('MiniVB', 'DU20')))
  ORDER BY g.date, g.time, g.id, r.role`,
  },
  {
    key: 'duty_official_inactive',
    section: 'duties', sport: 'both', severity: 'error', grain: 'game',
    title: 'Assigned official is no longer an active member',
    description: 'The person on this duty has left the club (kscw_membership_active is false). Reminders and contact lookups will not reach them and the claim page shows the spot as filled. Re-assign it.',
    sql: `SELECT ${GAME_COLS}, ${TEAM_SPORT} AS sport, r.role, ${MEMBER_COLS}, dt.name AS duty_team
  FROM games g JOIN teams t ON t.id = g.kscw_team
  ${SPOT_ROWS}
  JOIN members m ON m.id = r.member
  LEFT JOIN teams dt ON dt.id = r.duty_team
  WHERE ${UPCOMING_HOME} AND NOT m.kscw_membership_active
  ORDER BY g.date, g.time, g.id, r.role`,
  },
  {
    key: 'duty_official_not_in_duty_team',
    section: 'duties', sport: 'both', severity: 'warn', grain: 'game',
    title: 'Assigned official is not in the duty team, or is a guest there',
    description: 'The claim endpoint and the pickers only offer the duty team\'s pool (core players and staff). Somebody outside it — via delegation fallback, admin override or a guest roster row — will not be reminded or contacted the way the team expects. no_duty_team means a person is set with no team behind the role.',
    sql: `SELECT ${GAME_COLS}, ${TEAM_SPORT} AS sport, r.role, ${MEMBER_COLS}, dt.name AS duty_team,
         CASE
           WHEN r.duty_team IS NULL THEN 'no_duty_team'
           WHEN EXISTS (SELECT 1 FROM member_teams mt WHERE mt.team = r.duty_team AND mt.member = m.id
                          AND COALESCE(mt.guest_level, 0) > 0) THEN 'guest_in_duty_team'
           ELSE 'not_in_duty_team' END AS issue
  FROM games g JOIN teams t ON t.id = g.kscw_team
  ${SPOT_ROWS}
  JOIN members m ON m.id = r.member
  LEFT JOIN teams dt ON dt.id = r.duty_team
  WHERE ${UPCOMING_HOME} AND m.kscw_membership_active
    AND (r.duty_team IS NULL
      OR NOT EXISTS (SELECT 1 FROM ${teamPeopleSql('r.duty_team')} tp WHERE tp.member = m.id AND tp.guest_level = 0))
  ORDER BY g.date, g.time, g.id, r.role`,
  },
  {
    key: 'duty_spot_unclaimable',
    section: 'duties', sport: 'both', severity: 'error', grain: 'game',
    title: 'Licence-gated spot assigned to a team with no licence holder',
    description: 'An open scorer / BB-official spot whose duty team has nobody with the required licence in its pool — no member of that team can ever press the claim button, so the spot stays open until an admin notices. Happens when the register sync clears a flag after the roll-out. Move the spot to a team with a licence holder.',
    sql: `WITH spots AS (
    SELECT ${GAME_COLS}, ${TEAM_SPORT} AS sport, r.role, r.duty_team,
           CASE r.role WHEN 'scorer' THEN 'scorer_vb' WHEN 'bb_24s_official' THEN 'otr2_bb | otn1_bb | otn2_bb' ELSE 'otr1_bb' END AS licence_required
    FROM games g JOIN teams t ON t.id = g.kscw_team
    ${SPOT_ROWS}
    WHERE ${UPCOMING_HOME} AND ${ROLE_MATCHES_SPORT}
      AND r.role IN ('scorer', 'bb_scorer', 'bb_timekeeper', 'bb_24s_official')
      AND r.is_spot AND r.duty_team IS NOT NULL AND r.member IS NULL
  )
  SELECT sp.game_id, sp.date, sp.time, sp.home_away, sp.home_team, sp.away_team, sp.sport,
         sp.role, dt.name AS duty_team, sp.licence_required,
         (SELECT count(*) FROM ${teamPeopleSql('sp.duty_team')} tp JOIN members m ON m.id = tp.member
           WHERE tp.guest_level = 0 AND m.kscw_membership_active)::int AS pool_size
  FROM spots sp JOIN teams dt ON dt.id = sp.duty_team
  WHERE NOT EXISTS (
    SELECT 1 FROM ${teamPeopleSql('sp.duty_team')} tp
    JOIN members m ON m.id = tp.member AND m.kscw_membership_active
    WHERE tp.guest_level = 0
      AND ((sp.role = 'scorer' AND m.scorer_vb)
        OR (sp.role IN ('bb_scorer', 'bb_timekeeper') AND m.otr1_bb)
        OR (sp.role = 'bb_24s_official' AND (m.otr2_bb OR m.otn1_bb OR m.otn2_bb))))
  ORDER BY sp.date, sp.time, sp.game_id, sp.role`,
  },
  {
    key: 'duty_vb_mode_mismatch',
    section: 'duties', sport: 'vb', severity: 'warn', grain: 'game',
    title: 'VB duty layout does not match the playing team\'s mode',
    description: 'classifyVbMode: HU20 gets a referee only; DU23 and 4L/5L get one combined scorer+scoreboard team (no licence); HU23 and 3L and up get a licensed scorer plus a separate scoreboard team. A mismatch means e.g. an HU20 game got a scorer instead of a referee, or a 2L game an unlicensed combined crew; mixed means columns of two layouts are set. Cup ties are skipped (the engine assigns them nothing, so a hand-set layout is a choice). Fix on /admin/scorer-assign.',
    sql: `WITH x AS (
    SELECT ${GAME_COLS}, t.name AS playing_team, t.league AS team_league,
           ${VB_EXPECTED_MODE} AS expected_mode,
           (g.scorer_scoreboard_duty_team IS NOT NULL OR g.scorer_scoreboard_member IS NOT NULL) AS has_combined,
           (g.referee_duty_team IS NOT NULL OR g.referee_member IS NOT NULL) AS has_referee,
           (g.scorer_duty_team IS NOT NULL OR g.scorer_member IS NOT NULL
             OR g.scoreboard_duty_team IS NOT NULL OR g.scoreboard_member IS NOT NULL) AS has_separate
    FROM games g JOIN teams t ON t.id = g.kscw_team AND ${TEAM_SPORT} = 'volleyball'
    WHERE ${UPCOMING_HOME} AND NOT ${CUP_GAME}
  ), y AS (
    SELECT x.*, CASE
      WHEN (has_combined::int + has_referee::int + has_separate::int) > 1 THEN 'mixed'
      WHEN has_combined THEN 'combined'
      WHEN has_referee THEN 'referee'
      WHEN has_separate THEN 'separate' END AS actual_mode
    FROM x
  )
  SELECT game_id, date, time, home_away, home_team, away_team, league, playing_team, team_league, expected_mode, actual_mode
  FROM y
  WHERE actual_mode IS NOT NULL AND actual_mode <> expected_mode
  ORDER BY date, time, game_id`,
  },
  {
    key: 'duty_late_reports',
    section: 'duties', sport: 'both', severity: 'info', grain: 'game',
    title: 'Late / no-show duty reports this season and their auto-fines',
    description: 'Every duty-late alarm raised this season (games.duty_late_json) with the no_show fine it should have produced (volleyball only — basketball duties carry no fine). The name is whoever holds the role NOW (the alarm stores no member id), so a missing fine means the official had no active team to book it against or the role was re-assigned after the alarm; the same name with repeat_count 2 or more is a reliability problem. leader_alerts counts the emergency "contact team leaders" presses on that game.',
    sql: `WITH late AS (
    SELECT g.id, g.date, g.time, g.type, g.home_team, g.away_team, g.league, ${TEAM_SPORT} AS sport,
           l.key AS role,
           CASE WHEN l.value->>'at' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
                THEN to_char((l.value->>'at')::timestamptz AT TIME ZONE 'Europe/Zurich', 'YYYY-MM-DD HH24:MI')
                ELSE l.value->>'at' END AS reported_at,
           l.value->>'by_name' AS reported_by,
           CASE l.key WHEN 'scorer' THEN g.scorer_member WHEN 'scoreboard' THEN g.scoreboard_member
             WHEN 'scorer_scoreboard' THEN g.scorer_scoreboard_member WHEN 'referee' THEN g.referee_member
             WHEN 'bb_scorer' THEN g.bb_scorer_member WHEN 'bb_timekeeper' THEN g.bb_timekeeper_member
             WHEN 'bb_24s_official' THEN g.bb_24s_official END AS official,
           (SELECT count(*) FROM jsonb_each(CASE WHEN jsonb_typeof(g.duty_leader_alert_json) = 'object'
                                                 THEN g.duty_leader_alert_json ELSE '{}'::jsonb END))::int AS leader_alerts
    FROM games g JOIN teams t ON t.id = g.kscw_team
    CROSS JOIN LATERAL jsonb_each(CASE WHEN jsonb_typeof(g.duty_late_json) = 'object'
                                       THEN g.duty_late_json ELSE '{}'::jsonb END) l
    WHERE ${HOME_SEASON}
  )
  SELECT x.id AS game_id, x.date::text AS date, to_char(x.time, 'HH24:MI') AS time, x.type AS home_away,
         x.home_team, x.away_team, x.sport, x.role, x.reported_at, x.reported_by,
         m.id AS member_id, m.first_name, m.last_name,
         CASE WHEN x.role LIKE 'bb\\_%' THEN 'n/a (basketball)' WHEN f.id IS NULL THEN 'missing' ELSE concat_ws(' ', f.amount::text, f.status) END AS fine, x.leader_alerts,
         (SELECT count(*) FROM late y WHERE y.official = x.official AND x.official IS NOT NULL)::int AS repeat_count
  FROM late x
  LEFT JOIN members m ON m.id = x.official
  LEFT JOIN fines f ON f.activity_type = 'game' AND f.activity_id = x.id AND f.category = 'no_show'
                   AND f.auto_issued AND f.member = x.official
  ORDER BY x.date DESC, x.time DESC, x.id, x.role`,
  },
  {
    key: 'delegation_stale_pending',
    section: 'duties', sport: 'both', severity: 'warn', grain: 'game',
    title: 'Pending duty delegation close to the game or older than a week',
    description: 'A delegation only moves the duty once the recipient accepts; until then the original person is still on the hook and may believe they are not. The expiry cron only touches past games. The delegator should chase the recipient, or an admin re-assigns the spot.',
    sql: `SELECT ${GAME_COLS}, ${TEAM_SPORT} AS sport, sd.id AS delegation_id, sd.role,
         concat_ws(' ', fm.first_name, fm.last_name) AS from_name,
         concat_ws(' ', tm.first_name, tm.last_name) AS to_name,
         to_char(sd.date_created AT TIME ZONE 'Europe/Zurich', 'YYYY-MM-DD HH24:MI') AS requested_at,
         ({{today}} - (sd.date_created AT TIME ZONE 'Europe/Zurich')::date) AS days_pending,
         (g.date - {{today}}) AS days_to_game, sd.same_team
  FROM scorer_delegations sd
  JOIN games g ON g.id = sd.game
  JOIN teams t ON t.id = g.kscw_team
  LEFT JOIN members fm ON fm.id = sd.from_member
  LEFT JOIN members tm ON tm.id = sd.to_member
  WHERE sd.status = 'pending' AND ${UPCOMING_GAME}
    AND (g.date <= {{today}} + 3 OR sd.date_created < now() - INTERVAL '7 days')
  ORDER BY g.date, g.time, g.id, sd.id`,
  },
  {
    key: 'delegation_accepted_not_applied',
    section: 'duties', sport: 'both', severity: 'warn', grain: 'game',
    title: 'Accepted delegation whose duty is not held by the recipient',
    description: 'The transfer refuses silently when the delegator no longer holds the role, and an admin can re-assign after acceptance — either way two people may think they own the duty. Only the latest accepted delegation per game and role is considered. Compare holder and to_name and settle who goes.',
    sql: `WITH latest AS (
    SELECT DISTINCT ON (sd.game, sd.role) sd.*
    FROM scorer_delegations sd
    WHERE sd.status = 'accepted'
    ORDER BY sd.game, sd.role, sd.date_updated DESC NULLS LAST, sd.id DESC
  )
  SELECT ${GAME_COLS}, ${TEAM_SPORT} AS sport, sd.id AS delegation_id, sd.role,
         concat_ws(' ', fm.first_name, fm.last_name) AS from_name,
         concat_ws(' ', tm.first_name, tm.last_name) AS to_name,
         COALESCE(concat_ws(' ', hm.first_name, hm.last_name), 'nobody') AS holder,
         to_char(sd.date_updated AT TIME ZONE 'Europe/Zurich', 'YYYY-MM-DD HH24:MI') AS accepted_at
  FROM latest sd
  JOIN games g ON g.id = sd.game
  JOIN teams t ON t.id = g.kscw_team
  LEFT JOIN members fm ON fm.id = sd.from_member
  LEFT JOIN members tm ON tm.id = sd.to_member
  LEFT JOIN members hm ON hm.id = ${ROLE_HOLDER}
  WHERE ${UPCOMING_GAME} AND (${ROLE_HOLDER}) IS DISTINCT FROM sd.to_member
  ORDER BY g.date, g.time, g.id, sd.role`,
  },
  {
    key: 'duty_team_no_licensed_official',
    section: 'duties', sport: 'both', severity: 'warn', grain: 'team',
    title: 'Active team with no licensed player on its roster',
    description: 'The engine counts licences on the ROSTER only (buildScorerTeams / buildLicenceTeams: core players, no staff): a VB team with no scorer_vb player can never be given a separate-mode scorer duty, and a BB team with no OTR1 player is disqualified from every crew — the load lands on the other teams and the no-licence surcharge applies to its adults. staff_licensed says how many coaches / TRs hold the licence anyway (they can still self-claim). MiniVB / DU20 and BB juniors up to U14 are skipped as expected. Get a player through the course, or accept the surcharge knowingly.',
    sql: `SELECT ${TEAM_COLS}, t.league,
         count(DISTINCT tp.member)::int AS pool_size,
         count(DISTINCT tp.member) FILTER (WHERE NOT tp.is_staff AND m.scorer_vb)::int AS scorer_vb_players,
         count(DISTINCT tp.member) FILTER (WHERE NOT tp.is_staff AND m.referee_vb)::int AS referee_vb_players,
         count(DISTINCT tp.member) FILTER (WHERE NOT tp.is_staff AND m.otr1_bb)::int AS otr1_players,
         count(DISTINCT tp.member) FILTER (WHERE NOT tp.is_staff AND (m.otr2_bb OR m.otn1_bb OR m.otn2_bb))::int AS otr2_otn_players,
         count(DISTINCT tp.member) FILTER (WHERE tp.is_staff
           AND CASE WHEN ${TEAM_SPORT} = 'basketball' THEN m.otr1_bb ELSE m.scorer_vb END)::int AS staff_licensed
  FROM teams t
  LEFT JOIN LATERAL (SELECT p.member, p.is_staff FROM ${teamPeopleSql('t.id')} p
                      JOIN members pm ON pm.id = p.member AND pm.kscw_membership_active
                      WHERE p.guest_level = 0) tp ON true
  LEFT JOIN members m ON m.id = tp.member
  WHERE ${ACTIVE_TEAM} AND ${SQUAD_TEAM} AND NOT ${NEVER_ON_DUTY} AND NOT ${BB_JUNIOR_TEAM}
  GROUP BY t.id, t.name, t.sport, t.league
  HAVING (${TEAM_SPORT} = 'volleyball' AND count(DISTINCT tp.member) FILTER (WHERE NOT tp.is_staff AND m.scorer_vb) = 0)
      OR (${TEAM_SPORT} = 'basketball' AND count(DISTINCT tp.member) FILTER (WHERE NOT tp.is_staff AND m.otr1_bb) = 0)
  ORDER BY t.sport, t.name`,
  },
  {
    key: 'vb_referee_coverage',
    section: 'duties', sport: 'vb', severity: 'warn', grain: 'team',
    title: 'VB team with no referee covering its SVRZ obligation',
    description: 'The standing referee map on /admin/vb-referees has no active, licensed (referee_vb) referee assigned to this team, so the club risks the federation\'s missing-referee fee for it. Junior teams (DU20, HU20) usually show here by design. Map a referee, or record an external one.',
    sql: `SELECT ${TEAM_COLS}, t.league,
         (SELECT string_agg(concat_ws(' ', rm.first_name, rm.last_name)
                             || CASE WHEN NOT rm.kscw_membership_active THEN ' (inactive)'
                                     WHEN NOT rm.referee_vb THEN ' (flag cleared)' ELSE '' END, ', ' ORDER BY rm.last_name, rm.first_name)
            FROM vb_referee_duty d JOIN members rm ON rm.id = d.referee
           WHERE d.team = t.id AND d.external = false) AS mapped_referees,
         (SELECT count(*) FROM ${teamPeopleSql('t.id')} p JOIN members pm ON pm.id = p.member
           WHERE p.guest_level = 0 AND pm.kscw_membership_active AND pm.referee_vb)::int AS referee_vb_in_pool
  FROM teams t
  WHERE ${ACTIVE_TEAM} AND ${SQUAD_TEAM} AND ${TEAM_SPORT} = 'volleyball'
    AND NOT EXISTS (SELECT 1 FROM vb_referee_duty d JOIN members rm ON rm.id = d.referee
                     WHERE d.team = t.id AND d.external = false AND rm.referee_vb AND rm.kscw_membership_active)
  ORDER BY t.name`,
  },
  {
    key: 'vb_referee_map_stale',
    section: 'duties', sport: 'vb', severity: 'warn', grain: 'player',
    title: 'VB referee map row that the page cannot render or that is missing',
    description: 'Rows of the standing referee map (/admin/vb-referees) that have gone stale: a licensed active referee mapped to no team, a mapped referee whose referee_vb flag was cleared or who left the club, or a mapping to a team clone that was archived. Tidy the map so the coverage view tells the truth.',
    sql: `SELECT ${MEMBER_COLS}, 'referee_not_mapped' AS issue, NULL::text AS team, NULL::text AS external_label
  FROM members m
  WHERE m.referee_vb AND m.kscw_membership_active AND ${REAL_PERSON}
    AND NOT EXISTS (SELECT 1 FROM vb_referee_duty d WHERE d.referee = m.id)
  UNION ALL
  SELECT ${MEMBER_COLS},
         CASE WHEN NOT m.kscw_membership_active THEN 'referee_inactive'
              WHEN NOT m.referee_vb THEN 'flag_cleared'
              ELSE 'team_archived' END AS issue,
         t.name AS team, d.external_label
  FROM vb_referee_duty d
  JOIN members m ON m.id = d.referee
  LEFT JOIN teams t ON t.id = d.team
  WHERE NOT m.kscw_membership_active OR NOT m.referee_vb
     OR (d.team IS NOT NULL AND (t.id IS NULL OR NOT t.active))
  ORDER BY issue, last_name, first_name, team, member_id`,
  },
  {
    key: 'vb_sv_referee_not_flagged',
    section: 'duties', sport: 'vb', severity: 'info', grain: 'player',
    title: 'Member referees our SV fixtures but referee_vb is false',
    description: 'games.referees_json is the federation\'s external referee roster for our fixtures (id = licence number); a member who appears on it this season holds an SVRZ referee licence, yet referee_vb — the club\'s own referee roster, the engine\'s referee credit and the /admin/vb-referees map — says no. Often somebody who referees for another club, which is fine; otherwise add them to the ClubDesk "VB Schiedsrichter*innen" group (the Saturday import sets the flag).',
    sql: `SELECT ${MEMBER_COLS}, m.license_nr, m.kscw_membership_active AS active_member,
         count(DISTINCT g.id)::int AS games_refereed, min(g.date)::text AS first_date, max(g.date)::text AS last_date,
         string_agg(DISTINCT g.league, ', ') AS leagues
  FROM games g
  CROSS JOIN LATERAL json_array_elements(CASE WHEN json_typeof(g.referees_json) = 'array' THEN g.referees_json ELSE '[]'::json END) e
  JOIN members m ON btrim(COALESCE(m.license_nr, '')) ~ '^[0-9]+$' AND btrim(COALESCE(e->>'id', '')) ~ '^[0-9]+$'
                AND btrim(m.license_nr)::bigint = btrim(e->>'id')::bigint
  WHERE g.season = {{season}} AND NOT m.referee_vb AND ${REAL_PERSON}
  GROUP BY m.id, m.first_name, m.last_name, m.license_nr, m.kscw_membership_active
  ORDER BY games_refereed DESC, m.last_name, m.first_name, m.id`,
  },
  {
    key: 'scorer_licence_register_mismatch',
    section: 'duties', sport: 'vb', severity: 'warn', grain: 'player',
    title: 'Scorer or referee flag disagrees with Volleymanager or ClubDesk',
    description: 'Flag vs register, by licence number (the full 5-step match cascade lives on /admin/scorer-vm-check — use it to confirm). flagged_cleared_next_sync: scorer_vb with no register backing, the Monday sync will clear it and assignments become unlicensed. vm_writer / cd_vb_sc / vm_referee / cd_referee_group _not_flagged: a register says yes but the flag is off — the sync is failing or has not run. cd_vb_sc_not_flagged must read 0.',
    sql: `WITH j AS (
    SELECT m.id, m.first_name, m.last_name, m.license_nr, m.scorer_vb, m.referee_vb,
           vm.id AS vm_id, COALESCE(vm.is_writer, false) AS vm_writer, COALESCE(vm.is_referee, false) AS vm_referee,
           upper(btrim(COALESCE(c.offiziellen_lizenz, ''))) AS cd_lizenz,
           (COALESCE(c.gruppen_bracketed, '') ~* '(^|,)\\s*VB Schiedsrichter\\*innen\\s*(,|$)') AS cd_referee_group
    FROM members m
    ${VM_JOIN}
    LEFT JOIN clubdesk_export c ON btrim(c.clubdesk_id) = NULLIF(btrim(m.clubdesk_id), '')
    WHERE m.kscw_membership_active AND ${REAL_PERSON}
  ), k AS (
    SELECT j.*, CASE
      WHEN j.scorer_vb AND j.vm_id IS NOT NULL AND NOT j.vm_writer
           AND NOT (j.cd_lizenz = 'VB SC' OR j.vm_referee OR j.cd_referee_group) THEN 'flagged_cleared_next_sync'
      WHEN NOT j.scorer_vb AND j.vm_writer THEN 'vm_writer_not_flagged'
      WHEN NOT j.scorer_vb AND j.cd_lizenz = 'VB SC' THEN 'cd_vb_sc_not_flagged'
      WHEN NOT j.referee_vb AND j.vm_referee THEN 'vm_referee_not_flagged'
      WHEN NOT j.referee_vb AND j.cd_referee_group THEN 'cd_referee_group_not_flagged'
      END AS issue
    FROM j
  )
  SELECT id AS member_id, first_name, last_name, issue, license_nr, scorer_vb, referee_vb,
         (vm_id IS NOT NULL) AS in_vm, vm_writer, vm_referee, cd_lizenz
  FROM k
  WHERE issue IS NOT NULL
  ORDER BY issue, last_name, first_name, id`,
  },
  {
    key: 'scorer_course_passed_unflagged',
    section: 'duties', sport: 'vb', severity: 'warn', grain: 'player',
    title: 'Member passed the scorer exam but scorer_vb is still false',
    description: 'Course participants who passed the exam (exam_result; the exam_passed column is dead) and are members by licence number, but the register lag (Volleymanager indoorwriter list / ClubDesk VB SC) has not reached scorer_vb yet — they cannot claim scorer spots and still owe the no-licence surcharge. Chase the federation if weeks_since_exam is above 2.',
    sql: `SELECT ${MEMBER_COLS}, a.form_slug AS course, a.exam_date::text AS exam_date,
         CASE WHEN a.exam_date IS NULL THEN NULL ELSE (({{today}} - a.exam_date) / 7) END AS weeks_since_exam,
         btrim(a.sv_license) AS licence_nr
  FROM scorer_course_attendance a
  JOIN members m ON btrim(COALESCE(m.license_nr, '')) ~ '^[0-9]+$'
                AND btrim(m.license_nr)::bigint = btrim(a.sv_license)::bigint
  WHERE a.exam_result = 'passed'
    AND btrim(COALESCE(a.sv_license, '')) ~ '^[0-9]+$' AND btrim(a.sv_license)::bigint <> 0
    AND NOT m.scorer_vb AND m.kscw_membership_active
    AND (a.exam_date IS NULL OR a.exam_date >= {{rollover}} - INTERVAL '1 year')
  ORDER BY a.exam_date DESC NULLS LAST, m.last_name, m.first_name, a.id`,
  },
  {
    key: 'nomination_push_not_closed',
    section: 'duties', sport: 'vb', severity: 'warn', grain: 'game',
    title: 'Einsatzliste push did not end closed for an auto-enabled VB game',
    description: 'For games whose effective auto_nomination_list flag is on (game override, else team default) the T-60 cron should leave vm_nomination_status closed. failed or NULL after kick-off means the coach had to file by hand or the list is missing in Volleymanager (fineable); filled means a validation issue kept it open; skipped means no licensed confirmed players (an RSVP problem). stranded_claim is a worker killed mid-push. Check vm_nomination_error and the Volleymanager list.',
    sql: `SELECT ${GAME_COLS}, t.name AS team,
         CASE WHEN g.vm_nomination_status = 'pending' AND g.vm_nomination_claimed_at < now() - INTERVAL '10 minutes'
              THEN 'stranded_claim' ELSE COALESCE(g.vm_nomination_status, 'never_attempted') END AS issue,
         g.vm_nomination_count AS players_filed,
         to_char(g.vm_nomination_pushed_at AT TIME ZONE 'Europe/Zurich', 'YYYY-MM-DD HH24:MI') AS pushed_at,
         left(g.vm_nomination_error, 160) AS error
  FROM games g JOIN teams t ON t.id = g.kscw_team
  WHERE left(g.game_id, 3) = 'vb_' AND g.season = {{season}} AND ${LIVE_GAME}
    AND COALESCE(g.auto_nomination_list, NULLIF(btrim(COALESCE(t.features_enabled->>'auto_nomination_list', '')), '')::boolean, false) = true
    AND ((${GAME_START} < {{now}} AND COALESCE(g.vm_nomination_status, '') <> 'closed')
      OR (g.vm_nomination_status = 'pending' AND g.vm_nomination_claimed_at < now() - INTERVAL '10 minutes'))
  ORDER BY g.date DESC, g.time DESC, g.id`,
  },
  {
    key: 'referee_fee_missing',
    section: 'duties', sport: 'vb', severity: 'warn', grain: 'game',
    title: 'Ended VB home game with no referee-fee record',
    description: 'Season-long version of the referee-expense nudge (which only looks back 14 days): every finished VB home game should carry one referee_expenses row saying who paid the federation referees, or the season-end payout run under-reimburses. Empty sv_referees may be legitimately fee-free. overdue is set after 14 days. The coach or team responsible records it from the game.',
    sql: `SELECT ${GAME_COLS}, t.name AS team, ({{today}} - g.date) AS days_ago, (({{today}} - g.date) > 14) AS overdue,
         refs.names AS sv_referees,
         (SELECT string_agg(concat_ws(' ', cm.first_name, cm.last_name), ', ' ORDER BY cm.last_name, cm.first_name)
            FROM teams_coaches tc JOIN members cm ON cm.id = tc.members_id WHERE tc.teams_id = t.id) AS coaches
  FROM games g
  JOIN teams t ON t.id = g.kscw_team AND ${TEAM_SPORT} = 'volleyball'
  LEFT JOIN LATERAL (
    SELECT string_agg(e->>'name', ', ' ORDER BY e->>'name') AS names
    FROM json_array_elements(CASE WHEN json_typeof(g.referees_json) = 'array' THEN g.referees_json ELSE '[]'::json END) e
  ) refs ON true
  WHERE ${HOME_SEASON} AND NULLIF(btrim(COALESCE(g.away_team, '')), '') IS NOT NULL
    AND COALESCE(g.status, 'scheduled') NOT IN ('cancelled', 'postponed')
    AND ${GAME_ENDED}
    AND NOT EXISTS (SELECT 1 FROM referee_expenses re WHERE re.game = g.id)
  ORDER BY g.date DESC, g.time DESC, g.id`,
  },
  {
    key: 'duty_load_per_team',
    section: 'duties', sport: 'both', severity: 'info', grain: 'team',
    title: 'Duty load per team vs own home games and licence pool',
    description: 'The fairness table behind the engine (rotation, referee credit capped at 2, manual duty_credit): duties this season per active team next to its own home games and its licence holders counted the way the engine counts them (core roster players, active, no staff) — licensed_scorers is scorer_vb (VB) or OTR1 (BB), secondary_licences is referee_vb (VB, the engine\'s referee credit) or OTR2/OTN (BB, the full-crew bonus). Unhealthy when one team carries far more duties than home games while another carries none, or when a team with duty_credit still sits above the median. MiniVB / DU20 should read 0.',
    sql: `WITH d AS (
    -- one row per (game, duty team, role); the four BB team columns collapse to one crew duty
    SELECT DISTINCT g.id AS game_id, r.duty_team AS team_id,
           CASE WHEN left(r.role, 3) = 'bb_' THEN 'bb_crew' ELSE r.role END AS role
    FROM games g
    ${DUTY_TEAM_ROWS}
    WHERE ${HOME_SEASON} AND COALESCE(g.status, 'scheduled') <> 'cancelled' AND r.duty_team IS NOT NULL
  ), by_role AS (
    SELECT team_id, role, count(*) AS n FROM d GROUP BY team_id, role
  ), agg AS (
    SELECT team_id, sum(n)::int AS duties,
           string_agg(role || ' ' || n, ', ' ORDER BY role) AS duties_by_role
    FROM by_role
    GROUP BY team_id
  )
  SELECT ${TEAM_COLS}, t.league, t.duty_credit,
         (SELECT count(*) FROM games g WHERE g.kscw_team = t.id AND ${HOME_SEASON}
            AND COALESCE(g.status, 'scheduled') <> 'cancelled')::int AS own_home_games,
         COALESCE(agg.duties, 0) AS duties, agg.duties_by_role,
         (SELECT count(*) FROM member_teams mt JOIN members m ON m.id = mt.member
           WHERE mt.team = t.id AND COALESCE(mt.guest_level, 0) = 0 AND m.kscw_membership_active
             AND CASE WHEN ${TEAM_SPORT} = 'basketball' THEN m.otr1_bb ELSE m.scorer_vb END)::int AS licensed_scorers,
         (SELECT count(*) FROM member_teams mt JOIN members m ON m.id = mt.member
           WHERE mt.team = t.id AND COALESCE(mt.guest_level, 0) = 0 AND m.kscw_membership_active
             AND CASE WHEN ${TEAM_SPORT} = 'basketball' THEN (m.otr2_bb OR m.otn1_bb OR m.otn2_bb) ELSE m.referee_vb END)::int AS secondary_licences
  FROM teams t
  LEFT JOIN agg ON agg.team_id = t.id
  WHERE ${ACTIVE_TEAM} AND ${SQUAD_TEAM}
  ORDER BY t.sport, COALESCE(agg.duties, 0) DESC, t.name`,
  },
]
