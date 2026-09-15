/**
 * Season health — trainings and hall slots.
 *
 * Generation model (slot-cascade.js): `trainings` rows with `hall_slot IS NOT
 * NULL` are materialised from `hall_slots` (slot_type = 'training') by three
 * generators — on slot create, on slot update, and a 02:00 UTC top-up for
 * indefinite slots. All three run today-forward only, skip hall_closures for
 * the slot's hall and training_slot_skips tombstones, and use only the FIRST
 * team of a multi-team slot. Every "expected but missing" check below
 * replicates exactly those rules; a gap in the past is history, not a bug.
 *
 * Window rule (effectiveEnd): `valid_until` bounds a slot whenever set; an
 * indefinite slot with no end rides a rolling today + 12 weeks (capped at
 * 400 days); a bounded slot with no end runs to May 31. `UNEXPIRED_SLOT`
 * (local) is the valid_until half of season-health-sql.js's `LIVE_SLOT`:
 * the valid_from half is dropped on purpose so a slot that STARTS next
 * month is still checked for configuration problems before it goes live,
 * and every date walk below clamps its own start to valid_from anyway.
 *
 * Sport is derived from the attached team(s) — `hall_slots.sport` is
 * decorative and drifts; it is only used for teamless slots.
 */
import {
  SQUAD_TEAM, ACTIVE_TEAM, TEAM_COLS, TEAM_SPORT, SLOT_DOW,
} from './season-health-sql.js'

// ── Local predicates / fragments ─────────────────────────────────────────

/** Slot not yet expired (the valid_until half of LIVE_SLOT). Alias hall_slots as `hs`. */
const UNEXPIRED_SLOT = `COALESCE(hs.valid_until, CASE WHEN hs.indefinite THEN DATE '9999-12-31' ELSE {{season_end}} END) >= {{today}}`

/** A slot the generators would act on at all. Alias hall_slots as `hs`. */
const TRAINING_SLOT = `hs.slot_type = 'training'`

/** Spielhalle "FREI" slots are teamless by design. Alias hall_slots as `hs`. */
const NOT_SPIELHALLE = `COALESCE(hs.label, '') NOT ILIKE '%spielhalle%'`

/** hall_slots.day_of_week (0 = Monday) as a short English weekday. Alias hall_slots as `hs`. */
const SLOT_WEEKDAY = `(ARRAY['Mon','Tue','Wed','Thu','Fri','Sat','Sun'])[hs.day_of_week + 1]`

/** Team names attached to a slot, in junction-id order (≈ the generator's heap-order pick first). */
const SLOT_TEAMS = `(SELECT string_agg(t.name, ', ' ORDER BY hst.id)
     FROM hall_slots_teams hst JOIN teams t ON t.id = hst.teams_id
    WHERE hst.hall_slots_id = hs.id)`

/**
 * The one team the generators write trainings for. getSlotTeams() has no
 * ORDER BY, so "first" is heap order — junction id in practice. Only used
 * to decide WHETHER a slot generates (any team) and to label the row; the
 * gap checks key on (hall_slot, date), never on the team.
 */
const SLOT_FIRST_TEAM = `(SELECT hst.teams_id FROM hall_slots_teams hst
    WHERE hst.hall_slots_id = hs.id ORDER BY hst.id LIMIT 1)`

/** Sport of a slot from its teams; NULL when teamless or mixed. */
const SLOT_TEAM_SPORT = `(SELECT CASE WHEN count(DISTINCT ${TEAM_SPORT}) = 1 THEN min(${TEAM_SPORT}) END
     FROM hall_slots_teams hst JOIN teams t ON t.id = hst.teams_id
    WHERE hst.hall_slots_id = hs.id)`

/** Sport of a teamless slot from its own (decorative) column, normalised to the tab keys. */
const SLOT_OWN_SPORT = `CASE WHEN lower(hs.sport) IN ('volleyball', 'basketball') THEN lower(hs.sport) END`

/** Effective generation end for a slot (mirrors slot-cascade.js effectiveEnd). Alias `hs`. */
const SLOT_EFFECTIVE_END = `CASE WHEN hs.indefinite
       THEN LEAST(COALESCE(hs.valid_until, {{today}} + 84), {{today}} + 400)
       ELSE COALESCE(hs.valid_until, {{season_end}}) END`

/** A closure of the given hall covering the given date (any source — the generator ignores source). */
const closedOn = (hallExpr, dateExpr) => `EXISTS (SELECT 1 FROM hall_closures c
       WHERE c.hall = ${hallExpr} AND ${dateExpr} BETWEEN c.start_date AND c.end_date)`

/** A coach-deleted occurrence that must not be regenerated. */
const skippedOn = (slotExpr, dateExpr) => `EXISTS (SELECT 1 FROM training_slot_skips k
       WHERE k.hall_slot = ${slotExpr} AND k.date = ${dateExpr})`

/** Identity columns for a training row. Alias trainings as `tr`, teams as `t`. */
const TRAINING_COLS = `tr.id AS training_id, tr.date::text AS date, to_char(tr.start_time, 'HH24:MI') AS time,
       t.name AS team, t.id AS team_id, ${TEAM_SPORT} AS sport`

// ── Checks ───────────────────────────────────────────────────────────────

export const CHECKS = [
  {
    key: 'tr_active_team_no_slot',
    section: 'trainings',
    sport: 'both',
    severity: 'error',
    grain: 'team',
    title: 'Active team has no training slot',
    description: 'An active squad with no unexpired, hall-bearing training slot never receives generated trainings and is invisible on the Hallenplan. Create a slot for it in the Hallenplan (or attach the team to the existing one).',
    sql: `
SELECT ${TEAM_COLS}, t.league, t.season,
       (SELECT count(*) FROM trainings tr WHERE tr.team = t.id AND tr.date >= {{today}} AND tr.cancelled = false)::int AS upcoming_trainings
FROM teams t
WHERE ${ACTIVE_TEAM} AND ${SQUAD_TEAM}
  AND NOT EXISTS (
    SELECT 1 FROM hall_slots_teams hst
    JOIN hall_slots hs ON hs.id = hst.hall_slots_id
    WHERE hst.teams_id = t.id AND ${TRAINING_SLOT} AND hs.hall IS NOT NULL AND ${UNEXPIRED_SLOT}
  )
ORDER BY sport, t.name, t.id`,
  },
  {
    key: 'tr_slot_missing_core_fields',
    section: 'trainings',
    sport: 'both',
    severity: 'error',
    grain: 'training',
    title: 'Training slot without weekday, times or a sane window',
    description: 'None of these columns is NOT NULL in the schema. A slot with no weekday (or one outside 0–6) never matches a date, so it generates nothing and no other check notices; missing times generate trainings without times; a window that ends before it starts is empty. Only a SQL insert produces such a row — fix it in the Hallenplan editor or delete it.',
    sql: `
SELECT NULL::int AS training_id, hs.id AS slot_id, hs.label AS slot_label,
       ${SLOT_WEEKDAY} AS weekday, to_char(hs.start_time, 'HH24:MI') AS time, to_char(hs.end_time, 'HH24:MI') AS end_time,
       h.name AS hall, ${SLOT_TEAMS} AS teams, COALESCE(${SLOT_TEAM_SPORT}, ${SLOT_OWN_SPORT}) AS sport,
       hs.valid_from::text AS valid_from, hs.valid_until::text AS valid_until,
       concat_ws(', ',
         CASE WHEN hs.day_of_week IS NULL OR hs.day_of_week NOT BETWEEN 0 AND 6 THEN 'bad weekday' END,
         CASE WHEN hs.start_time IS NULL THEN 'no start time' END,
         CASE WHEN hs.end_time IS NULL THEN 'no end time' END,
         CASE WHEN hs.end_time <= hs.start_time THEN 'ends before it starts' END,
         CASE WHEN hs.valid_from > hs.valid_until THEN 'window ends before it starts' END
       ) AS problem
FROM hall_slots hs
LEFT JOIN halls h ON h.id = hs.hall
WHERE ${TRAINING_SLOT} AND ${UNEXPIRED_SLOT}
  AND (hs.day_of_week IS NULL OR hs.day_of_week NOT BETWEEN 0 AND 6
       OR hs.start_time IS NULL OR hs.end_time IS NULL OR hs.end_time <= hs.start_time
       OR hs.valid_from > hs.valid_until)
ORDER BY hs.day_of_week NULLS FIRST, hs.start_time NULLS FIRST, hs.id`,
  },
  {
    key: 'tr_slot_no_team',
    section: 'trainings',
    sport: 'both',
    severity: 'info',
    grain: 'training',
    title: 'Training slot with no team attached',
    description: 'A teamless slot is a hall booking nobody trains in (the club still pays for it) and it generates nothing. Attach a team or delete the slot. Spielhalle FREI slots are excluded — they are teamless on purpose.',
    sql: `
SELECT NULL::int AS training_id, hs.id AS slot_id, hs.label AS slot_label,
       ${SLOT_WEEKDAY} AS weekday, to_char(hs.start_time, 'HH24:MI') AS time, to_char(hs.end_time, 'HH24:MI') AS end_time,
       h.name AS hall, hs.valid_from::text AS valid_from, hs.valid_until::text AS valid_until, hs.indefinite,
       ${SLOT_OWN_SPORT} AS sport
FROM hall_slots hs
LEFT JOIN halls h ON h.id = hs.hall
WHERE ${TRAINING_SLOT} AND ${UNEXPIRED_SLOT} AND ${NOT_SPIELHALLE}
  AND NOT EXISTS (SELECT 1 FROM hall_slots_teams hst WHERE hst.hall_slots_id = hs.id)
ORDER BY hs.day_of_week, hs.start_time, h.name, hs.id`,
  },
  {
    key: 'tr_slot_inactive_team',
    section: 'trainings',
    sport: 'both',
    severity: 'error',
    grain: 'training',
    title: 'Training slot attached to an inactive team',
    description: 'An unexpired slot points at a deactivated team row (typically last season\'s duplicate after the rollover), so its trainings generate for a team nobody is on while the real team looks slot-less. Re-point the slot at the active team row.',
    sql: `
SELECT NULL::int AS training_id, hs.id AS slot_id, hs.label AS slot_label,
       ${SLOT_WEEKDAY} AS weekday, to_char(hs.start_time, 'HH24:MI') AS time, h.name AS hall,
       ${TEAM_COLS}, t.season AS team_season, hs.valid_until::text AS valid_until, hs.indefinite,
       (SELECT count(*) FROM trainings tr WHERE tr.hall_slot = hs.id AND tr.date >= {{today}})::int AS upcoming_trainings
FROM hall_slots hs
JOIN hall_slots_teams hst ON hst.hall_slots_id = hs.id
JOIN teams t ON t.id = hst.teams_id
LEFT JOIN halls h ON h.id = hs.hall
WHERE ${TRAINING_SLOT} AND ${UNEXPIRED_SLOT} AND t.active = false
ORDER BY sport, t.name, hs.day_of_week, hs.start_time, hs.id`,
  },
  {
    key: 'tr_slot_no_hall',
    section: 'trainings',
    sport: 'both',
    severity: 'error',
    grain: 'training',
    title: 'Training slot without a hall',
    description: 'All three generators skip a hall-less slot, so it produces zero trainings and cannot be placed on the Hallenplan grid. Usually a deleted hall (FK set NULL) or a half-filled slot — set the hall.',
    sql: `
SELECT NULL::int AS training_id, hs.id AS slot_id, hs.label AS slot_label,
       ${SLOT_WEEKDAY} AS weekday, to_char(hs.start_time, 'HH24:MI') AS time, to_char(hs.end_time, 'HH24:MI') AS end_time,
       ${SLOT_TEAMS} AS teams, COALESCE(${SLOT_TEAM_SPORT}, ${SLOT_OWN_SPORT}) AS sport,
       hs.valid_from::text AS valid_from, hs.valid_until::text AS valid_until, hs.indefinite
FROM hall_slots hs
WHERE ${TRAINING_SLOT} AND ${UNEXPIRED_SLOT} AND hs.hall IS NULL
ORDER BY hs.day_of_week, hs.start_time, hs.id`,
  },
  {
    key: 'tr_slot_multi_team',
    section: 'trainings',
    sport: 'both',
    severity: 'warn',
    grain: 'training',
    title: 'Slot with several teams (only the first gets trainings)',
    description: 'The generator writes trainings for the first attached team only; every other team on the slot silently gets nothing. Split it into one slot per team, or accept that only the named team trains there.',
    sql: `
SELECT NULL::int AS training_id, hs.id AS slot_id, hs.label AS slot_label,
       ${SLOT_WEEKDAY} AS weekday, to_char(hs.start_time, 'HH24:MI') AS time, h.name AS hall,
       ${SLOT_TEAMS} AS teams,
       (SELECT count(*) FROM hall_slots_teams hst WHERE hst.hall_slots_id = hs.id)::int AS team_count,
       (SELECT string_agg(DISTINCT t.name, ', ') FROM trainings tr JOIN teams t ON t.id = tr.team
         WHERE tr.hall_slot = hs.id AND tr.date >= {{today}}) AS generating_for,
       ${SLOT_TEAM_SPORT} AS sport
FROM hall_slots hs
LEFT JOIN halls h ON h.id = hs.hall
WHERE ${TRAINING_SLOT} AND ${UNEXPIRED_SLOT}
  AND (SELECT count(*) FROM hall_slots_teams hst WHERE hst.hall_slots_id = hs.id) > 1
ORDER BY hs.day_of_week, hs.start_time, h.name, hs.id`,
  },
  {
    key: 'tr_slot_overlap',
    section: 'trainings',
    sport: 'both',
    severity: 'warn',
    grain: 'training',
    title: 'Two training slots overlap in the same hall',
    description: 'Same hall, same weekday, overlapping times and overlapping validity windows — the Hallenplan conflict rule. Some are deliberate (a second court, a 30-minute handover), so review rather than delete; the rest are double bookings.',
    sql: `
WITH s AS (
  SELECT hs.id, hs.hall, hs.day_of_week, hs.start_time, hs.end_time, hs.label,
         COALESCE(hs.valid_from, DATE '0001-01-01') AS vf,
         COALESCE(hs.valid_until, CASE WHEN hs.indefinite THEN DATE '9999-12-31' ELSE {{season_end}} END) AS vu,
         ${SLOT_TEAMS} AS teams, ${SLOT_TEAM_SPORT} AS sport
  FROM hall_slots hs
  WHERE ${TRAINING_SLOT} AND hs.hall IS NOT NULL AND ${NOT_SPIELHALLE}
)
SELECT NULL::int AS training_id, a.id AS slot_id, b.id AS other_slot_id,
       h.name AS hall, (ARRAY['Mon','Tue','Wed','Thu','Fri','Sat','Sun'])[a.day_of_week + 1] AS weekday,
       a.teams AS teams, to_char(a.start_time, 'HH24:MI') AS time, to_char(a.end_time, 'HH24:MI') AS end_time,
       b.teams AS other_teams, to_char(b.start_time, 'HH24:MI') AS other_time, to_char(b.end_time, 'HH24:MI') AS other_end_time,
       GREATEST(a.vf, b.vf)::text AS overlap_from,
       CASE WHEN LEAST(a.vu, b.vu) = DATE '9999-12-31' THEN NULL ELSE LEAST(a.vu, b.vu)::text END AS overlap_until,
       CASE WHEN a.sport = b.sport THEN a.sport END AS sport
FROM s a
JOIN s b ON b.id > a.id AND b.hall = a.hall AND b.day_of_week = a.day_of_week
       AND a.start_time < b.end_time AND b.start_time < a.end_time
       AND a.vf <= b.vu AND b.vf <= a.vu
JOIN halls h ON h.id = a.hall
WHERE LEAST(a.vu, b.vu) >= {{today}}
ORDER BY h.name, a.day_of_week, a.start_time, a.id, b.id`,
  },
  {
    key: 'tr_expected_missing_28d',
    section: 'trainings',
    sport: 'both',
    severity: 'error',
    grain: 'training',
    title: 'Slot occurrence in the next 4 weeks has no training',
    description: 'A date the slot should land on (weekday match, inside its window, hall not closed that day, not deleted by the coach) has no trainings row — the "on the Hallenplan but gone from the calendar" symptom. Causes: a slot inserted by SQL (no create hook), a bounded slot never topped up, or a dead top-up cron. Re-save the slot or run the top-up.',
    sql: `
WITH slot AS (
  SELECT hs.id, hs.hall, hs.day_of_week, hs.start_time, hs.end_time, hs.label, hs.indefinite,
         hs.valid_from, hs.valid_until,
         GREATEST({{today}}, COALESCE(hs.valid_from, {{today}})) AS win_start,
         LEAST({{today}} + 28, ${SLOT_EFFECTIVE_END}) AS win_end,
         ${SLOT_FIRST_TEAM} AS team_id
  FROM hall_slots hs
  WHERE ${TRAINING_SLOT} AND hs.hall IS NOT NULL
),
expected AS (
  SELECT s.id AS slot_id, d::date AS date
  FROM slot s
  CROSS JOIN LATERAL generate_series(s.win_start, s.win_end, INTERVAL '1 day') AS gs(d)
  WHERE s.team_id IS NOT NULL
    AND ${SLOT_DOW} = s.day_of_week
    AND NOT ${closedOn('s.hall', 'd::date')}
    AND NOT ${skippedOn('s.id', 'd::date')}
)
SELECT NULL::int AS training_id, e.date::text AS date, to_char(s.start_time, 'HH24:MI') AS time,
       t.name AS team, t.id AS team_id, ${TEAM_SPORT} AS sport,
       h.name AS hall, to_char(s.end_time, 'HH24:MI') AS end_time, s.id AS slot_id, s.label AS slot_label,
       s.indefinite, s.valid_until::text AS valid_until
FROM expected e
JOIN slot s ON s.id = e.slot_id
JOIN teams t ON t.id = s.team_id
JOIN halls h ON h.id = s.hall
WHERE NOT EXISTS (SELECT 1 FROM trainings tr WHERE tr.hall_slot = e.slot_id AND tr.date = e.date)
ORDER BY e.date, s.start_time, h.name, s.id`,
  },
  {
    key: 'tr_indefinite_horizon_short',
    section: 'trainings',
    sport: 'both',
    severity: 'error',
    grain: 'training',
    title: 'Indefinite slot not generated to its horizon (top-up dead?)',
    description: 'An indefinite slot should always have trainings out to its generation horizon (valid_until, or today + 12 weeks when undated, capped at 400 days). Expected dates in the last two weeks of that horizon (closures and coach-deleted dates already excluded) have no row, so the 02:00 UTC top-up has not run — it leaves no heartbeat, this is the only detector. One slot lagging while the others are fine was inserted by SQL today and fills tonight; a dated slot whose tail sits inside the Sommerferien has nothing to check and never appears here.',
    sql: `
WITH slot AS (
  SELECT hs.id, hs.hall, hs.day_of_week, hs.start_time, hs.label, hs.valid_from, hs.valid_until,
         LEAST(COALESCE(hs.valid_until, {{today}} - 1 + 84), {{today}} - 1 + 400) AS horizon,
         ${SLOT_FIRST_TEAM} AS team_id
  FROM hall_slots hs
  WHERE ${TRAINING_SLOT} AND hs.indefinite = true AND hs.hall IS NOT NULL
),
tail AS (
  SELECT s.id AS slot_id, d::date AS date,
         EXISTS (SELECT 1 FROM trainings tr WHERE tr.hall_slot = s.id AND tr.date = d::date) AS has_row
  FROM slot s
  CROSS JOIN LATERAL generate_series(GREATEST({{today}}, COALESCE(s.valid_from, {{today}}), s.horizon - 14), s.horizon, INTERVAL '1 day') AS gs(d)
  WHERE s.team_id IS NOT NULL
    AND ${SLOT_DOW} = s.day_of_week
    AND NOT ${closedOn('s.hall', 'd::date')}
    AND NOT ${skippedOn('s.id', 'd::date')}
)
SELECT NULL::int AS training_id, s.id AS slot_id, s.label AS slot_label,
       (ARRAY['Mon','Tue','Wed','Thu','Fri','Sat','Sun'])[s.day_of_week + 1] AS weekday,
       to_char(s.start_time, 'HH24:MI') AS time, t.name AS team, t.id AS team_id, ${TEAM_SPORT} AS sport, h.name AS hall,
       (SELECT max(tr.date) FROM trainings tr WHERE tr.hall_slot = s.id)::text AS last_generated_date,
       s.horizon::text AS expected_horizon,
       count(*) FILTER (WHERE NOT x.has_row)::int AS missing_in_tail,
       s.valid_until::text AS valid_until
FROM tail x
JOIN slot s ON s.id = x.slot_id
JOIN teams t ON t.id = s.team_id
JOIN halls h ON h.id = s.hall
GROUP BY s.id, s.label, s.day_of_week, s.start_time, s.horizon, s.valid_until, t.id, t.name, t.sport, h.name
HAVING count(*) FILTER (WHERE NOT x.has_row) > 0
ORDER BY sport, t.name, s.day_of_week, s.id`,
  },
  {
    key: 'tr_open_on_closure',
    section: 'trainings',
    sport: 'both',
    severity: 'warn',
    grain: 'training',
    title: 'Training not cancelled on a hall-closure date',
    description: 'A non-cancelled upcoming training whose hall is closed that day (school holidays, KWI Hausdienst, admin closure). The closure hook cancels these and the generator skips them, so a hit is a manual training, a hall change after generation, a closure inserted by SQL, or a hook failure. Cancel it or fix the closure.',
    sql: `
SELECT ${TRAINING_COLS}, to_char(tr.end_time, 'HH24:MI') AS end_time, h.name AS hall,
       c.reason AS closure_reason, c.source AS closure_source,
       c.start_date::text AS closed_from, c.end_date::text AS closed_until, tr.hall_slot IS NULL AS manual_training
FROM trainings tr
JOIN teams t ON t.id = tr.team
JOIN halls h ON h.id = tr.hall
CROSS JOIN LATERAL (
  SELECT c.reason, c.source, c.start_date, c.end_date
  FROM hall_closures c
  WHERE c.hall = tr.hall AND tr.date BETWEEN c.start_date AND c.end_date
  ORDER BY CASE c.source WHEN 'school_holidays' THEN 0 WHEN 'admin' THEN 1 WHEN 'hauswart' THEN 2 WHEN 'gcal' THEN 3 ELSE 4 END,
           c.start_date, c.id
  LIMIT 1
) c
WHERE tr.cancelled = false AND tr.date >= {{today}}
ORDER BY tr.date, tr.start_time, h.name, tr.id`,
  },
  {
    key: 'tr_stale_closure_marker',
    section: 'trainings',
    sport: 'both',
    severity: 'warn',
    grain: 'training',
    title: 'Training still cancelled by a closure that no longer covers it',
    description: 'The training carries a closure marker but no closure of its hall covers that date any more (closure deleted or moved by SQL, or the training\'s hall changed). Members see a cancelled session that should be on. Un-cancel it: cancelled = false, cancel_reason empty, marker cleared.',
    sql: `
SELECT ${TRAINING_COLS}, h.name AS hall, tr.cancel_reason,
       tr.auto_cancelled_by_closure AS marker_closure,
       EXISTS (SELECT 1 FROM hall_closures c WHERE c.id = tr.auto_cancelled_by_closure) AS closure_still_exists
FROM trainings tr
JOIN teams t ON t.id = tr.team
LEFT JOIN halls h ON h.id = tr.hall
WHERE tr.cancelled = true AND tr.auto_cancelled_by_closure IS NOT NULL AND tr.date >= {{today}}
  AND NOT ${closedOn('tr.hall', 'tr.date')}
ORDER BY tr.date, tr.start_time, t.name, tr.id`,
  },
  {
    key: 'tr_outside_slot_window',
    section: 'trainings',
    sport: 'both',
    severity: 'warn',
    grain: 'training',
    title: 'Upcoming training dated outside its slot\'s validity window',
    description: 'Phantom sessions: the training is linked to a slot but falls before its valid_from, after its valid_until, or past May 31 for a bounded slot with no end date. Left behind when a slot\'s window was shortened by SQL (no cascade trim). Delete them through the app so tombstones and participations are handled.',
    sql: `
SELECT ${TRAINING_COLS}, tr.cancelled, hs.id AS slot_id, hs.label AS slot_label,
       hs.valid_from::text AS valid_from, hs.valid_until::text AS valid_until, hs.indefinite,
       CASE WHEN hs.valid_from IS NOT NULL AND tr.date < hs.valid_from THEN 'before valid_from'
            WHEN hs.valid_until IS NOT NULL THEN 'after valid_until'
            ELSE 'after season end' END AS problem
FROM trainings tr
JOIN hall_slots hs ON hs.id = tr.hall_slot
LEFT JOIN teams t ON t.id = tr.team
WHERE tr.date >= {{today}}
  AND (
    (hs.valid_from IS NOT NULL AND tr.date < hs.valid_from)
    OR (hs.valid_until IS NOT NULL AND tr.date > hs.valid_until)
    OR (hs.valid_until IS NULL AND hs.indefinite = false AND tr.date > {{season_end}})
  )
ORDER BY tr.date, tr.start_time, tr.id`,
  },
  {
    key: 'tr_slot_drift',
    section: 'trainings',
    sport: 'both',
    severity: 'warn',
    grain: 'training',
    title: 'Training\'s hall, weekday or team disagrees with its slot',
    description: 'The cascade keeps hall, team and weekday of future linked trainings in step with the slot, so drift means an edit bypassed it (SQL, or an orphan re-attached to the wrong slot id). Start/end times are deliberately not compared — call times and game shortening make those differ normally. Re-link or fix the row.',
    sql: `
SELECT ${TRAINING_COLS}, h.name AS hall, hs.id AS slot_id, hs.label AS slot_label,
       sh.name AS slot_hall, ${SLOT_WEEKDAY} AS slot_weekday, ${SLOT_TEAMS} AS slot_teams,
       concat_ws(', ',
         CASE WHEN tr.hall IS DISTINCT FROM hs.hall THEN 'hall' END,
         CASE WHEN (EXTRACT(ISODOW FROM tr.date)::int - 1) <> hs.day_of_week THEN 'weekday' END,
         CASE WHEN tr.team IS NOT NULL AND NOT EXISTS (SELECT 1 FROM hall_slots_teams hst WHERE hst.hall_slots_id = hs.id AND hst.teams_id = tr.team) THEN 'team' END
       ) AS drift
FROM trainings tr
JOIN hall_slots hs ON hs.id = tr.hall_slot
LEFT JOIN teams t ON t.id = tr.team
LEFT JOIN halls h ON h.id = tr.hall
LEFT JOIN halls sh ON sh.id = hs.hall
WHERE tr.date >= {{today}}
  AND (
    tr.hall IS DISTINCT FROM hs.hall
    OR (EXTRACT(ISODOW FROM tr.date)::int - 1) <> hs.day_of_week
    OR (tr.team IS NOT NULL AND NOT EXISTS (SELECT 1 FROM hall_slots_teams hst WHERE hst.hall_slots_id = hs.id AND hst.teams_id = tr.team))
  )
ORDER BY tr.date, tr.start_time, tr.id`,
  },
  {
    key: 'tr_training_overlap',
    section: 'trainings',
    sport: 'both',
    severity: 'warn',
    grain: 'training',
    title: 'Two teams\' trainings overlap in one hall',
    description: 'Concrete-row overlap where at least one training is not a plain copy of its slot (manual, moved, shortened or re-halled) — weekly template overlaps are reported by the slot check instead. One row per recurring pattern (same teams, weekday and times); occurrences = 1 is a one-off. A row with sport unset means the two teams play different sports — a real conflict in a shared hall.',
    sql: `
WITH tr AS (
  SELECT tr.*,
         (tr.hall_slot IS NOT NULL AND EXISTS (
            SELECT 1 FROM hall_slots hs WHERE hs.id = tr.hall_slot
              AND hs.hall = tr.hall AND hs.start_time = tr.start_time AND hs.end_time = tr.end_time)) AS faithful
  FROM trainings tr
  WHERE tr.cancelled = false AND tr.date >= {{today}} AND tr.hall IS NOT NULL
),
pair AS (
  SELECT a.id, a.date, a.team AS team_a, b.team AS team_b, a.hall,
         (EXTRACT(ISODOW FROM a.date)::int - 1) AS dow,
         a.start_time AS a_start, a.end_time AS a_end, b.start_time AS b_start, b.end_time AS b_end
  FROM tr a
  JOIN tr b ON b.id > a.id AND b.hall = a.hall AND b.date = a.date AND b.team IS DISTINCT FROM a.team
          AND a.start_time < b.end_time AND b.start_time < a.end_time
  WHERE NOT (a.faithful AND b.faithful)
)
SELECT (array_agg(p.id ORDER BY p.date, p.id))[1] AS training_id, min(p.date)::text AS date,
       to_char(p.a_start, 'HH24:MI') AS time, ta.name AS team, ta.id AS team_id,
       CASE WHEN lower(ta.sport) = lower(tb.sport) THEN lower(ta.sport) END AS sport,
       h.name AS hall, to_char(p.a_end, 'HH24:MI') AS end_time,
       tb.name AS other_team, lower(tb.sport) AS other_sport,
       to_char(p.b_start, 'HH24:MI') AS other_time, to_char(p.b_end, 'HH24:MI') AS other_end_time,
       count(*)::int AS occurrences, max(p.date)::text AS last_date
FROM pair p
JOIN halls h ON h.id = p.hall
JOIN teams ta ON ta.id = p.team_a
JOIN teams tb ON tb.id = p.team_b
GROUP BY p.team_a, p.team_b, p.hall, p.dow, p.a_start, p.a_end, p.b_start, p.b_end, ta.id, ta.name, ta.sport, tb.name, tb.sport, h.name
ORDER BY min(p.date), p.a_start, h.name, ta.name, tb.name, p.team_a, p.team_b`,
  },
  {
    key: 'tr_own_gameday_not_cancelled',
    section: 'trainings',
    sport: 'both',
    severity: 'warn',
    grain: 'training',
    title: 'Training not cancelled on the team\'s own game day',
    description: 'The team has a scheduled game (home or away) on the training\'s date but the training is still on. The nightly 02:20 UTC sweep cancels these, so a game synced today shows here until tonight; persistent hits mean the sweep is not running — unless game_status is empty: the sweep matches status = \'scheduled\' literally and skips a NULL-status game, so set the status (see the games section). A training a coach deliberately reinstated after an auto-cancel is excluded.',
    sql: `
SELECT ${TRAINING_COLS}, to_char(tr.end_time, 'HH24:MI') AS end_time,
       g.id AS game_id, g.type AS home_away, CASE WHEN g.type = 'home' THEN g.away_team ELSE g.home_team END AS opponent,
       to_char(g.time, 'HH24:MI') AS game_time, g.status AS game_status, g.league
FROM trainings tr
JOIN teams t ON t.id = tr.team
CROSS JOIN LATERAL (
  SELECT g.id, g.type, g.home_team, g.away_team, g.time, g.status, g.league
  FROM games g
  WHERE g.kscw_team = tr.team AND g.date = tr.date AND COALESCE(g.status, 'scheduled') = 'scheduled'
  ORDER BY g.time ASC NULLS LAST, g.id ASC
  LIMIT 1
) g
WHERE tr.cancelled = false AND tr.date >= {{today}}
  AND (tr.auto_shortened_by_game IS NULL OR tr.original_end_time IS NOT NULL)
ORDER BY tr.date, tr.start_time, t.name, tr.id`,
  },
  {
    key: 'tr_team_no_trainings_4w',
    section: 'trainings',
    sport: 'both',
    severity: 'warn',
    grain: 'team',
    title: 'Active team has no open training in the next 4 weeks',
    description: 'The team\'s slot(s) land on at least one open date in the coming 28 days (hall not closed, occurrence not deleted by the coach), yet not one non-cancelled training exists: either nothing was generated (cancelled_in_window = 0 — see the slot-occurrence check) or everything is cancelled (own game days, a bulk cancel). A team with no slot at all is the no-slot check\'s job, and a team whose whole window is Ferien has nothing to show and is not listed.',
    sql: `
SELECT ${TEAM_COLS}, x.slots, x.expected_dates,
       (SELECT count(*) FROM trainings tr WHERE tr.team = t.id AND tr.date BETWEEN {{today}} AND {{today}} + 28 AND tr.cancelled)::int AS cancelled_in_window,
       (SELECT min(tr.date) FROM trainings tr WHERE tr.team = t.id AND tr.date > {{today}} + 28 AND tr.cancelled = false)::text AS next_open_training
FROM teams t
CROSS JOIN LATERAL (
  SELECT count(DISTINCT hs.id)::int AS slots, count(DISTINCT d)::int AS expected_dates
  FROM hall_slots_teams hst
  JOIN hall_slots hs ON hs.id = hst.hall_slots_id
  LEFT JOIN LATERAL generate_series(GREATEST({{today}}, COALESCE(hs.valid_from, {{today}})), LEAST({{today}} + 28, ${SLOT_EFFECTIVE_END}), INTERVAL '1 day') AS gs(d)
         ON ${SLOT_DOW} = hs.day_of_week
        AND NOT ${closedOn('hs.hall', 'd::date')}
        AND NOT ${skippedOn('hs.id', 'd::date')}
  WHERE hst.teams_id = t.id AND ${TRAINING_SLOT} AND hs.hall IS NOT NULL AND ${UNEXPIRED_SLOT}
) x
WHERE ${ACTIVE_TEAM} AND ${SQUAD_TEAM}
  AND x.expected_dates > 0
  AND NOT EXISTS (
    SELECT 1 FROM trainings tr
    WHERE tr.team = t.id AND tr.cancelled = false AND tr.date BETWEEN {{today}} AND {{today}} + 28
  )
ORDER BY sport, t.name, t.id`,
  },
  {
    key: 'tr_team_no_trainings_season',
    section: 'trainings',
    sport: 'both',
    severity: 'error',
    grain: 'team',
    title: 'Active team has zero trainings this season',
    description: 'Not a single trainings row between the June rollover and May 31 — the team has no schedule at all, usually because its slot was never created or is bound to the stale team row. League umbrellas are excluded.',
    sql: `
SELECT ${TEAM_COLS}, t.league, t.season,
       (SELECT count(*) FROM hall_slots_teams hst JOIN hall_slots hs ON hs.id = hst.hall_slots_id
         WHERE hst.teams_id = t.id AND ${TRAINING_SLOT} AND ${UNEXPIRED_SLOT})::int AS unexpired_slots
FROM teams t
WHERE ${ACTIVE_TEAM} AND ${SQUAD_TEAM}
  AND NOT EXISTS (
    SELECT 1 FROM trainings tr
    WHERE tr.team = t.id AND tr.date BETWEEN {{rollover}} AND {{season_end}}
  )
ORDER BY sport, t.name, t.id`,
  },
  {
    key: 'tr_hall_less_training',
    section: 'trainings',
    sport: 'both',
    severity: 'warn',
    grain: 'training',
    title: 'Upcoming training with no hall',
    description: 'No hall and no free-text hall name: the training is on the calendar but invisible on the Hallenplan, and no closure can ever cancel it. Caused by a deleted hall (FK set NULL) or a manual training saved with "other" and an empty name. Set the hall.',
    sql: `
SELECT ${TRAINING_COLS}, to_char(tr.end_time, 'HH24:MI') AS end_time,
       hs.id AS slot_id, hs.label AS slot_label, tr.hall_slot IS NULL AS manual_training, tr.notes
FROM trainings tr
JOIN teams t ON t.id = tr.team
LEFT JOIN hall_slots hs ON hs.id = tr.hall_slot
WHERE tr.date >= {{today}} AND tr.cancelled = false AND tr.hall IS NULL
  AND COALESCE(btrim(tr.hall_name), '') IN ('', '__other__')
ORDER BY tr.date, tr.start_time, t.name, tr.id`,
  },
  {
    key: 'tr_hall_no_school_holidays',
    section: 'trainings',
    sport: 'both',
    severity: 'warn',
    grain: 'club',
    title: 'Hall in use with no school-holiday closures ahead',
    description: 'The hall has unexpired training slots but no school_holidays closure reaching 6 months out, so its slots generate trainings straight through the Ferien. The Schulferien sync (monthly, 1st 04:30 UTC) writes one closure per hall — a hall created after its last run is uncovered until then. Run the sync from the closures page.',
    sql: `
SELECT h.name AS hall,
       (SELECT count(*) FROM hall_slots hs WHERE hs.hall = h.id AND ${TRAINING_SLOT} AND ${UNEXPIRED_SLOT})::int AS unexpired_slots,
       (SELECT string_agg(DISTINCT t.name, ', ')
          FROM hall_slots hs JOIN hall_slots_teams hst ON hst.hall_slots_id = hs.id JOIN teams t ON t.id = hst.teams_id
         WHERE hs.hall = h.id AND ${TRAINING_SLOT} AND ${UNEXPIRED_SLOT}) AS teams,
       (SELECT max(c.end_date) FROM hall_closures c WHERE c.hall = h.id AND c.source = 'school_holidays')::text AS last_holiday_closure,
       (SELECT to_char(sr.last_run_at AT TIME ZONE 'Europe/Zurich', 'YYYY-MM-DD HH24:MI') FROM sync_runs sr WHERE sr.source = 'schulferien_sync') AS schulferien_synced_at
FROM halls h
WHERE EXISTS (SELECT 1 FROM hall_slots hs WHERE hs.hall = h.id AND ${TRAINING_SLOT} AND ${UNEXPIRED_SLOT})
  AND NOT EXISTS (
    SELECT 1 FROM hall_closures c
    WHERE c.hall = h.id AND c.source = 'school_holidays' AND c.end_date >= {{today}} + 180
  )
ORDER BY h.name, h.id`,
  },
  {
    key: 'tr_cancelled_ratio_4w',
    section: 'trainings',
    sport: 'both',
    severity: 'info',
    grain: 'team',
    title: 'Team with most upcoming trainings cancelled',
    description: 'More than half of the team\'s trainings in the next 28 days are cancelled. The breakdown says why: by_closure = holidays or Hausdienst, by_game = own game days or hall blocks, manual = a coach cancelled by hand (bulk-cancelling instead of editing the slot is the usual story).',
    sql: `
SELECT ${TEAM_COLS},
       count(*)::int AS total,
       count(*) FILTER (WHERE tr.cancelled)::int AS cancelled,
       count(*) FILTER (WHERE tr.cancelled AND tr.auto_cancelled_by_closure IS NOT NULL)::int AS by_closure,
       count(*) FILTER (WHERE tr.cancelled AND tr.auto_cancelled_by_closure IS NULL AND tr.auto_shortened_by_game IS NOT NULL)::int AS by_game,
       count(*) FILTER (WHERE tr.cancelled AND tr.auto_cancelled_by_closure IS NULL AND tr.auto_shortened_by_game IS NULL AND tr.auto_cancelled_by_trial IS NOT NULL)::int AS by_trial,
       count(*) FILTER (WHERE tr.cancelled AND tr.auto_cancelled_by_closure IS NULL AND tr.auto_shortened_by_game IS NULL AND tr.auto_cancelled_by_trial IS NULL)::int AS manual
FROM trainings tr
JOIN teams t ON t.id = tr.team
WHERE ${ACTIVE_TEAM} AND tr.date BETWEEN {{today}} AND {{today}} + 28
GROUP BY t.id, t.name, t.sport
HAVING count(*) FILTER (WHERE tr.cancelled) * 2 > count(*)
ORDER BY cancelled DESC, sport, t.name, t.id`,
  },
  {
    key: 'tr_missing_core_fields',
    section: 'trainings',
    sport: 'both',
    severity: 'error',
    grain: 'training',
    title: 'Training without date, times or team',
    description: 'None of these columns is NOT NULL in the schema, and a row missing one (or ending before it starts) breaks calendar rendering and RSVP deadlines. Any row is unhealthy — fix or delete it.',
    sql: `
SELECT tr.id AS training_id, tr.date::text AS date, to_char(tr.start_time, 'HH24:MI') AS time,
       t.name AS team, t.id AS team_id, ${TEAM_SPORT} AS sport,
       to_char(tr.end_time, 'HH24:MI') AS end_time, tr.cancelled, tr.hall_slot IS NOT NULL AS from_slot,
       concat_ws(', ',
         CASE WHEN tr.date IS NULL THEN 'no date' END,
         CASE WHEN tr.start_time IS NULL THEN 'no start time' END,
         CASE WHEN tr.end_time IS NULL THEN 'no end time' END,
         CASE WHEN tr.team IS NULL THEN 'no team' END,
         CASE WHEN tr.end_time <= tr.start_time THEN 'ends before it starts' END
       ) AS problem
FROM trainings tr
LEFT JOIN teams t ON t.id = tr.team
WHERE tr.date IS NULL OR tr.start_time IS NULL OR tr.end_time IS NULL OR tr.team IS NULL
   OR tr.end_time <= tr.start_time
ORDER BY tr.date DESC NULLS FIRST, tr.id`,
  },
]
