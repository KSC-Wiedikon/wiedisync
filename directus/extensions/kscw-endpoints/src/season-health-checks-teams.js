/**
 * Season health — teams & staff.
 *
 * What "healthy" means for a team row this season: it is the active row of
 * its lineage, stamped with the current season label, linked to its
 * federation (Swiss Volley `team_id` / Basketplan `bb_source_id`), staffed by
 * a coach and a team responsible who can actually log in, with a captain who
 * is on its roster and enough core players to field a side.
 *
 * Conventions this module leans on (see season-health-sql.js for the why):
 *   - `teams.active` is the ONLY season guard for rosters and staff. The
 *     rollover CLONES staff junctions onto the new team id and leaves the old
 *     rows on the archived team, so "coach of an inactive team" is normal —
 *     every people check joins `teams` with ACTIVE_TEAM.
 *   - `member_teams` is players/guests only; staff live in `teams_coaches` /
 *     `teams_responsibles` (STAFF_ROWS below, teamPeopleSql for the union).
 *   - Umbrellas (`clubdesk_group = ''`) are league holding rows, not squads:
 *     no staff expected, huge rosters. SQUAD_TEAM drops them from the "no
 *     coach / no TR / no captain" checks. They keep their federation link
 *     (the 1LR fixtures sync onto them) so the link check includes them.
 *   - Sport comes from `lower(t.sport)` only. `Herren 2` is basketball.
 */
import {
  ACTIVE_TEAM, SQUAD_TEAM, TEAM_SPORT, CORE_PLAYER, REAL_PERSON, UPCOMING_GAME,
  VM_JOIN, BP_LICENSED, LIVE_SLOT, teamPeopleSql, MEMBER_COLS, TEAM_COLS,
} from './season-health-sql.js'

// ── Local helpers ────────────────────────────────────────────────────────

/**
 * Both staff junctions as one relation (role, teams_id, members_id). A member
 * who is coach AND team responsible of the same team yields two rows — that
 * is intended where the role is reported, and de-duplicated where it is not.
 */
const STAFF_ROWS = `(
  SELECT 'coach' AS role, tc.teams_id, tc.members_id FROM teams_coaches tc
  UNION ALL
  SELECT 'team_responsible' AS role, tr.teams_id, tr.members_id FROM teams_responsibles tr
)`

/**
 * Swiss Volley team ids the fixture sync accepts — a copy of the
 * module-private `SV_TEAM_IDS` in sv-sync.js (kept there on purpose: the sync
 * must not import the health registry). A VB team whose `team_id` numeric
 * part is missing here silently gets no games and no rankings, and nothing
 * else in the schema can tell you that. Update BOTH lists when a team joins
 * Swiss Volley.
 */
const SV_TEAM_IDS = [
  '12747', '2743', '541',
  '1393', '1395', '4689', '1394',
  '7563', '15103', '2301', '14040',
  '6023',
]
const SV_ALLOWLIST = `ARRAY[${SV_TEAM_IDS.map((id) => `'${id}'`).join(', ')}]::text[]`

/**
 * `members.position` is jsonb that may be an array, a bare string or NULL —
 * normalise to an array before jsonb_array_elements_text or one odd row
 * aborts the statement. "Playing position" mirrors coercePositions() +
 * isNonPlayingStaff() (src/utils/memberPositions.ts): the frontend first
 * DROPS every code outside its vocabulary, then treats 'other' and
 * 'staff_only' as non-playing — so an unknown code ('coach', 'Trainer') is
 * non-playing too. A positive list, not `NOT IN ('other','staff_only')`.
 */
const POSITION_ARRAY = `CASE
    WHEN jsonb_typeof(m.position) = 'array' THEN m.position
    WHEN jsonb_typeof(m.position) = 'string' THEN jsonb_build_array(m.position)
    ELSE '[]'::jsonb END`
const PLAYING_POSITIONS = `('setter', 'outside', 'middle', 'opposite', 'libero',
     'point_guard', 'shooting_guard', 'small_forward', 'power_forward', 'center', 'guest')`
const HAS_PLAYING_POSITION = `EXISTS (
    SELECT 1 FROM jsonb_array_elements_text(${POSITION_ARRAY}) p
    WHERE p IN ${PLAYING_POSITIONS})`

/**
 * Same-lineage predicate between two team rows — the rollover's own
 * idempotency key (game-scheduling.js rollover-season, js-export.js): the
 * external `team_id` when set, else name + sport. team_id first matters:
 * D1/D2 swapped NAMES between 2025/26 and 2026/27 and kept their Swiss
 * Volley ids, so a name-keyed lineage points at the wrong squad.
 */
const SAME_LINEAGE = (a, b) => `((NULLIF(btrim(${a}.team_id), '') IS NOT NULL AND btrim(${b}.team_id) = btrim(${a}.team_id))
        OR (NULLIF(btrim(${a}.team_id), '') IS NULL
            AND lower(btrim(${b}.name)) = lower(btrim(${a}.name))
            AND lower(${b}.sport) IS NOT DISTINCT FROM lower(${a}.sport)))`

/**
 * Club-wide Spielplaner as game-scheduling.js spielplanerCanManageTeam()
 * resolves it: `is_spielplaner` AND *no* spielplaner_assignments rows (an
 * assignment turns the flag holder into a SCOPED scheduler limited to the
 * assigned teams), resolved through `members.user`, so a flag on a member
 * without a login owns nothing. Alias members as `m`.
 */
const CLUB_WIDE_SPIELPLANER = `m.is_spielplaner AND m."user" IS NOT NULL AND m.kscw_membership_active
      AND ${REAL_PERSON}
      AND NOT EXISTS (SELECT 1 FROM spielplaner_assignments sa2 WHERE sa2.member = m.id)`

/** Minimum core roster to field a side — new constants, nothing in the repo defines one. */
const MIN_ROSTER = `CASE WHEN ${TEAM_SPORT} = 'volleyball' THEN 6 ELSE 5 END`

/** Timestamp columns compared against the Zurich wall-clock anchor. */
const NOW_TZ = `({{now}} AT TIME ZONE 'Europe/Zurich')`

// ── Per-team season KPI table (not a finding) ────────────────────────────

/**
 * One row per ACTIVE team, umbrellas included (flagged). Every count is a
 * LATERAL aggregate on its own so the roster, games, trainings and slot
 * joins never multiply each other. Licence columns are sport-specific:
 * VB `licence_ok` = VolleyManager activated AND validated, `licence_activated`
 * = activated only; BB `licence_ok` = Basketplan licence scraped this season,
 * `licence_activated` NULL (Basketplan has no such state).
 */
export const TEAM_SUMMARY_SQL = `
SELECT ${TEAM_COLS}, t.league, t.gender,
       (t.clubdesk_group IS NOT NULL AND t.clubdesk_group = '') AS umbrella,
       COALESCE(r.players, 0) AS players,
       COALESCE(r.guests, 0) AS guests,
       COALESCE(r.players_with_login, 0) AS players_with_login,
       COALESCE(r.dues_paid, 0) AS dues_paid,
       r.licence_ok,
       r.licence_activated,
       (SELECT count(*) FROM teams_coaches tc WHERE tc.teams_id = t.id)::int AS coaches,
       (SELECT count(*) FROM teams_responsibles trs WHERE trs.teams_id = t.id)::int AS team_responsibles,
       (t.captain IS NOT NULL) AS has_captain,
       COALESCE(gm.games_total, 0) AS games_total,
       COALESCE(gm.games_home, 0) AS games_home,
       COALESCE(gm.games_played, 0) AS games_played,
       COALESCE(gm.games_upcoming, 0) AS games_upcoming,
       COALESCE(tn.trainings_total, 0) AS trainings_total,
       COALESCE(tn.trainings_next_4w, 0) AS trainings_next_4w,
       COALESCE(sl.hall_slots, 0) AS hall_slots,
       COALESCE(o.licensed_officials, 0) AS licensed_officials
FROM teams t
LEFT JOIN LATERAL (
  SELECT count(*) FILTER (WHERE x.core)::int AS players,
         count(*) FILTER (WHERE NOT x.core)::int AS guests,
         count(*) FILTER (WHERE x.core AND x.has_login)::int AS players_with_login,
         count(*) FILTER (WHERE x.core AND x.dues_ok)::int AS dues_paid,
         CASE WHEN ${TEAM_SPORT} = 'volleyball' THEN count(*) FILTER (WHERE x.core AND x.vm_activated AND x.vm_validated)::int
              WHEN ${TEAM_SPORT} = 'basketball' THEN count(*) FILTER (WHERE x.core AND x.bp_licensed)::int
         END AS licence_ok,
         CASE WHEN ${TEAM_SPORT} = 'volleyball' THEN count(*) FILTER (WHERE x.core AND x.vm_activated)::int
         END AS licence_activated
  FROM (
    SELECT ${CORE_PLAYER} AS core,
           m.wiedisync_active AS has_login,
           (m.dues_paid AND m.dues_paid_season = {{season}}) AS dues_ok,
           (vm.licence_activated IS TRUE) AS vm_activated,
           (vm.licence_validated IS TRUE) AS vm_validated,
           (${TEAM_SPORT} = 'basketball' AND ${BP_LICENSED}) AS bp_licensed
    FROM member_teams mt
    JOIN members m ON m.id = mt.member
    ${VM_JOIN}
    WHERE mt.team = t.id
  ) x
) r ON true
LEFT JOIN LATERAL (
  SELECT count(*)::int AS games_total,
         count(*) FILTER (WHERE g.type = 'home')::int AS games_home,
         count(*) FILTER (WHERE g.status = 'completed')::int AS games_played,
         count(*) FILTER (WHERE ${UPCOMING_GAME})::int AS games_upcoming
  FROM games g
  WHERE g.kscw_team = t.id AND g.season = {{season}}
) gm ON true
LEFT JOIN LATERAL (
  SELECT count(*)::int AS trainings_total,
         count(*) FILTER (WHERE tr.date >= {{today}} AND tr.date < {{today}} + 28)::int AS trainings_next_4w
  FROM trainings tr
  WHERE tr.team = t.id AND NOT tr.cancelled AND tr.date >= {{rollover}}
) tn ON true
LEFT JOIN LATERAL (
  SELECT count(DISTINCT hs.id)::int AS hall_slots
  FROM hall_slots_teams hst
  JOIN hall_slots hs ON hs.id = hst.hall_slots_id
  WHERE hst.teams_id = t.id AND ${LIVE_SLOT}
) sl ON true
LEFT JOIN LATERAL (
  SELECT count(DISTINCT p.member)::int AS licensed_officials
  FROM ${teamPeopleSql('t.id')} p
  JOIN members m ON m.id = p.member
  WHERE (${TEAM_SPORT} = 'volleyball' AND m.scorer_vb)
     OR (${TEAM_SPORT} = 'basketball' AND (m.otr1_bb OR m.otr2_bb OR m.otn1_bb OR m.otn2_bb))
) o ON true
WHERE ${ACTIVE_TEAM}
ORDER BY sport, t.name, t.id`

// ── Findings ─────────────────────────────────────────────────────────────

export const CHECKS = [
  {
    key: 'team_no_coach',
    section: 'teams',
    sport: 'both',
    severity: 'error',
    grain: 'team',
    title: 'Active team without a coach',
    description: 'No teams_coaches row on a current-season squad: nobody holds the leader policy for it, gets join requests or can manage its RSVPs. Add a coach on the team page. League umbrellas are excluded by design.',
    sql: `
SELECT ${TEAM_COLS}, t.league, t.season,
       (SELECT count(*) FROM teams_responsibles tr WHERE tr.teams_id = t.id)::int AS team_responsibles,
       (SELECT count(*) FROM member_teams mt WHERE mt.team = t.id AND ${CORE_PLAYER})::int AS players
FROM teams t
WHERE ${ACTIVE_TEAM} AND ${SQUAD_TEAM}
  AND NOT EXISTS (SELECT 1 FROM teams_coaches tc WHERE tc.teams_id = t.id)
ORDER BY sport, t.name, t.id`,
  },
  {
    key: 'team_no_responsible',
    section: 'teams',
    sport: 'both',
    severity: 'warn',
    grain: 'team',
    title: 'Active team without a team responsible',
    description: 'No teams_responsibles row. The TR is the second staff role (join-request notifications, duty contact); a team with only a coach has a single point of failure. Add one on the team page.',
    sql: `
SELECT ${TEAM_COLS}, t.league, t.season,
       (SELECT count(*) FROM teams_coaches tc WHERE tc.teams_id = t.id)::int AS coaches,
       (SELECT count(*) FROM member_teams mt WHERE mt.team = t.id AND ${CORE_PLAYER})::int AS players
FROM teams t
WHERE ${ACTIVE_TEAM} AND ${SQUAD_TEAM}
  AND NOT EXISTS (SELECT 1 FROM teams_responsibles tr WHERE tr.teams_id = t.id)
ORDER BY sport, t.name, t.id`,
  },
  {
    key: 'team_no_captain',
    section: 'teams',
    sport: 'both',
    severity: 'info',
    grain: 'team',
    title: 'Active team without a captain',
    description: 'teams.captain is empty. Cosmetic for most flows, but the roster badge and the team-finance payer fallback use it. The coach sets the captain from the roster editor.',
    sql: `
SELECT ${TEAM_COLS}, t.league,
       (SELECT count(*) FROM member_teams mt WHERE mt.team = t.id AND ${CORE_PLAYER})::int AS players
FROM teams t
WHERE ${ACTIVE_TEAM} AND ${SQUAD_TEAM} AND t.captain IS NULL
ORDER BY sport, t.name, t.id`,
  },
  {
    key: 'team_captain_invalid',
    section: 'teams',
    sport: 'both',
    severity: 'error',
    grain: 'team',
    title: 'Captain not on the roster, a guest, or an inactive member',
    description: 'Nothing keeps teams.captain in step with member_teams: a captain who left the roster, became a guest or was deactivated stays captain silently. Pick a new captain in the roster editor.',
    sql: `
SELECT ${TEAM_COLS}, ${MEMBER_COLS},
       CASE WHEN mt.id IS NULL THEN 'not_on_roster'
            WHEN COALESCE(mt.guest_level, 0) > 0 THEN 'guest'
            WHEN NOT m.kscw_membership_active THEN 'member_inactive' END AS reason,
       mt.guest_level,
       m.kscw_membership_active AS member_active,
       m.register_status
FROM teams t
JOIN members m ON m.id = t.captain
LEFT JOIN member_teams mt ON mt.team = t.id AND mt.member = t.captain
WHERE ${ACTIVE_TEAM}
  AND (mt.id IS NULL OR COALESCE(mt.guest_level, 0) > 0 OR NOT m.kscw_membership_active)
ORDER BY sport, t.name, t.id`,
  },
  {
    key: 'team_roster_below_minimum',
    section: 'teams',
    sport: 'both',
    severity: 'warn',
    grain: 'team',
    title: 'Roster below minimum size (6 VB / 5 BB active core players)',
    description: 'Fewer core players (guest_level 0, club membership active) than it takes to field a side. Guests and deactivated members do not count. Recruit, promote guests, or archive the team.',
    sql: `
SELECT ${TEAM_COLS}, t.league,
       count(mt.id) FILTER (WHERE ${CORE_PLAYER} AND m.kscw_membership_active)::int AS players,
       count(mt.id) FILTER (WHERE ${CORE_PLAYER} AND NOT m.kscw_membership_active)::int AS inactive_players,
       count(mt.id) FILTER (WHERE COALESCE(mt.guest_level, 0) > 0)::int AS guests,
       ${MIN_ROSTER} AS minimum
FROM teams t
LEFT JOIN member_teams mt ON mt.team = t.id
LEFT JOIN members m ON m.id = mt.member
WHERE ${ACTIVE_TEAM}
GROUP BY t.id
HAVING count(mt.id) FILTER (WHERE ${CORE_PLAYER} AND m.kscw_membership_active) < ${MIN_ROSTER}
ORDER BY sport, players, t.name, t.id`,
  },
  {
    key: 'team_no_federation_link',
    section: 'teams',
    sport: 'both',
    severity: 'error',
    grain: 'team',
    title: 'Active team without a usable Swiss Volley / Basketplan id',
    description: 'sv-sync maps fixtures via teams.team_id (vb_<id>, only ids in its allow-list) and bp-sync via bb_source_id — both key their lookup on the RAW string, so stray whitespace is as broken as an empty id. An unlinked team never receives games or rankings and the nomination push cannot resolve it. Fix the id on the team, or add it to SV_TEAM_IDS in sv-sync.js. A volleyball team that is deliberately not registered with Swiss Volley carries a zero-padded placeholder (vb_00001) and is not listed.',
    sql: `
SELECT ${TEAM_COLS}, t.league,
       t.team_id AS federation_team_id, t.bb_source_id,
       CASE WHEN ${TEAM_SPORT} = 'volleyball' AND NULLIF(btrim(t.team_id), '') IS NULL THEN 'missing_vm_id'
            WHEN ${TEAM_SPORT} = 'volleyball' AND t.team_id !~ '^vb_[1-9][0-9]*$' THEN 'malformed_vm_id'
            WHEN ${TEAM_SPORT} = 'volleyball' AND NOT (substr(t.team_id, 4) = ANY (${SV_ALLOWLIST})) THEN 'not_in_sv_allowlist'
            WHEN ${TEAM_SPORT} = 'basketball' AND NULLIF(btrim(t.bb_source_id), '') IS NULL THEN 'missing_basketplan_id'
            WHEN ${TEAM_SPORT} = 'basketball' AND t.bb_source_id !~ '^[0-9]+$' THEN 'malformed_basketplan_id'
       END AS reason
FROM teams t
WHERE ${ACTIVE_TEAM}
  AND ((${TEAM_SPORT} = 'volleyball'
        AND NOT (t.team_id ~ '^vb_0[0-9]*$')
        AND (NULLIF(btrim(t.team_id), '') IS NULL
             OR t.team_id !~ '^vb_[1-9][0-9]*$'
             OR NOT (substr(t.team_id, 4) = ANY (${SV_ALLOWLIST}))))
    OR (${TEAM_SPORT} = 'basketball'
        AND (NULLIF(btrim(t.bb_source_id), '') IS NULL OR t.bb_source_id !~ '^[0-9]+$')))
ORDER BY sport, t.name, t.id`,
  },
  {
    key: 'team_duplicate_active_identity',
    section: 'teams',
    sport: 'both',
    severity: 'error',
    grain: 'team',
    title: 'Two active teams share a federation id or name',
    description: 'Both syncs build lookups over ACTIVE teams keyed by team_id / bb_source_id, and the app resolves /teams/:name by name + active with NO sport filter (TeamDetail, RosterEditor, limit 1) — so a name shared ACROSS sports collides too. A duplicate makes fixture linking and the team pages pick an arbitrary row. Archive or re-key one of them.',
    sql: `
WITH ident AS (
  SELECT t.id, 'team_id' AS kind, btrim(t.team_id) AS shared_key
  FROM teams t WHERE ${ACTIVE_TEAM} AND NULLIF(btrim(t.team_id), '') IS NOT NULL
  UNION ALL
  SELECT t.id, 'bb_source_id', btrim(t.bb_source_id)
  FROM teams t WHERE ${ACTIVE_TEAM} AND NULLIF(btrim(t.bb_source_id), '') IS NOT NULL
  UNION ALL
  SELECT t.id, 'name', lower(btrim(t.name))
  FROM teams t WHERE ${ACTIVE_TEAM}
)
SELECT ${TEAM_COLS}, t.league, d.kind, d.shared_key,
       string_agg(o.id::text || ' ' || ot.name, ', ' ORDER BY o.id) AS shared_with
FROM ident d
JOIN ident o ON o.kind = d.kind AND o.shared_key = d.shared_key AND o.id <> d.id
JOIN teams t ON t.id = d.id
JOIN teams ot ON ot.id = o.id
GROUP BY t.id, d.kind, d.shared_key
ORDER BY sport, t.name, t.id, d.kind`,
  },
  {
    key: 'team_season_stale',
    section: 'teams',
    sport: 'both',
    severity: 'error',
    grain: 'team',
    title: 'Active team still carrying last season\'s label',
    description: 'An active team whose teams.season is not the current label. After Jun 1 this is EVERY team until the season rollover (Terminplanung → rollover-season, manual, no cron) has been run — that is the "rollover pending" signal, not noise: fixtures and rosters keep landing on last season\'s rows. Run the rollover; for a single odd row, fix the label.',
    sql: `
SELECT ${TEAM_COLS}, t.league, t.season, {{season}} AS expected_season
FROM teams t
WHERE ${ACTIVE_TEAM} AND t.season IS DISTINCT FROM {{season}}
ORDER BY sport, t.name, t.id`,
  },
  {
    key: 'team_archived_current_season',
    section: 'teams',
    sport: 'both',
    severity: 'warn',
    grain: 'team',
    title: 'Archived team stamped with the current season',
    description: 'A team row with active = false but this season\'s label — a squad that was cloned by the rollover and then discontinued by hand (MiniVB 2026/27). Harmless today, but the rollover clones EVERY row of the from-season, active or not, so this team comes back as active next June with whatever roster and staff it still holds. Delete the row if it holds nothing, or expect to re-archive it after the next rollover.',
    sql: `
SELECT ${TEAM_COLS}, t.league, t.season,
       (SELECT count(*) FROM member_teams mt WHERE mt.team = t.id)::int AS roster_rows,
       (SELECT count(*) FROM ${STAFF_ROWS} s WHERE s.teams_id = t.id)::int AS staff_rows
FROM teams t
WHERE NOT t.active AND t.season = {{season}}
ORDER BY sport, t.name, t.id`,
  },
  {
    key: 'team_invalid_sport_or_league',
    section: 'teams',
    sport: 'both',
    severity: 'warn',
    grain: 'team',
    title: 'Active team with invalid sport, empty league or no gender',
    description: 'teams.sport has no CHECK — anything but the two literals breaks every sport bucket (pickers, member-sport resolution). An empty league hides the team from league views; NULL gender puts it in every gendered picker. Fix the team settings.',
    sql: `
SELECT t.id AS team_id, t.name AS team,
       CASE WHEN ${TEAM_SPORT} IN ('volleyball', 'basketball') THEN ${TEAM_SPORT} END AS sport,
       t.sport AS sport_value, t.league, t.gender,
       CASE WHEN t.sport IS NULL OR t.sport NOT IN ('volleyball', 'basketball') THEN 'invalid_sport'
            WHEN NULLIF(btrim(t.league), '') IS NULL THEN 'no_league'
            WHEN t.gender IS NULL THEN 'no_gender' END AS reason
FROM teams t
WHERE ${ACTIVE_TEAM}
  AND (t.sport IS NULL OR t.sport NOT IN ('volleyball', 'basketball')
       OR NULLIF(btrim(t.league), '') IS NULL
       OR t.gender IS NULL)
ORDER BY reason, sport, t.name, t.id`,
  },
  {
    key: 'coach_no_trainer_licence',
    section: 'teams',
    sport: 'both',
    severity: 'info',
    grain: 'player',
    title: 'Coach without a recorded sport-appropriate trainer licence',
    description: 'members.trainer_licences is empty, or holds only the other sport\'s ladder (VB C/B/A and BB T1/T2/T3 never map onto each other; J+S counts for both). Empty usually means "not recorded" — ask the coach and enter it on the profile.',
    sql: `
SELECT ${MEMBER_COLS}, ${TEAM_COLS}, m.trainer_licences,
       CASE WHEN NULLIF(btrim(m.trainer_licences), '') IS NULL THEN 'none_recorded'
            ELSE 'other_sport_ladder_only' END AS reason
FROM teams_coaches tc
JOIN teams t ON t.id = tc.teams_id AND ${ACTIVE_TEAM}
JOIN members m ON m.id = tc.members_id
WHERE ${REAL_PERSON}
  AND (NULLIF(btrim(m.trainer_licences), '') IS NULL
       OR (${TEAM_SPORT} = 'volleyball' AND m.trainer_licences !~ '(^|,)(JS|C|B|A)(,|$)')
       OR (${TEAM_SPORT} = 'basketball' AND m.trainer_licences !~ '(^|,)(JS|T1|T2|T3)(,|$)'))
ORDER BY sport, t.name, m.last_name, m.first_name, m.id`,
  },
  {
    key: 'staff_no_app_login',
    section: 'teams',
    sport: 'both',
    severity: 'warn',
    grain: 'player',
    title: 'Coach or team responsible who cannot use the app',
    description: 'Staff who cannot act in the app: club membership ended (member_inactive — remove them from the team), an invited-but-unclaimed shell, no Directus user at all (no leader policy is ever attached, no join-request or RSVP notifications), a suspended/archived Directus user, or an account that exists but has never logged in (wiedisync_active flips on first login / set-password). Invite or re-invite them, or reactivate the user.',
    sql: `
SELECT ${MEMBER_COLS}, ${TEAM_COLS}, s.role, m.email,
       CASE WHEN NOT m.kscw_membership_active THEN 'member_inactive'
            WHEN m.shell THEN 'unclaimed_shell'
            WHEN m."user" IS NULL THEN 'no_account'
            WHEN du.status IS DISTINCT FROM 'active' THEN 'user_' || COALESCE(du.status, 'unknown')
            WHEN NOT m.wiedisync_active THEN 'never_logged_in' END AS reason
FROM ${STAFF_ROWS} s
JOIN teams t ON t.id = s.teams_id AND ${ACTIVE_TEAM}
JOIN members m ON m.id = s.members_id
LEFT JOIN directus_users du ON du.id = m."user"
WHERE ${REAL_PERSON}
  AND (NOT m.kscw_membership_active OR m.shell OR m."user" IS NULL
       OR du.status IS DISTINCT FROM 'active' OR NOT m.wiedisync_active)
ORDER BY sport, t.name, s.role, m.last_name, m.first_name, m.id`,
  },
  {
    key: 'join_requests_stale',
    section: 'teams',
    sport: 'both',
    severity: 'warn',
    grain: 'player',
    title: 'Join request pending for over 14 days or aimed at an archived team',
    description: 'Two approval paths exist (team_requests rows, and members.requested_team with coach_approved_team=false). The pending list only shows requests pointing at the ACTIVE team id, so a request against last season\'s row is invisible forever. Reasons: member_inactive — the person left the club, reject/clear it; already_on_roster — the roster row exists on the team (or its current-season successor) but the request was never closed, mark it approved; team_archived — re-point it to this season\'s row; stale — nobody acted for 14 days (for the requested_team path the age is measured from the member row\'s creation, which the account-claim flow can predate).',
    sql: `
SELECT ${MEMBER_COLS}, t.id AS team_id, t.name AS team, ${TEAM_SPORT} AS sport,
       r.source,
       to_char(r.requested_at AT TIME ZONE 'Europe/Zurich', 'YYYY-MM-DD') AS requested_on,
       t.active AS team_active,
       CASE WHEN NOT m.kscw_membership_active THEN 'member_inactive'
            WHEN EXISTS (SELECT 1 FROM member_teams mt JOIN teams x ON x.id = mt.team
                          WHERE mt.member = m.id AND (x.id = t.id OR (x.active AND ${SAME_LINEAGE('t', 'x')}))) THEN 'already_on_roster'
            WHEN NOT t.active THEN 'team_archived'
            ELSE 'stale' END AS reason
FROM (
  SELECT 'team_requests' AS source, tr.member AS member_id, tr.team AS team_id, tr.date_created AS requested_at
  FROM team_requests tr
  WHERE COALESCE(tr.status, 'pending') = 'pending'
  UNION ALL
  SELECT 'requested_team', m.id, m.requested_team, m.date_created
  FROM members m
  WHERE m.requested_team IS NOT NULL AND NOT m.coach_approved_team
) r
JOIN members m ON m.id = r.member_id
JOIN teams t ON t.id = r.team_id
WHERE ${REAL_PERSON}
  AND (NOT m.kscw_membership_active OR NOT t.active
       OR EXISTS (SELECT 1 FROM member_teams mt JOIN teams x ON x.id = mt.team
                   WHERE mt.member = m.id AND (x.id = t.id OR (x.active AND ${SAME_LINEAGE('t', 'x')})))
       OR r.requested_at < ${NOW_TZ} - INTERVAL '14 days')
ORDER BY reason, r.requested_at, m.last_name, m.first_name, m.id`,
  },
  {
    key: 'coach_stray_roster_row',
    section: 'teams',
    sport: 'both',
    severity: 'info',
    grain: 'player',
    title: 'Coach or TR also on the roster without a playing position',
    description: 'A staff member WITH a member_teams row and no player position is almost always a stray seed row: it inflates player counts, RSVP tallies and ClubDesk player groups. A genuine player-coach has a real position and is fine. Remove the roster row or set a position.',
    sql: `
SELECT ${MEMBER_COLS}, ${TEAM_COLS}, s.role, m.position::text AS positions, mt.guest_level
FROM member_teams mt
JOIN teams t ON t.id = mt.team AND ${ACTIVE_TEAM}
JOIN members m ON m.id = mt.member
JOIN LATERAL (
  SELECT string_agg(sr.role, ', ' ORDER BY sr.role) AS role
  FROM ${STAFF_ROWS} sr
  WHERE sr.teams_id = t.id AND sr.members_id = m.id
) s ON s.role IS NOT NULL
WHERE ${REAL_PERSON} AND NOT ${HAS_PLAYING_POSITION}
ORDER BY sport, t.name, m.last_name, m.first_name, m.id`,
  },
  {
    key: 'staff_junction_dangling',
    section: 'teams',
    sport: 'both',
    severity: 'info',
    grain: 'team',
    title: 'Archived team with staff rows and no successor this season',
    description: 'Archived teams keep cloned staff rows — normal. But an archived team with NO active successor in its lineage (same team_id, else same name + sport) was dropped or renamed at rollover; its coaches still hold the leader policy and count for member-sport resolution. Triage: re-point or delete the junction rows.',
    sql: `
SELECT ${TEAM_COLS}, t.season, t.league,
       count(*)::int AS staff_rows,
       string_agg(m.first_name || ' ' || m.last_name, ', ' ORDER BY m.last_name, m.first_name) AS staff
FROM ${STAFF_ROWS} s
JOIN teams t ON t.id = s.teams_id
JOIN members m ON m.id = s.members_id
WHERE NOT t.active
  AND NOT EXISTS (SELECT 1 FROM teams n WHERE n.active AND ${SAME_LINEAGE('t', 'n')})
GROUP BY t.id
ORDER BY t.season DESC, sport, t.name, t.id`,
  },
  {
    key: 'vb_team_no_spielplaner',
    section: 'teams',
    sport: 'vb',
    severity: 'info',
    grain: 'team',
    title: 'Volleyball team with nobody owning its home-game scheduling',
    description: 'Home-game scheduling is owned by a per-team spielplaner_assignments row or by a club-wide Spielplaner (members.is_spielplaner with NO assignment rows — an assignment turns the flag holder into a scoped scheduler, spielplanerCanManageTeam). Only members with a login and active membership count. Rows appear when the club has no unrestricted club-wide Spielplaner and the team has no usable assignment. Assign one under Spielplanung.',
    sql: `
SELECT ${TEAM_COLS}, t.league,
       (SELECT count(*) FROM teams_coaches tc WHERE tc.teams_id = t.id)::int AS coaches,
       (SELECT count(*) FROM spielplaner_assignments sa WHERE sa.kscw_team = t.id)::int AS assignments,
       (SELECT count(*) FROM members m WHERE m.is_spielplaner)::int AS spielplaner_flags
FROM teams t
WHERE ${ACTIVE_TEAM} AND ${SQUAD_TEAM} AND ${TEAM_SPORT} = 'volleyball'
  AND NOT EXISTS (SELECT 1 FROM spielplaner_assignments sa
                  JOIN members m ON m.id = sa.member
                  WHERE sa.kscw_team = t.id AND m."user" IS NOT NULL AND m.kscw_membership_active AND ${REAL_PERSON})
  AND NOT EXISTS (SELECT 1 FROM members m WHERE ${CLUB_WIDE_SPIELPLANER})
ORDER BY t.name, t.id`,
  },
  {
    key: 'team_invites_unclaimed',
    section: 'teams',
    sport: 'both',
    severity: 'info',
    grain: 'team',
    title: 'Team invite expired or pending for more than 14 days',
    description: 'Invite links a coach created this season that nobody claimed: a player the coach expects who has no member row at all. Ask the coach whether the person is still coming and re-issue the invite.',
    sql: `
SELECT ${TEAM_COLS}, ti.id AS invite_id, ti.status, ti.guest_level,
       NULLIF(btrim(COALESCE(ib.first_name, '') || ' ' || COALESCE(ib.last_name, '')), '') AS invited_by,
       to_char(ti.date_created AT TIME ZONE 'Europe/Zurich', 'YYYY-MM-DD') AS created_on,
       to_char(ti.expires_at AT TIME ZONE 'Europe/Zurich', 'YYYY-MM-DD') AS expires_on
FROM team_invites ti
JOIN teams t ON t.id = ti.team
LEFT JOIN members ib ON ib.id = ti.invited_by
WHERE ti.date_created >= ({{rollover}}::timestamp AT TIME ZONE 'Europe/Zurich')
  AND (ti.status = 'expired'
       OR (ti.status = 'pending'
           AND (ti.expires_at < ${NOW_TZ} OR ti.date_created < ${NOW_TZ} - INTERVAL '14 days')))
ORDER BY ti.expires_at DESC NULLS LAST, ti.id`,
  },
]
