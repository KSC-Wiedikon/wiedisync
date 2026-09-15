/**
 * Season health — players, rosters and licences (volleyball + basketball).
 *
 * Every entry is a static SQL string composed from the rails in
 * season-health-sql.js; see that header for the `{{token}}` anchors and the
 * registry contract in season-health-checks.js. Rules this module leans on:
 *
 *   - Roster season guard is `teams.active` — never `member_teams.season`.
 *   - `member_teams` is the PLAYER roster; staff live in `teams_coaches` /
 *     `teams_responsibles`. Core player = `COALESCE(guest_level, 0) = 0`.
 *   - Volleyball licences are read from `sv_vm_check` DIRECTLY (the cached
 *     `members.licence_*` columns are never cleared and go stale); basketball
 *     licences from `basketplan_people` scraped on/after this season's 1 June.
 *   - `members.license_nr` is a VARCHAR with leading zeros; `VM_JOIN` guards
 *     the bigint cast. Basketplan numbers are compared as trimmed TEXT with
 *     leading zeros ignored (`BP_NR_EQ` — see why there).
 *   - `licence_status` is the club's WORKFLOW column; it only means something
 *     when `licence_status_season` = this season (`CLUB_LICENCE_STATUS`).
 *   - Federation of origin is compared against `sv_vm_check.nationality_code`
 *     mapped through `vis_federations.code → iso`, never against the
 *     citizenship column.
 *   - Service accounts are excluded from every people list (`REAL_PERSON`).
 *   - Licence checks only look at players the season expects on court
 *     (`EXPECTED_TO_PLAY`): a gap-year or departed member on a roster is ONE
 *     finding (the roster row), not one per licence check.
 *
 * Checks with no team join set `memberIdColumn` so the runner derives the
 * sport (resolveMemberSportsDetailed); checks that join a roster row carry
 * the sport of THAT row (`TEAM_COLS`), which is what the tab wants.
 */
import {
  SQUAD_TEAM, ACTIVE_TEAM, TEAM_SPORT, CORE_PLAYER, REAL_PERSON,
  VM_JOIN, MEMBER_COLS, TEAM_COLS,
  BP_NR_EQ as SHARED_BP_NR_EQ,
} from './season-health-sql.js'

// ── Local predicates (players-domain only) ─────────────────────────────────

/** Active volleyball / basketball team, alias `t`. */
const VB_TEAM = `${ACTIVE_TEAM} AND ${TEAM_SPORT} = 'volleyball'`
const BB_TEAM = `${ACTIVE_TEAM} AND ${TEAM_SPORT} = 'basketball'`

/**
 * A roster player the season actually expects on court: active in wiedisync
 * and not parked by the ClubDesk register. Gap-year (Zwischenjahr — "a member
 * taking a season off", clubdesk-update.js DEPARTED_STATUSES header) and
 * departed statuses are excluded from every LICENCE / transfer / personal-data
 * check on purpose: for them the finding is the roster row itself
 * (`roster_member_gap_year` / `roster_member_inactive`), and one root cause
 * should surface once, not once per check. Alias members as `m`.
 */
const EXPECTED_TO_PLAY = `m.kscw_membership_active = true
   AND COALESCE(m.register_status, '') NOT IN ('Zwischenjahr', 'Kein Mitglied', 'Ehemaliges Mitglied', 'Verstorben')`

/**
 * The club workflow status, but only if its stamp is THIS season — a stale
 * stamp (or a NULL one) is last season's answer and reads as 'none'
 * (effectiveLicenceStatus on the frontend, the rollover reset in
 * licence-status.js). Alias members as `m`.
 */
const CLUB_LICENCE_STATUS = `CASE WHEN m.licence_status_season = {{season}} THEN m.licence_status ELSE 'none' END`

/** Digits-only licence number, the precondition of the Volleymanager join. */
const NUMERIC_LICENCE = `btrim(COALESCE(m.license_nr, '')) ~ '^[0-9]+$'`

/** Member is known to Volleymanager (any licence state). Alias members `m`. */
const IN_VM = `EXISTS (
  SELECT 1 FROM sv_vm_check vm
   WHERE ${NUMERIC_LICENCE} AND vm.association_id = btrim(m.license_nr)::bigint
)`

/**
 * isMinor() from index.js, in SQL: an unknown birthdate is a minor
 * (fail-closed — the public API hides them, so the checks must too).
 */
const IS_MINOR = `(m.birthdate IS NULL OR m.birthdate > ({{today}} - INTERVAL '18 years'))`

/** ClubDesk register statuses that mean "left" (the austritt CHECK's list). */
const DEPARTED_STATUS = `('Kein Mitglied', 'Ehemaliges Mitglied', 'Verstorben')`

/** ClubDesk fee categories that do not imply playing (clubdesk-update.js NON_PLAYING_KAT). */
const NON_PLAYING_FEE = `('', 'Passivmitglied', 'Gratis', 'Kein Beitrag')`

/** Timestamp → Zurich wall-clock text, per the spec's output rule. */
const zh = (expr) => `to_char(${expr} AT TIME ZONE 'Europe/Zurich', 'YYYY-MM-DD HH24:MI')`

/**
 * Member on ANY active-team core roster of one sport, with the team list.
 * Yields (member_id, sport, teams, team_count). Umbrellas included — a
 * member whose only row is the H-Classics umbrella is still rostered.
 */
const CORE_ROSTER_BY_SPORT = `(
  SELECT mt.member AS member_id, ${TEAM_SPORT} AS sport,
         string_agg(t.name, ', ' ORDER BY t.name) AS teams, count(*) AS team_count
    FROM member_teams mt
    JOIN teams t ON t.id = mt.team AND ${ACTIVE_TEAM}
   WHERE ${CORE_PLAYER}
   GROUP BY mt.member, ${TEAM_SPORT}
)`

/** Active-team staff roles of a member, for the "is a coach anyway" annotation. */
const STAFF_OF = `COALESCE((
  SELECT string_agg(DISTINCT s.label, ', ')
    FROM (
      SELECT t2.name || ' (coach)' AS label FROM teams_coaches tc JOIN teams t2 ON t2.id = tc.teams_id AND t2.active = true WHERE tc.members_id = m.id
      UNION ALL
      SELECT t3.name || ' (TR)' FROM teams_responsibles tr JOIN teams t3 ON t3.id = tr.teams_id AND t3.active = true WHERE tr.members_id = m.id
    ) s
), '')`

/**
 * Basketplan licence-number equality — the shared rail (leading zeros
 * ignored on both sides; see season-health-sql.js for why). Re-exported here
 * under the name the checks below were written against.
 */
const BP_NR_EQ = SHARED_BP_NR_EQ

/** The name + birthdate fallback, verbatim from licence-status.js. */
const BP_NAME_EQ = `lower(btrim(bp.last_name)) = lower(btrim(m.last_name))
       AND lower(btrim(bp.first_name)) = lower(btrim(m.first_name))
       AND bp.birthdate = m.birthdate`

/**
 * Basketball licence for THIS season (`BP_LICENSED` with `BP_NR_EQ`): a
 * Basketplan row with a licence number scraped on/after 1 June, matched by
 * number first, then exact name + birthdate. Alias members as `m`.
 */
const BP_LICENSED_THIS_SEASON = `EXISTS (
  SELECT 1 FROM basketplan_people bp
   WHERE bp.scraped_at >= {{rollover}}
     AND NULLIF(btrim(bp.licence_nr), '') IS NOT NULL
     AND (${BP_NR_EQ} OR (${BP_NAME_EQ}))
)`

/**
 * Basketplan row per member — licence number first, then exact name +
 * birthdate — the bp_match rule basketplan-scrape-people.mjs applies with
 * (plus the zero-padding rule above). Deliberately NOT pinned to this
 * season's scrape: the official acquisition dates it feeds are permanent
 * facts. Two equi-joins UNIONed rather than one OR-join: the OR form forced
 * a 256 × 700 nested loop (460 ms per check).
 */
const BP_MATCH = `(
  SELECT DISTINCT ON (x.member_id) x.member_id, bp.*
    FROM (
      SELECT m.id AS member_id, bp.person_id, 1 AS prio
        FROM members m JOIN basketplan_people bp ON ${BP_NR_EQ}
      UNION ALL
      SELECT m.id, bp.person_id, 2
        FROM members m JOIN basketplan_people bp ON ${BP_NAME_EQ}
    ) x
    JOIN basketplan_people bp ON bp.person_id = x.person_id
   ORDER BY x.member_id, x.prio, bp.person_id
)`

/** Volleymanager's sporting nationality as ISO2, via FIVB's own directory. */
const VM_ISO_JOIN = `LEFT JOIN vis_federations f ON f.code = upper(btrim(vm.nationality_code))`

/** nameKey() from registration-duplicates.js: accent-folded, lower-cased, trimmed. */
const NAME_KEY = (col) => `lower(unaccent(btrim(${col})))`

/**
 * "Same person" between two members aliases — the SOFT rule of
 * registration-duplicates.js (`firstNamesMatch`): same birthdate, same folded
 * last name, first names equal or one a prefix of the other. Both first
 * names must be non-empty or `position('' IN x) = 1` matches everyone.
 */
const SAME_PERSON = (a, b) => `${a}.birthdate = ${b}.birthdate
        AND ${NAME_KEY(`${a}.last_name`)} = ${NAME_KEY(`${b}.last_name`)}
        AND NULLIF(btrim(${a}.first_name), '') IS NOT NULL AND NULLIF(btrim(${b}.first_name), '') IS NOT NULL
        AND (position(${NAME_KEY(`${a}.first_name`)} IN ${NAME_KEY(`${b}.first_name`)}) = 1
             OR position(${NAME_KEY(`${b}.first_name`)} IN ${NAME_KEY(`${a}.first_name`)}) = 1)`

// ── The roster table (not a finding) ───────────────────────────────────────

/**
 * One row per core roster player of every ACTIVE team, umbrellas included
 * (flagged). VB licence state comes from sv_vm_check, BB from
 * basketplan_people scraped since 1 June; the workflow status and dues are
 * season-checked. Validated by the harness as table:players.
 */
export const ROSTER_SQL = `
SELECT ${MEMBER_COLS},
       t.id AS team_id, t.name AS team, ${TEAM_SPORT} AS sport, t.league,
       (COALESCE(t.clubdesk_group, 'x') = '') AS umbrella,
       m.license_nr,
       CASE WHEN ${TEAM_SPORT} = 'volleyball' THEN
              CASE WHEN vm.association_id IS NULL THEN 'none'
                   WHEN vm.licence_activated IS TRUE AND vm.licence_validated IS TRUE THEN 'validated'
                   WHEN vm.licence_activated IS TRUE THEN 'activated_not_validated'
                   ELSE 'in_vm_not_activated' END
            ELSE CASE WHEN ${BP_LICENSED_THIS_SEASON} THEN 'licensed' ELSE 'none' END
       END AS licence_state,
       CASE WHEN ${TEAM_SPORT} = 'volleyball' THEN COALESCE(vm.licence_category, m.licence_category)
            ELSE m.licence_category END AS licence_category,
       ${CLUB_LICENCE_STATUS} AS licence_status,
       COALESCE(m.dues_paid AND m.dues_paid_season = {{season}}, false) AS dues_paid,
       m.wiedisync_active AS has_login,
       m.shell,
       m.register_status,
       m.birthdate::text AS birthdate,
       m.sex
  FROM member_teams mt
  JOIN teams t ON t.id = mt.team AND ${ACTIVE_TEAM}
  JOIN members m ON m.id = mt.member
  ${VM_JOIN}
 WHERE ${CORE_PLAYER}
   AND ${REAL_PERSON}
 ORDER BY sport, team, m.last_name, m.first_name, m.id`

// ── Checks ─────────────────────────────────────────────────────────────────

export const CHECKS = [
  // ── Volleyball licences (sv_vm_check) ────────────────────────────────────
  {
    key: 'vb_roster_not_in_vm',
    section: 'players',
    sport: 'vb',
    severity: 'error',
    grain: 'player',
    title: 'VB roster player has no Volleymanager licence row',
    description: "A current-season volleyball player whose licence number is empty, not numeric, or unknown to the weekly Volleymanager mirror — Swiss Volley does not know them as a KSCW player. vm_candidate names a Volleymanager row that looks like the same person (same surname + birthday, same email, or a first name that is a prefix of VM's) — usually the number is just missing on the profile. Enter it, or order the licence; teams without a league may be legitimately unlicensed.",
    sql: `
SELECT ${MEMBER_COLS}, ${TEAM_COLS}, t.league,
       m.license_nr,
       CASE WHEN NULLIF(btrim(COALESCE(m.license_nr, '')), '') IS NULL THEN 'no_number'
            WHEN NOT ${NUMERIC_LICENCE} THEN 'not_numeric'
            ELSE 'not_in_vm' END AS reason,
       (SELECT string_agg(vm.association_id::text || ' ' || COALESCE(vm.first_name, '') || ' ' || COALESCE(vm.last_name, '')
                          || COALESCE(' (' || vm.licence_club_name || ')', ''), '; ' ORDER BY vm.association_id)
          FROM sv_vm_check vm
         WHERE (m.birthdate IS NOT NULL AND vm.birthday = m.birthdate
                AND lower(btrim(vm.last_name)) = lower(btrim(m.last_name)))
            OR (NULLIF(btrim(m.email), '') IS NOT NULL AND lower(btrim(vm.email)) = lower(btrim(m.email)))
            OR (NULLIF(btrim(m.vm_email), '') IS NOT NULL AND lower(btrim(vm.email)) = lower(btrim(m.vm_email)))
            OR (lower(btrim(vm.last_name)) = lower(btrim(m.last_name))
                AND NULLIF(btrim(m.first_name), '') IS NOT NULL
                AND position(lower(btrim(m.first_name)) IN lower(btrim(COALESCE(vm.first_name, '')))) = 1)
       ) AS vm_candidate,
       ${CLUB_LICENCE_STATUS} AS licence_status,
       m.birthdate::text AS birthdate
  FROM member_teams mt
  JOIN teams t ON t.id = mt.team AND ${VB_TEAM}
  JOIN members m ON m.id = mt.member
 WHERE ${CORE_PLAYER}
   AND ${REAL_PERSON}
   AND ${EXPECTED_TO_PLAY}
   AND NOT ${IN_VM}
 ORDER BY t.name, m.last_name, m.first_name, m.id`,
  },
  {
    key: 'vb_licence_not_validated',
    section: 'players',
    sport: 'vb',
    severity: 'error',
    grain: 'player',
    title: 'VB licence not activated or not validated this season',
    description: 'The player exists in Volleymanager but the licence is not activated (club action: switch it on) or activated but not validated (Swiss Volley paperwork or transfer pending). Fielding an unvalidated licence is sanctionable.',
    sql: `
SELECT ${MEMBER_COLS}, ${TEAM_COLS},
       m.license_nr,
       CASE WHEN vm.licence_activated IS TRUE THEN 'activated_not_validated' ELSE 'in_vm_not_activated' END AS state,
       vm.licence_category,
       vm.licence_activation_date::text AS activation_date,
       vm.licence_validation_date::text AS validation_date,
       vm.licence_club_name,
       ${CLUB_LICENCE_STATUS} AS licence_status
  FROM member_teams mt
  JOIN teams t ON t.id = mt.team AND ${VB_TEAM}
  JOIN members m ON m.id = mt.member
  JOIN sv_vm_check vm ON ${NUMERIC_LICENCE} AND vm.association_id = btrim(m.license_nr)::bigint
 WHERE ${CORE_PLAYER}
   AND ${REAL_PERSON}
   AND ${EXPECTED_TO_PLAY}
   AND (vm.licence_activated IS NOT TRUE OR vm.licence_validated IS NOT TRUE)
 ORDER BY state, t.name, m.last_name, m.first_name, m.id`,
  },
  {
    key: 'vb_vm_team_mismatch',
    section: 'players',
    sport: 'vb',
    severity: 'warn',
    grain: 'player',
    title: 'Volleymanager lists the player on a different team than the roster',
    description: "The player is on this wiedisync team but Volleymanager's current-season team assignment names other teams and not this one, so the nomination-list push and match sheets disagree with the roster. Fix the team in Volleymanager or move the player here. Only VM-synced teams (team_id vb_<id>) are compared; players on no VM team at all are the separate 'not yet on any Volleymanager team' check.",
    sql: `
SELECT ${MEMBER_COLS}, ${TEAM_COLS},
       m.license_nr,
       substr(t.team_id, 4) AS team_vm_id,
       vm.team_names AS vm_teams,
       vm.team_ids AS vm_team_ids
  FROM member_teams mt
  JOIN teams t ON t.id = mt.team AND ${VB_TEAM}
             AND left(t.team_id, 3) = 'vb_' AND substr(t.team_id, 4) ~ '^[1-9][0-9]*$'
  JOIN members m ON m.id = mt.member
  JOIN sv_vm_check vm ON ${NUMERIC_LICENCE} AND vm.association_id = btrim(m.license_nr)::bigint
 WHERE ${CORE_PLAYER}
   AND ${REAL_PERSON}
   AND ${EXPECTED_TO_PLAY}
   AND NULLIF(btrim(vm.team_ids), '') IS NOT NULL
   AND NOT (substr(t.team_id, 4) = ANY (string_to_array(replace(vm.team_ids, ' ', ''), ',')))
 ORDER BY t.name, m.last_name, m.first_name, m.id`,
  },
  {
    key: 'vb_vm_team_unassigned',
    section: 'players',
    sport: 'vb',
    severity: 'warn',
    grain: 'player',
    title: 'Activated VB licence not yet on any Volleymanager team',
    description: "The licence is activated, so Volleymanager offers the player, but the club has not put them on any VM team roster yet — the nomination list (Einsatzliste) cannot name them and the match sheet will not list them. This is the 'assignable' bucket of the Volleymanager teams page: run 'Sync now' on /admin/vm-teams to assign every activated roster player to their team. Mirrors buildPlanFromDb in vm-team-assign.js.",
    sql: `
SELECT ${MEMBER_COLS}, ${TEAM_COLS},
       m.license_nr,
       substr(t.team_id, 4) AS team_vm_id,
       vm.licence_category,
       vm.licence_validated,
       vm.licence_activation_date::text AS activation_date
  FROM member_teams mt
  JOIN teams t ON t.id = mt.team AND ${VB_TEAM}
             AND left(t.team_id, 3) = 'vb_' AND substr(t.team_id, 4) ~ '^[1-9][0-9]*$'
  JOIN members m ON m.id = mt.member
  JOIN sv_vm_check vm ON ${NUMERIC_LICENCE} AND vm.association_id = btrim(m.license_nr)::bigint
 WHERE ${CORE_PLAYER}
   AND ${REAL_PERSON}
   AND ${EXPECTED_TO_PLAY}
   AND vm.licence_activated IS TRUE
   AND NULLIF(btrim(vm.team_ids), '') IS NULL
 ORDER BY t.name, m.last_name, m.first_name, m.id`,
  },
  {
    key: 'vb_vm_team_not_rostered',
    section: 'players',
    sport: 'vb',
    severity: 'info',
    grain: 'player',
    title: 'Volleymanager assigns the player to a team they are not rostered on',
    description: "The reverse of the team mismatch: Volleymanager's team assignment names a wiedisync team on which the member holds no core roster row and is not staff (VM lists coaches on their teams too). Either add the roster row (they will otherwise miss RSVPs and the nomination list) or correct Volleymanager.",
    sql: `
SELECT ${MEMBER_COLS}, ${TEAM_COLS},
       m.license_nr,
       vm.team_names AS vm_teams,
       (SELECT string_agg(t2.name, ', ' ORDER BY t2.name)
          FROM member_teams mt2 JOIN teams t2 ON t2.id = mt2.team AND t2.active = true AND lower(t2.sport) = 'volleyball'
         WHERE mt2.member = m.id AND COALESCE(mt2.guest_level, 0) = 0) AS rostered_on,
       EXISTS (SELECT 1 FROM member_teams mt3 WHERE mt3.team = t.id AND mt3.member = m.id AND COALESCE(mt3.guest_level, 0) > 0) AS guest_on_team,
       ${STAFF_OF} AS staff_of
  FROM sv_vm_check vm
  JOIN members m ON ${NUMERIC_LICENCE} AND vm.association_id = btrim(m.license_nr)::bigint
  JOIN LATERAL (
    SELECT DISTINCT y.vm_team_id
      FROM unnest(string_to_array(replace(COALESCE(vm.team_ids, ''), ' ', ''), ',')) AS y(vm_team_id)
     WHERE y.vm_team_id <> ''
  ) x ON true
  JOIN teams t ON ${VB_TEAM} AND t.team_id = 'vb_' || x.vm_team_id
 WHERE ${REAL_PERSON}
   AND NOT EXISTS (
     SELECT 1 FROM member_teams mt WHERE mt.team = t.id AND mt.member = m.id AND COALESCE(mt.guest_level, 0) = 0
   )
   AND NOT EXISTS (SELECT 1 FROM teams_coaches tc WHERE tc.teams_id = t.id AND tc.members_id = m.id)
   AND NOT EXISTS (SELECT 1 FROM teams_responsibles tr WHERE tr.teams_id = t.id AND tr.members_id = m.id)
 ORDER BY t.name, m.last_name, m.first_name, m.id`,
  },
  {
    key: 'vb_licensed_not_on_roster',
    section: 'players',
    sport: 'vb',
    severity: 'warn',
    grain: 'player',
    title: 'Active KSCW licence in Volleymanager but on no VB roster',
    description: 'Volleymanager carries an activated licence in the KSCW player list for someone who is not a core player on any active volleyball team this season — a missing roster row or a licence that should not have been ordered. licence_club says whose licence it is (a double licence from another club costs the club nothing); a licensed player-coach is a judgement call (see staff_of).',
    sql: `
SELECT ${MEMBER_COLS},
       m.license_nr,
       vm.licence_category,
       vm.licence_club_name AS licence_club,
       vm.team_names AS vm_teams,
       m.kscw_membership_active,
       m.register_status,
       ${STAFF_OF} AS staff_of,
       EXISTS (SELECT 1 FROM member_teams mt2 JOIN teams t2 ON t2.id = mt2.team AND t2.active = true AND lower(t2.sport) = 'volleyball'
                WHERE mt2.member = m.id AND COALESCE(mt2.guest_level, 0) > 0) AS guest_somewhere
  FROM sv_vm_check vm
  JOIN members m ON ${NUMERIC_LICENCE} AND vm.association_id = btrim(m.license_nr)::bigint
 WHERE vm.licence_activated IS TRUE
   AND ${REAL_PERSON}
   AND NOT EXISTS (
     SELECT 1 FROM member_teams mt JOIN teams t ON t.id = mt.team AND ${VB_TEAM}
      WHERE mt.member = m.id AND ${CORE_PLAYER}
   )
 ORDER BY m.last_name, m.first_name, m.id`,
  },

  // ── Basketball licences (basketplan_people) ──────────────────────────────
  {
    key: 'bb_roster_no_licence',
    section: 'players',
    sport: 'bb',
    severity: 'error',
    grain: 'player',
    title: 'BB roster player has no Basketplan licence this season',
    description: "A current-season basketball player with no Basketplan licence row scraped since this season's 1 June (matched by licence number with leading zeros ignored, else exact name + birthdate). If the Basketplan scrape itself is stale the whole list is provisional — see the register freshness check. Minis (MU8 / MU10) may be legitimately unlicensed.",
    sql: `
SELECT ${MEMBER_COLS},
       'basketball' AS sport,
       r.teams,
       m.license_nr,
       m.birthdate::text AS birthdate,
       ${CLUB_LICENCE_STATUS} AS licence_status,
       m.licence_category,
       m.register_status
  FROM members m
  JOIN ${CORE_ROSTER_BY_SPORT} r ON r.member_id = m.id AND r.sport = 'basketball'
 WHERE ${REAL_PERSON}
   AND ${EXPECTED_TO_PLAY}
   AND NOT ${BP_LICENSED_THIS_SEASON}
 ORDER BY r.teams, m.last_name, m.first_name, m.id`,
  },
  {
    key: 'bb_official_flag_missing',
    section: 'players',
    sport: 'bb',
    severity: 'warn',
    grain: 'player',
    title: 'Basketplan shows an official licence the member flag does not',
    description: 'Basketplan records an OTR/OTN/referee licence for this member but the wiedisync flag is false, so BB duty assignment cannot pick them. The set-true-only Basketplan apply has not run since — run it, or set the flag by hand. Youth/mini referee licences are not tracked and not flagged.',
    sql: `
SELECT ${MEMBER_COLS},
       x.licence,
       x.since::text AS since,
       bp.licence_nr AS basketplan_licence_nr,
       ${STAFF_OF} AS staff_of
  FROM ${BP_MATCH} bp
  JOIN members m ON m.id = bp.member_id
  JOIN LATERAL (
    VALUES ('OTR1', bp.otr1_since, m.otr1_bb),
           ('OTR2', bp.otr2_since, m.otr2_bb),
           ('OTN1', bp.otn1_since, m.otn1_bb),
           ('OTN2', bp.otn2_since, m.otn2_bb),
           ('Referee', COALESCE(bp.referee_reg_since, bp.referee_nat_since), m.referee_bb)
  ) AS x(licence, since, flag) ON x.since IS NOT NULL AND x.flag IS NOT TRUE
 WHERE ${REAL_PERSON}
   AND m.kscw_membership_active = true
 ORDER BY m.last_name, m.first_name, m.id, x.licence`,
  },
  {
    key: 'bb_official_flag_unconfirmed',
    section: 'players',
    sport: 'bb',
    severity: 'info',
    grain: 'player',
    title: 'Member flag says official but Basketplan shows no such licence',
    description: 'The wiedisync OTR/OTN/referee flag is true but the matched Basketplan record carries no acquisition date for it (any referee grade, youth/mini included, confirms the referee flag). Flags are never cleared automatically (ClubDesk-sourced ones may be genuine) — a human decides whether to clear it.',
    sql: `
SELECT ${MEMBER_COLS},
       x.licence,
       bp.licence_nr AS basketplan_licence_nr,
       ${zh('bp.scraped_at')} AS scraped_at
  FROM ${BP_MATCH} bp
  JOIN members m ON m.id = bp.member_id
  JOIN LATERAL (
    VALUES ('OTR1', bp.otr1_since, m.otr1_bb),
           ('OTR2', bp.otr2_since, m.otr2_bb),
           ('OTN1', bp.otn1_since, m.otn1_bb),
           ('OTN2', bp.otn2_since, m.otn2_bb),
           ('Referee', COALESCE(bp.referee_reg_since, bp.referee_nat_since, bp.referee_youth_since, bp.referee_mini_since), m.referee_bb)
  ) AS x(licence, since, flag) ON x.since IS NULL AND x.flag IS TRUE
 WHERE ${REAL_PERSON}
   AND m.kscw_membership_active = true
 ORDER BY m.last_name, m.first_name, m.id, x.licence`,
  },
  {
    key: 'bb_umbrella_junior_member',
    section: 'players',
    sport: 'bb',
    severity: 'warn',
    grain: 'player',
    title: 'Under-18 on a basketball Classics umbrella team (adults only)',
    description: 'The H-Classics / Damen D-Classics rows are league umbrellas and adults-only by rule. A minor (or an unknown birthdate, which counts as a minor) rostered there is a data error — re-home them onto a junior squad; it is not a licence problem.',
    sql: `
SELECT ${MEMBER_COLS}, ${TEAM_COLS},
       m.birthdate::text AS birthdate,
       (m.birthdate IS NULL) AS birthdate_unknown,
       COALESCE(mt.guest_level, 0) AS guest_level,
       (SELECT string_agg(t2.name, ', ' ORDER BY t2.name)
          FROM member_teams mt2 JOIN teams t2 ON t2.id = mt2.team AND t2.active = true AND COALESCE(t2.clubdesk_group, 'x') <> ''
         WHERE mt2.member = m.id) AS other_teams
  FROM member_teams mt
  JOIN teams t ON t.id = mt.team AND ${BB_TEAM} AND t.clubdesk_group = ''
  JOIN members m ON m.id = mt.member
 WHERE ${REAL_PERSON}
   AND ${IS_MINOR}
 ORDER BY t.name, m.birthdate NULLS FIRST, m.last_name, m.first_name, m.id`,
  },

  // ── Club licence workflow ────────────────────────────────────────────────
  {
    key: 'licence_workflow_stalled',
    section: 'players',
    sport: 'both',
    severity: 'warn',
    grain: 'player',
    title: 'Licence order stuck in to-be-ordered / ordered / finalized',
    description: "The club's own licence workflow has sat in an intermediate state for more than three weeks for a current-season player — somebody forgot to order, or the federation never confirmed (the daily sweep promotes to 'licenced' once a register confirms). A status with no timestamp counts as stalled. Chase the order or correct the status.",
    sql: `
SELECT ${MEMBER_COLS},
       r.sport,
       r.teams,
       m.licence_status,
       ${zh('m.licence_status_updated_at')} AS updated_at,
       ({{today}} - (m.licence_status_updated_at AT TIME ZONE 'Europe/Zurich')::date) AS days_stalled,
       m.licence_status_by_name AS updated_by,
       m.license_nr
  FROM members m
  JOIN ${CORE_ROSTER_BY_SPORT} r ON r.member_id = m.id
 WHERE ${REAL_PERSON}
   AND m.licence_status_season = {{season}}
   AND m.licence_status IN ('to_be_ordered', 'ordered', 'finalized')
   AND (m.licence_status_updated_at IS NULL
        OR m.licence_status_updated_at < ({{now}} AT TIME ZONE 'Europe/Zurich') - INTERVAL '21 days')
 ORDER BY m.licence_status_updated_at NULLS FIRST, r.sport, m.last_name, m.first_name, m.id`,
  },

  // ── Roster integrity ─────────────────────────────────────────────────────
  {
    key: 'roster_member_inactive',
    section: 'players',
    sport: 'both',
    severity: 'error',
    grain: 'player',
    title: 'Roster or staff row for a deactivated or departed member',
    description: 'Someone is still attached to an active team (player, guest, coach, team responsible or captain) although wiedisync or the ClubDesk register says they left — they still get RSVP prompts and count toward minimums. Remove the roster/staff row, not the member.',
    sql: `
SELECT ${MEMBER_COLS}, ${TEAM_COLS},
       p.role,
       m.kscw_membership_active,
       m.register_status,
       m.austritt::text AS austritt,
       ${zh('m.deactivated_at')} AS deactivated_at
  FROM teams t
  JOIN LATERAL (
    SELECT mt.member, CASE WHEN COALESCE(mt.guest_level, 0) > 0 THEN 'guest' ELSE 'player' END AS role
      FROM member_teams mt WHERE mt.team = t.id
    UNION ALL SELECT tc.members_id, 'coach' FROM teams_coaches tc WHERE tc.teams_id = t.id
    UNION ALL SELECT tr.members_id, 'team_responsible' FROM teams_responsibles tr WHERE tr.teams_id = t.id
    UNION ALL SELECT t.captain, 'captain' WHERE t.captain IS NOT NULL
  ) p ON true
  JOIN members m ON m.id = p.member
 WHERE ${ACTIVE_TEAM}
   AND ${REAL_PERSON}
   AND (m.kscw_membership_active = false
        OR m.register_status IN ${DEPARTED_STATUS}
        OR m.austritt IS NOT NULL)
 ORDER BY sport, t.name, p.role, m.last_name, m.first_name, m.id`,
  },
  {
    key: 'roster_member_gap_year',
    section: 'players',
    sport: 'both',
    severity: 'warn',
    grain: 'player',
    title: 'Gap-year (Zwischenjahr) member on an active roster',
    description: "The ClubDesk register says this member is taking the season off, yet they hold a player or guest row on an active team — they get RSVP prompts, count toward minimums, and every licence check here skips them (a gap year is not a licence problem). Either they do play — then fix the register status and the fee category — or remove the roster row. Umbrella rows are marked; whether a gap year owes dues is a separate, open question.",
    sql: `
SELECT ${MEMBER_COLS}, ${TEAM_COLS},
       CASE WHEN COALESCE(mt.guest_level, 0) > 0 THEN 'guest' ELSE 'player' END AS role,
       (COALESCE(t.clubdesk_group, 'x') = '') AS umbrella,
       btrim(m.beitragskategorie) AS fee_category,
       ${CLUB_LICENCE_STATUS} AS licence_status,
       m.wiedisync_active AS has_login
  FROM member_teams mt
  JOIN teams t ON t.id = mt.team AND ${ACTIVE_TEAM}
  JOIN members m ON m.id = mt.member
 WHERE ${REAL_PERSON}
   AND m.kscw_membership_active = true
   AND m.register_status = 'Zwischenjahr'
 ORDER BY sport, umbrella, t.name, m.last_name, m.first_name, m.id`,
  },
  {
    key: 'member_on_multiple_active_teams',
    section: 'players',
    sport: 'both',
    severity: 'warn',
    grain: 'player',
    title: 'Core player on two or more active squads of the same sport',
    description: 'The same person holds guest level 0 on several active squads of one sport (umbrellas excluded). They get RSVP prompts and deadline sweeps for each, count toward every duty pool, and the federation only licenses one squad — the second row should almost always be a guest (guest level 1–3).',
    sql: `
SELECT ${MEMBER_COLS},
       ${TEAM_SPORT} AS sport,
       string_agg(t.name, ', ' ORDER BY t.name) AS teams,
       count(*)::int AS team_count
  FROM member_teams mt
  JOIN teams t ON t.id = mt.team AND ${ACTIVE_TEAM} AND ${SQUAD_TEAM}
  JOIN members m ON m.id = mt.member
 WHERE ${CORE_PLAYER}
   AND ${REAL_PERSON}
 GROUP BY m.id, m.first_name, m.last_name, ${TEAM_SPORT}
HAVING count(*) > 1
 ORDER BY sport, m.last_name, m.first_name, m.id`,
  },
  {
    key: 'active_member_no_team',
    section: 'players',
    sport: 'both',
    severity: 'warn',
    grain: 'player',
    memberIdColumn: 'member_id',
    title: 'Active member with a playing fee but no current-season roster',
    description: 'Billed to play (a VB/BB fee category) yet on no active-team roster, not even as a guest. Place them on a team or change the fee category. last_season says whether they ever played; a coach/TR on a playing fee is a judgement call (staff_of). Gap-year, passive and departed register statuses are skipped — for them the fee category, not the roster, is the question (data health).',
    sql: `
SELECT ${MEMBER_COLS},
       btrim(m.beitragskategorie) AS fee_category,
       m.sektion,
       m.register_status,
       (SELECT max(t2.season) FROM member_teams mt2 JOIN teams t2 ON t2.id = mt2.team
         WHERE mt2.member = m.id AND COALESCE(mt2.guest_level, 0) = 0) AS last_season,
       ${STAFF_OF} AS staff_of,
       m.eintritt::text AS eintritt,
       (m.requested_team IS NOT NULL AND m.coach_approved_team = false) AS join_request_open
  FROM members m
 WHERE m.kscw_membership_active = true
   AND ${REAL_PERSON}
   AND COALESCE(m.register_status, '') NOT IN ('Zwischenjahr', 'Passivmitglied', 'Kein Mitglied', 'Ehemaliges Mitglied', 'Verstorben')
   AND btrim(COALESCE(m.beitragskategorie, '')) NOT IN ${NON_PLAYING_FEE}
   AND NOT EXISTS (
     SELECT 1 FROM member_teams mt JOIN teams t ON t.id = mt.team AND ${ACTIVE_TEAM}
      WHERE mt.member = m.id
   )
 ORDER BY fee_category, m.last_name, m.first_name, m.id`,
  },

  // ── Login / account lifecycle ────────────────────────────────────────────
  {
    key: 'shell_unclaimed',
    section: 'players',
    sport: 'both',
    severity: 'warn',
    grain: 'player',
    memberIdColumn: 'member_id',
    title: 'Shell account never registered (expired or expiring)',
    description: 'An invite-born member who never set a password and whose shell has expired, expires within 14 days, or never expires. Expired shells are deactivated by the nightly cron — if they are on a roster that silently removes a real player. Re-send the invite or extend the shell.',
    sql: `
SELECT ${MEMBER_COLS},
       m.email,
       ${zh('m.shell_expires')} AS shell_expires,
       COALESCE(m.shell_expires < ({{now}} AT TIME ZONE 'Europe/Zurich'), false) AS expired,
       m.shell_reminder_sent AS reminder_sent,
       m.kscw_membership_active,
       (SELECT string_agg(t.name, ', ' ORDER BY t.name) FROM member_teams mt JOIN teams t ON t.id = mt.team AND ${ACTIVE_TEAM}
         WHERE mt.member = m.id) AS teams,
       (m.date_created AT TIME ZONE 'Europe/Zurich')::date::text AS created
  FROM members m
 WHERE m.shell = true
   AND m.wiedisync_active = false
   AND ${REAL_PERSON}
   AND (m.shell_expires IS NULL OR m.shell_expires < ({{now}} AT TIME ZONE 'Europe/Zurich') + INTERVAL '14 days')
 ORDER BY m.shell_expires NULLS FIRST, m.last_name, m.first_name, m.id`,
  },
  {
    key: 'login_link_inconsistent',
    section: 'players',
    sport: 'both',
    severity: 'error',
    grain: 'player',
    memberIdColumn: 'member_id',
    title: 'Login state inconsistent with the Directus user',
    description: "The member either cannot log in although wiedisync_active says they can (no user link, suspended/invited Directus user, a password-less local user that never logged in), still carries the shell flag after activating, or has an activated, used Directus login that the member flag does not reflect. These are the 'I cannot log in' tickets.",
    sql: `
SELECT ${MEMBER_COLS},
       CASE WHEN m.wiedisync_active AND m."user" IS NULL THEN 'active_without_user'
            WHEN m.wiedisync_active AND u.status IS NOT NULL AND u.status <> 'active' THEN 'directus_user_' || u.status
            WHEN m.wiedisync_active AND u.id IS NOT NULL AND u.password IS NULL AND u.last_access IS NULL
                 AND COALESCE(u.provider, 'default') = 'default' AND u.external_identifier IS NULL THEN 'user_without_password'
            WHEN m.shell AND m.wiedisync_active THEN 'shell_still_true'
            ELSE 'login_used_but_flag_false' END AS problem,
       m.wiedisync_active,
       m.shell,
       m.kscw_membership_active,
       u.status AS directus_status,
       ${zh('u.last_access')} AS last_access
  FROM members m
  LEFT JOIN directus_users u ON u.id = m."user"
 WHERE ${REAL_PERSON}
   AND (
        (m.wiedisync_active AND m."user" IS NULL)
     OR (m.wiedisync_active AND u.status IS NOT NULL AND u.status <> 'active')
     OR (m.wiedisync_active AND u.id IS NOT NULL AND u.password IS NULL AND u.last_access IS NULL
         AND COALESCE(u.provider, 'default') = 'default' AND u.external_identifier IS NULL)
     OR (m.shell AND m.wiedisync_active)
     OR (NOT m.wiedisync_active AND m.kscw_membership_active AND u.last_access IS NOT NULL)
   )
 ORDER BY problem, m.last_name, m.first_name, m.id`,
  },
  {
    key: 'login_email_drift',
    section: 'players',
    sport: 'both',
    severity: 'warn',
    grain: 'player',
    memberIdColumn: 'member_id',
    title: 'Member email differs from the Directus login email',
    description: 'The member profile and the linked Directus user carry different email addresses, so password-reset and login mails go to a different address than the club writes to. Align the two (the profile email is what the app sends to). Pairs rewritten by the dev refresh scrub (@devsink.invalid on both sides) are skipped, so dev does not read every login as drifted.',
    sql: `
SELECT ${MEMBER_COLS},
       m.email,
       u.email AS login_email,
       m.wiedisync_active,
       ${zh('u.last_access')} AS last_access
  FROM members m
  JOIN directus_users u ON u.id = m."user"
 WHERE ${REAL_PERSON}
   AND m.wiedisync_active = true
   AND lower(btrim(u.email)) IS DISTINCT FROM lower(btrim(m.email))
   AND NOT (m.email ILIKE '%@devsink.invalid' AND u.email ILIKE '%@devsink.invalid')
 ORDER BY m.last_name, m.first_name, m.id`,
  },
  {
    key: 'member_email_suppressed',
    section: 'players',
    sport: 'both',
    severity: 'error',
    grain: 'player',
    memberIdColumn: 'member_id',
    title: 'Active member whose email is on the bounce/complaint suppression list',
    description: 'Every email the app sends to this address (RSVP invites, reminders, invoices, password reset) is dropped by the suppression list — bounce = permanent failure, complaint = marked as spam. Correct the address in the profile or release the suppression once fixed.',
    sql: `
SELECT ${MEMBER_COLS},
       m.email,
       es.reason,
       es.subtype,
       ${zh('es.created_at')} AS suppressed_at,
       (SELECT string_agg(t.name, ', ' ORDER BY t.name) FROM member_teams mt JOIN teams t ON t.id = mt.team AND ${ACTIVE_TEAM}
         WHERE mt.member = m.id) AS teams
  FROM members m
  JOIN email_suppressions es ON lower(btrim(es.email)) = lower(btrim(m.email)) AND es.released_at IS NULL
 WHERE m.kscw_membership_active = true
   AND ${REAL_PERSON}
 ORDER BY es.created_at DESC, m.last_name, m.first_name, m.id, es.id`,
  },

  // ── Personal data the licences depend on ─────────────────────────────────
  {
    key: 'licensed_missing_birthdate_sex',
    section: 'players',
    sport: 'both',
    severity: 'error',
    grain: 'player',
    title: 'Roster player missing birthdate or sex',
    description: 'Licences (both federations), match sheets, the Basketplan name+birthdate match and the public-API minor filter (which hides anyone without a birthdate) all need these. Fill from the profile, ClubDesk or the licence register.',
    sql: `
SELECT ${MEMBER_COLS},
       r.sport,
       r.teams,
       m.birthdate::text AS birthdate,
       m.sex,
       (m.birthdate IS NULL) AS missing_birthdate,
       (m.sex IS NULL OR btrim(m.sex) = '') AS missing_sex,
       m.license_nr
  FROM members m
  JOIN ${CORE_ROSTER_BY_SPORT} r ON r.member_id = m.id
 WHERE ${REAL_PERSON}
   AND ${EXPECTED_TO_PLAY}
   AND (m.birthdate IS NULL OR m.sex IS NULL OR btrim(m.sex) = '')
 ORDER BY r.sport, r.teams, m.last_name, m.first_name, m.id`,
  },
  {
    key: 'sex_vs_team_gender',
    section: 'players',
    sport: 'both',
    severity: 'warn',
    grain: 'player',
    title: "Player's sex contradicts the team's gender",
    description: "Usually a wrong sex value or a wrong team gender, occasionally a genuine mixed placement — either way a licence ordered for the wrong category bounces. Mixed and unset team genders are skipped.",
    sql: `
SELECT ${MEMBER_COLS}, ${TEAM_COLS},
       m.sex,
       t.gender AS team_gender,
       COALESCE(mt.guest_level, 0) AS guest_level
  FROM member_teams mt
  JOIN teams t ON t.id = mt.team AND ${ACTIVE_TEAM} AND t.gender IN ('m', 'f')
  JOIN members m ON m.id = mt.member
 WHERE ${CORE_PLAYER}
   AND ${REAL_PERSON}
   AND m.sex IN ('m', 'f')
   AND m.sex <> t.gender
 ORDER BY sport, t.name, m.last_name, m.first_name, m.id`,
  },
  {
    key: 'under18_team_age',
    section: 'players',
    sport: 'both',
    severity: 'info',
    grain: 'player',
    title: 'Player too old for a U-team (conservative year-of-birth bound)',
    description: "The player's age in the season's start year (start year minus birth year) already exceeds the team's U-number — over-age under any federation cutoff. The exact Swiss Volley / Swiss Basketball cutoffs are not encoded, so this is a conservative lead, not a ruling.",
    sql: `
SELECT ${MEMBER_COLS}, ${TEAM_COLS},
       m.birthdate::text AS birthdate,
       substring(t.name from 'U([0-9]{1,2})')::int AS u_age,
       (EXTRACT(YEAR FROM {{season_start}})::int - EXTRACT(YEAR FROM m.birthdate)::int) AS age_in_start_year
  FROM member_teams mt
  JOIN teams t ON t.id = mt.team AND ${ACTIVE_TEAM} AND t.name ~ 'U[0-9]{1,2}'
  JOIN members m ON m.id = mt.member
 WHERE ${CORE_PLAYER}
   AND ${REAL_PERSON}
   AND m.birthdate IS NOT NULL
   AND (EXTRACT(YEAR FROM {{season_start}})::int - EXTRACT(YEAR FROM m.birthdate)::int) > substring(t.name from 'U([0-9]{1,2})')::int
 ORDER BY sport, t.name, m.birthdate, m.last_name, m.first_name, m.id`,
  },
  {
    key: 'minor_without_guardian_login',
    section: 'players',
    sport: 'both',
    severity: 'info',
    grain: 'player',
    title: 'Under-18 player with no login and no household guardian',
    description: 'Nobody can RSVP or confirm the profile for this minor — neither the child (no activated login) nor a guardian through the households model. Invite the player or link a guardian. An unknown birthdate counts as a minor.',
    sql: `
SELECT ${MEMBER_COLS},
       r.sport,
       r.teams,
       m.birthdate::text AS birthdate,
       (m.birthdate IS NULL) AS birthdate_unknown,
       m.shell,
       m.email
  FROM members m
  JOIN ${CORE_ROSTER_BY_SPORT} r ON r.member_id = m.id
 WHERE ${REAL_PERSON}
   AND ${EXPECTED_TO_PLAY}
   AND ${IS_MINOR}
   AND m.wiedisync_active = false
   AND NOT EXISTS (
     SELECT 1
       FROM household_members hm
       JOIN household_members g ON g.household = hm.household AND g.role = 'guardian' AND g.revoked_at IS NULL
       JOIN members gm ON gm.id = g.member AND gm.wiedisync_active = true
      WHERE hm.member = m.id AND hm.role = 'managed' AND hm.revoked_at IS NULL
   )
 ORDER BY r.sport, r.teams, m.last_name, m.first_name, m.id`,
  },
  {
    key: 'duplicate_person',
    section: 'players',
    sport: 'both',
    severity: 'warn',
    grain: 'player',
    memberIdColumn: 'member_id',
    title: 'Two member rows for the same person',
    description: "The same accent-folded last name + birthdate exists more than once with the same first name or one that is a prefix of the other ('Paula' / 'Paula Sophie') — the soft rule registration-duplicates.js flags with. Typically a re-registration that was not merged onto the existing record, splitting licence numbers, ClubDesk links and roster rows. Merge the rows; twins with prefix-alike first names are the one benign case. Never keyed on email (families share mailboxes).",
    sql: `
SELECT ${MEMBER_COLS},
       m.birthdate::text AS birthdate,
       m.email,
       m.kscw_membership_active,
       m.register_status,
       m.clubdesk_id,
       m.license_nr,
       (SELECT string_agg(d.id::text, ', ' ORDER BY d.id)
          FROM members d
         WHERE d.id <> m.id AND ${SAME_PERSON('d', 'm')}) AS duplicate_ids
  FROM members m
 WHERE m.birthdate IS NOT NULL
   AND ${REAL_PERSON}
   AND EXISTS (
     SELECT 1 FROM members d
      WHERE d.id <> m.id AND ${SAME_PERSON('d', 'm')}
   )
 ORDER BY m.last_name, m.first_name, m.birthdate, m.id`,
  },

  // ── Transfers / federation of origin (volleyball only — FIVB apparatus) ──
  // The VIS row picked per player mirrors pickVisTransfer (visTransfer.ts):
  // latest season, a live row before a cancelled/refused one (239/240/255),
  // then the most advanced. "Complete" = 100 % OR an ended code (200–220) —
  // an ITC finishes its tasks weeks before VIS moves it to 200.
  {
    key: 'vb_transfer_open',
    section: 'players',
    sport: 'vb',
    severity: 'error',
    grain: 'player',
    title: 'VB player with an open international transfer (ITC not done)',
    description: "First licensed abroad, not ruled done / not needed, no completed VIS transfer, not licensed by Swiss Volley as Swiss, and not exempt by playing only DU20/HU20 — the player may not be eligible. Those Swiss Volley has not validated come first. Chase the ITC or record the ruling.",
    sql: `
WITH vb AS (
  SELECT mt.member AS member_id,
         bool_and(t.name IN ('DU20', 'HU20')) AS u20_only,
         string_agg(t.name, ', ' ORDER BY t.name) AS teams
    FROM member_teams mt
    JOIN teams t ON t.id = mt.team AND ${VB_TEAM}
   WHERE ${CORE_PLAYER}
   GROUP BY mt.member
)
SELECT ${MEMBER_COLS},
       vb.teams,
       m.federation_of_origin,
       m.transfer_status,
       COALESCE(vm.licence_validated, false) AS vm_validated,
       vm.nationality_code AS vm_nationality,
       vt.status_label AS vis_status,
       vt.percent_complete AS vis_percent,
       m.in_vis
  FROM vb
  JOIN members m ON m.id = vb.member_id
  ${VM_JOIN}
  ${VM_ISO_JOIN}
  LEFT JOIN LATERAL (
    SELECT v.status_code, v.status_label, v.percent_complete
      FROM vis_transfers v
     WHERE v.player_no = COALESCE(m.vis_player_no_manual, m.vis_player_no)
       AND v.deleted_at IS NULL
     ORDER BY v.season_no DESC, (v.status_code IN (239, 240, 255)) ASC NULLS FIRST,
              v.percent_complete DESC NULLS LAST, v.vis_no DESC
     LIMIT 1
  ) vt ON true
 WHERE ${REAL_PERSON}
   AND ${EXPECTED_TO_PLAY}
   AND NOT vb.u20_only
   AND m.federation_of_origin IS NOT NULL AND m.federation_of_origin <> 'CH'
   AND m.transfer_status IS DISTINCT FROM 'done'
   AND m.transfer_status IS DISTINCT FROM 'not_needed'
   AND NOT COALESCE(vt.status_code IN (200, 210, 215, 220) OR vt.percent_complete = 100, false)
   AND COALESCE(f.iso, '') <> 'CH'
 ORDER BY (vm.licence_validated IS TRUE), m.last_name, m.first_name, m.id`,
  },
  {
    key: 'vb_foo_unanswered',
    section: 'players',
    sport: 'vb',
    severity: 'warn',
    grain: 'player',
    title: 'VB player has not answered federation of origin',
    description: "The transfer trigger question (which federation issued the FIRST licence) was never answered, so the transfer worklist cannot place them. 'clarify' (non-Swiss nationality) is the actionable subset; 'ask' is the rest. A first licence issued here is 'CH'.",
    sql: `
SELECT ${MEMBER_COLS},
       r.teams,
       m.nationalitaet_codes AS nationalities,
       CASE WHEN m.nationalitaet_codes IS NOT NULL AND NOT (string_to_array(m.nationalitaet_codes, ',') @> ARRAY['CH'])
            THEN 'clarify' ELSE 'ask' END AS bucket,
       vm.nationality_code AS vm_nationality,
       (m.profile_verified_at AT TIME ZONE 'Europe/Zurich')::date::text AS profile_verified,
       m.wiedisync_active AS has_login
  FROM members m
  JOIN ${CORE_ROSTER_BY_SPORT} r ON r.member_id = m.id AND r.sport = 'volleyball'
  ${VM_JOIN}
 WHERE ${REAL_PERSON}
   AND ${EXPECTED_TO_PLAY}
   AND m.federation_of_origin IS NULL
 ORDER BY bucket, r.teams, m.last_name, m.first_name, m.id`,
  },
  {
    key: 'vb_foo_vm_conflict',
    section: 'players',
    sport: 'vb',
    severity: 'error',
    grain: 'player',
    title: 'Swiss Volley lists a foreign federation of origin we do not record',
    description: "Volleymanager's sporting nationality (mapped through FIVB's federation directory) names a foreign federation that differs from our federation of origin — an ITC may be owed and nobody is chasing it. Verify the first licence and correct federation_of_origin or the transfer status.",
    sql: `
SELECT ${MEMBER_COLS},
       r.teams,
       m.federation_of_origin AS ours,
       vm.nationality_code AS vm_code,
       f.iso AS vm_iso,
       vm.is_foreigner,
       m.transfer_status,
       COALESCE(vm.licence_validated, false) AS vm_validated
  FROM members m
  JOIN ${CORE_ROSTER_BY_SPORT} r ON r.member_id = m.id AND r.sport = 'volleyball'
  JOIN sv_vm_check vm ON ${NUMERIC_LICENCE} AND vm.association_id = btrim(m.license_nr)::bigint
  JOIN vis_federations f ON f.code = upper(btrim(vm.nationality_code))
 WHERE ${REAL_PERSON}
   AND ${EXPECTED_TO_PLAY}
   AND m.federation_of_origin IS NOT NULL
   AND f.iso <> 'CH'
   AND f.iso <> m.federation_of_origin
 ORDER BY r.teams, m.last_name, m.first_name, m.id`,
  },
  {
    key: 'vb_foo_vm_says_swiss',
    section: 'players',
    sport: 'vb',
    severity: 'warn',
    grain: 'player',
    title: 'Foreign federation of origin recorded but Swiss Volley says Swiss',
    description: "The benign direction of the disagreement: Volleymanager already licenses the member under SUI, so a transfer chase on our side may be unnecessary (the transfer page treats these as settled). Confirm and record 'not needed' or 'done', or fix federation_of_origin.",
    sql: `
SELECT ${MEMBER_COLS},
       r.teams,
       m.federation_of_origin AS ours,
       vm.nationality_code AS vm_code,
       vm.is_foreigner,
       m.transfer_status,
       COALESCE(vm.licence_validated, false) AS vm_validated
  FROM members m
  JOIN ${CORE_ROSTER_BY_SPORT} r ON r.member_id = m.id AND r.sport = 'volleyball'
  JOIN sv_vm_check vm ON ${NUMERIC_LICENCE} AND vm.association_id = btrim(m.license_nr)::bigint
  JOIN vis_federations f ON f.code = upper(btrim(vm.nationality_code))
 WHERE ${REAL_PERSON}
   AND ${EXPECTED_TO_PLAY}
   AND m.federation_of_origin IS NOT NULL
   AND m.federation_of_origin <> 'CH'
   AND f.iso = 'CH'
 ORDER BY r.teams, m.last_name, m.first_name, m.id`,
  },

  // ── Registrations + register freshness (club grain) ──────────────────────
  {
    key: 'registrations_pending_stale',
    section: 'players',
    sport: 'both',
    severity: 'warn',
    grain: 'club',
    title: 'Registration pending for more than 14 days',
    description: 'A new-player registration nobody approved or declined in two weeks — the person is on no roster, has no shell account and is not being billed. Approve or reject it on the registrations page.',
    sql: `
SELECT r.id AS registration_id,
       btrim(concat_ws(' ', r.vorname, r.nachname)) AS applicant,
       r.email,
       r.membership_type,
       r.team AS requested_team,
       (r.submitted_at AT TIME ZONE 'Europe/Zurich')::date::text AS submitted,
       ({{today}} - (r.submitted_at AT TIME ZONE 'Europe/Zurich')::date) AS days_waiting,
       r.geburtsdatum::text AS birthdate
  FROM registrations r
 WHERE r.status = 'pending'
   AND r.submitted_at < ({{now}} AT TIME ZONE 'Europe/Zurich') - INTERVAL '14 days'
 ORDER BY r.submitted_at, r.id`,
  },
  {
    key: 'licence_registers_freshness',
    section: 'players',
    sport: 'both',
    severity: 'warn',
    grain: 'club',
    title: 'Licence registers stale (Volleymanager, Basketplan, sweeps)',
    description: 'A register feeding the licence checks is older than its cadence, so every licence list is provisional while this is red. Volleymanager weekly (Mon), ClubDesk weekly (Sat), licence sweep daily, VIS check weekly, Basketplan by hand — it must be re-scraped after 1 June or every BB player reads as unlicensed.',
    sql: `
SELECT x.source,
       ${zh('x.last_at')} AS last_at,
       x.cadence,
       x.last_status,
       ({{today}} - (x.last_at AT TIME ZONE 'Europe/Zurich')::date) AS days_old
  FROM (
    SELECT 'sv_vm_check (Volleymanager mirror)' AS source, max(synced_at) AS last_at, 'weekly, Mon 04:00' AS cadence, 'ok' AS last_status,
           COALESCE(max(synced_at) < ({{now}} AT TIME ZONE 'Europe/Zurich') - INTERVAL '8 days', true) AS stale
      FROM sv_vm_check
    UNION ALL
    SELECT 'basketplan_people (Basketplan scrape)', max(scraped_at), 'manual, after 1 June', 'ok',
           COALESCE(max(scraped_at) < ({{rollover}}::timestamp AT TIME ZONE 'Europe/Zurich'), true)
      FROM basketplan_people
    UNION ALL
    SELECT 'clubdesk_export (ClubDesk mirror)', max(imported_at), 'weekly, Sat 22:00 UTC', 'ok',
           COALESCE(max(imported_at) < ({{now}} AT TIME ZONE 'Europe/Zurich') - INTERVAL '8 days', true)
      FROM clubdesk_export
    UNION ALL
    SELECT 'licence_status sweep', max(last_run_at), 'daily, 05:45 UTC', COALESCE(max(status), 'never'),
           COALESCE(max(last_run_at) < ({{now}} AT TIME ZONE 'Europe/Zurich') - INTERVAL '2 days', true) OR bool_or(status = 'error')
      FROM sync_runs WHERE source = 'licence_status'
    UNION ALL
    SELECT 'vis_player_check (VIS index)', max(last_run_at), 'weekly, Mon', COALESCE(max(status), 'never'),
           COALESCE(max(last_run_at) < ({{now}} AT TIME ZONE 'Europe/Zurich') - INTERVAL '8 days', true) OR bool_or(status = 'error')
      FROM sync_runs WHERE source = 'vis_player_check'
  ) x
 WHERE x.stale
 ORDER BY x.source`,
  },
]
