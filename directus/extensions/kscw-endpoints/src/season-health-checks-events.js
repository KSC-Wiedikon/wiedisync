/**
 * Season health — events.
 *
 * Every check is a static SQL string over `events` and its satellites
 * (events_teams, events_members, event_sessions, participations,
 * event_public_signups, user_logs). Rules that bit someone once, encoded
 * here so the checks agree with the app:
 *
 *   - start_date / end_date / respond_by are timestamptz on a UTC server.
 *     Every calendar comparison goes through `AT TIME ZONE 'Europe/Zurich'`
 *     before `::date` (EVENT_DATE / EVENT_END_DATE). All-day events are
 *     stored at UTC midnight (01:00/02:00 Zurich), timed ones at their
 *     Zurich wall time — both land on the right Zurich date this way.
 *   - respond_by at exactly 00:00:00 Zurich is the "no time given" sentinel:
 *     the effective deadline is the Zurich clock of start_date on that day,
 *     23:59 only when there is no start. That is what EventCard enforces —
 *     getDeadlineDate(respond_by, formatTime(start_date)) with NO all_day
 *     branch — so an all-day event (stored at UTC midnight) locks its RSVPs
 *     at 01:00/02:00 Zurich, not at 23:59. Mirror the code, not the intent.
 *   - Audience = events_teams (narrowed by invite_guests=false to core
 *     roster) ∪ events_members ∪ club-wide (both junctions empty → every
 *     wiedisync_active member). invited_roles is a json COLUMN the RSVP
 *     machinery ignores; it is cast ::jsonb. Two readings exist in the code:
 *     event-notify / fn_event_open_roster treat NULL, json null and [] as
 *     "no roles" (HAS_ROLES); publicEventsScope is stricter and publishes
 *     only NULL or [] (PUBLIC_SCOPE). Each check uses the reading of the
 *     code path it describes.
 *   - event_type has no DB CHECK. Every type predicate is NULL-safe: a bare
 *     `NOT (e.event_type IN (…))` is NULL for a NULL type and silently drops
 *     exactly the rows that are unreadable AND unpublished.
 *   - Sport is events_teams → teams.sport. An event whose teams span both
 *     sports emits one row per sport (EVENT_SPORT_CTE); a club-wide event
 *     has sport NULL and lands on the club-wide tab.
 *   - `participations.activity_id` is text: `p.activity_id = e.id::text`.
 *   - user_logs has `collection_name`, not `collection`.
 *   - Only per_day / per_session events are sessioned (kscw-hooks); NULL, ''
 *     and legacy values such as 'opt_in' behave as 'whole' for the sessions
 *     checks (events_type_or_mode_unknown reports the legacy ones).
 */
import { MEMBER_COLS, REAL_PERSON } from './season-health-sql.js'

// ── Local predicates (events only; nothing here is reused by other domains) ──

/** Zurich calendar date of the start. Alias events as `e`. */
const EVENT_DATE = `(e.start_date AT TIME ZONE 'Europe/Zurich')::date`

/** Zurich calendar date of the end (single-day events have no end_date). */
const EVENT_END_DATE = `(COALESCE(e.end_date, e.start_date) AT TIME ZONE 'Europe/Zurich')::date`

/** Identity columns for the `event` grain. */
const EVENT_COLS = `e.id AS event_id, e.title, ${EVENT_DATE}::text AS date`

const LIVE_EVENT = `e.cancelled = false`

/** Still ahead or in progress — the rows somebody can still act on. */
const UPCOMING_EVENT = `${LIVE_EVENT} AND ${EVENT_END_DATE} >= {{today}}`

/** This season's events (Jun 1 → …), summer camps and the GV included. */
const SEASON_EVENT = `${EVENT_DATE} >= {{rollover}}`

const HAS_TEAMS = `EXISTS (SELECT 1 FROM events_teams et WHERE et.events_id = e.id)`
const HAS_NAMED = `EXISTS (SELECT 1 FROM events_members em WHERE em.events_id = e.id)`

/**
 * invited_roles carries role chips unless NULL, json null or an empty array
 * — the reading event-notify (`invited_roles ?? []`) and fn_event_open_roster
 * share. Anything else (a non-empty array, an object, a string) is targeted.
 */
const HAS_ROLES = `(e.invited_roles IS NOT NULL
       AND jsonb_typeof(e.invited_roles::jsonb) <> 'null'
       AND NOT (jsonb_typeof(e.invited_roles::jsonb) = 'array' AND jsonb_array_length(e.invited_roles::jsonb) = 0))`

/** Role chips as a readable list (raw json when it is not an array). */
const ROLES_TEXT = `CASE WHEN e.invited_roles IS NOT NULL AND jsonb_typeof(e.invited_roles::jsonb) = 'array'
       THEN (SELECT string_agg(r, ', ' ORDER BY r) FROM jsonb_array_elements_text(e.invited_roles::jsonb) r)
       ELSE e.invited_roles::text END`

/**
 * Types every member (and kscw.ch) may read regardless of team scope.
 * COALESCE so `NOT ${PUBLIC_TYPE}` is TRUE, not NULL, for a NULL type.
 */
const PUBLIC_TYPE = `COALESCE(e.event_type, '') IN ('verein', 'tournament')`

/** The 7 values EventForm can write. No DB CHECK backs them. */
const KNOWN_TYPES = `('verein', 'social', 'meeting', 'tournament', 'trainingsweekend', 'friendly', 'other')`

/**
 * Published on kscw.ch / the iCal feed — publicEventsScope (public-events.js)
 * verbatim: no team, no named invitee, public type, roles NULL or [] (a json
 * null literal is WITHHELD there, unlike HAS_ROLES above).
 */
const PUBLIC_SCOPE = `(NOT ${HAS_TEAMS} AND NOT ${HAS_NAMED} AND ${PUBLIC_TYPE}
       AND (e.invited_roles IS NULL
            OR (jsonb_typeof(e.invited_roles::jsonb) = 'array' AND jsonb_array_length(e.invited_roles::jsonb) = 0)))`

/** Sessioned RSVP mode. COALESCE so `NOT` works on a NULL mode. */
const SESSIONED = `COALESCE(e.participation_mode, '') IN ('per_day', 'per_session')`

/**
 * Effective RSVP deadline (timestamptz) with the 00:00 sentinel resolved the
 * way EventCard does: to the Zurich clock of start_date (all-day rows
 * included — they sit at UTC midnight, so 01:00/02:00), 23:59 only when
 * start_date is NULL. Same shape as effectiveDeadlineSql (kscw-hooks).
 */
const EFFECTIVE_DEADLINE = `(CASE
       WHEN (e.respond_by AT TIME ZONE 'Europe/Zurich')::time = TIME '00:00:00'
       THEN (((e.respond_by AT TIME ZONE 'Europe/Zurich')::date
              + COALESCE((e.start_date AT TIME ZONE 'Europe/Zurich')::time, TIME '23:59'))
             AT TIME ZONE 'Europe/Zurich')
       ELSE e.respond_by END)`

/** Durable evidence that POST /kscw/events/:id/notify fired for the event. */
const NOTIFIED = `EXISTS (SELECT 1 FROM user_logs ul
       WHERE ul.collection_name = 'events' AND ul.action = 'notify' AND ul.record_id = e.id::text)`

/** Display name of the creator (NULL when created_by dangles). */
const CREATOR = `(SELECT concat_ws(' ', m.first_name, m.last_name) FROM members m WHERE m.id = e.created_by)`

/**
 * One (event, sport) pair per sport among the event's teams. LEFT JOIN it
 * as `es` so a club-wide event keeps a NULL sport instead of vanishing.
 */
const EVENT_SPORT_CTE = `event_sport AS (
  SELECT et.events_id, lower(t.sport) AS sport
    FROM events_teams et
    JOIN teams t ON t.id = et.teams_id
   GROUP BY et.events_id, lower(t.sport)
)`
const SPORT_JOIN = `LEFT JOIN event_sport es ON es.events_id = e.id`

/** Deterministic order for event-grain rows (a mixed-sport event emits two). */
const EVENT_ORDER = `ORDER BY e.start_date, e.id, es.sport`

export const CHECKS = [
  {
    key: 'events_upcoming_no_audience',
    section: 'events',
    sport: 'both',
    severity: 'error',
    grain: 'event',
    title: 'Upcoming event that nobody but its creator can see',
    description: 'No team, no named invitee, no role chips and not a public type (Verein/Tournament): the RSVP machinery treats it as club-wide, but the member policy lets only the creator read it. Add a team, invite members, or switch the type to Verein/Tournament.',
    sql: `
SELECT ${EVENT_COLS}, NULL::text AS sport, e.event_type, ${CREATOR} AS creator,
       (${EVENT_DATE} - {{today}})::int AS days_ahead
  FROM events e
 WHERE ${UPCOMING_EVENT}
   AND NOT ${HAS_TEAMS}
   AND NOT ${HAS_NAMED}
   AND NOT ${HAS_ROLES}
   AND NOT ${PUBLIC_TYPE}
 ORDER BY e.start_date, e.id`,
  },
  {
    key: 'events_role_only_invisible',
    section: 'events',
    sport: 'both',
    severity: 'error',
    grain: 'event',
    title: 'Role-only event of a non-public type is unreadable by its audience',
    description: 'The event is addressed only through role chips, but the member policy has no invited_roles branch, so nobody except the creator can open it. Add a team or named invitees, or make it a Verein/Tournament event.',
    sql: `
SELECT ${EVENT_COLS}, NULL::text AS sport, e.event_type, ${ROLES_TEXT} AS invited_roles,
       ${CREATOR} AS creator, ${NOTIFIED} AS notified
  FROM events e
 WHERE ${UPCOMING_EVENT}
   AND NOT ${PUBLIC_TYPE}
   AND ${HAS_ROLES}
   AND NOT ${HAS_TEAMS}
   AND NOT ${HAS_NAMED}
 ORDER BY e.start_date, e.id`,
  },
  {
    key: 'events_sessions_mode_mismatch',
    section: 'events',
    sport: 'both',
    severity: 'error',
    grain: 'event',
    title: 'RSVP mode disagrees with the event sessions',
    description: 'A per-day / per-session event without event_sessions rows cannot be answered at all, and a whole-event with leftover sessions confuses the day tabs. Re-save the event in the event form so the sessions match the mode.',
    sql: `
WITH ${EVENT_SPORT_CTE}
SELECT ${EVENT_COLS}, es.sport, e.participation_mode, e.all_day, ${EVENT_END_DATE}::text AS end_date,
       (SELECT count(*)::int FROM event_sessions s WHERE s.event = e.id) AS session_count
  FROM events e
  ${SPORT_JOIN}
 WHERE ${LIVE_EVENT} AND ${SEASON_EVENT}
   AND (
     (${SESSIONED} AND NOT EXISTS (SELECT 1 FROM event_sessions s WHERE s.event = e.id))
     OR (NOT ${SESSIONED} AND EXISTS (SELECT 1 FROM event_sessions s WHERE s.event = e.id))
   )
 ${EVENT_ORDER}`,
  },
  {
    key: 'events_session_dates_outside_range',
    section: 'events',
    sport: 'both',
    severity: 'warn',
    grain: 'event',
    title: 'Event session dated outside the event',
    description: 'A session with no date or a date before the start / after the end is a stranded leg: its RSVPs count, but the day never shows on the card. Fix the session dates in the event form.',
    sql: `
WITH ${EVENT_SPORT_CTE}
SELECT ${EVENT_COLS}, es.sport, ${EVENT_END_DATE}::text AS end_date,
       s.id AS session_id, s.label AS session_label, s.date::text AS session_date, s.sort_order
  FROM event_sessions s
  JOIN events e ON e.id = s.event
  ${SPORT_JOIN}
 WHERE ${LIVE_EVENT} AND ${SEASON_EVENT}
   AND (s.date IS NULL OR s.date < ${EVENT_DATE} OR s.date > ${EVENT_END_DATE})
 ORDER BY e.start_date, e.id, s.sort_order, s.id, es.sport`,
  },
  {
    key: 'events_per_day_rsvp_without_session',
    section: 'events',
    sport: 'both',
    severity: 'error',
    grain: 'event',
    title: 'RSVP rows whose session does not match the event',
    description: 'On a per-day / per-session event every RSVP must carry a session id; a session-less row, or one pointing at a session the event no longer has, is invisible to every day view and skews the totals. Delete or re-enter those RSVPs.',
    sql: `
WITH ${EVENT_SPORT_CTE},
rsvp AS (
  SELECT e.id AS event_id, p.member,
         (${SESSIONED} AND p.session_id IS NULL) AS sessionless,
         (p.session_id IS NOT NULL
          AND (NOT ${SESSIONED}
               OR NOT EXISTS (SELECT 1 FROM event_sessions s WHERE s.event = e.id AND s.id::text = p.session_id))) AS orphan
    FROM events e
    JOIN participations p ON p.activity_type = 'event' AND p.activity_id = e.id::text
   WHERE ${LIVE_EVENT} AND ${SEASON_EVENT}
),
bad AS (
  SELECT event_id,
         count(*) FILTER (WHERE sessionless)::int AS sessionless_rows,
         count(*) FILTER (WHERE orphan)::int AS orphan_session_rows,
         count(DISTINCT member)::int AS affected_members
    FROM rsvp
   WHERE sessionless OR orphan
   GROUP BY event_id
)
SELECT ${EVENT_COLS}, es.sport, e.participation_mode,
       b.sessionless_rows, b.orphan_session_rows, b.affected_members
  FROM events e
  JOIN bad b ON b.event_id = e.id
  ${SPORT_JOIN}
 ${EVENT_ORDER}`,
  },
  {
    key: 'events_past_respond_by_unanswered',
    section: 'events',
    sport: 'both',
    severity: 'warn',
    grain: 'event',
    title: 'RSVP deadline passed with invitees still unanswered',
    description: 'The deadline sweep only covers games and trainings, so event invitees who never answered stay open forever. Chase them or decline them by hand. Club-wide events count every active app user as audience, so expect large numbers there.',
    sql: `
WITH ${EVENT_SPORT_CTE},
due AS (
  SELECT e.id, e.title, e.start_date, ${EVENT_DATE} AS date_zh, e.invite_guests,
         ${EFFECTIVE_DEADLINE} AS deadline,
         (NOT ${HAS_TEAMS} AND NOT ${HAS_NAMED}) AS club_wide
    FROM events e
   WHERE ${UPCOMING_EVENT}
     AND e.respond_by IS NOT NULL
     AND (${EFFECTIVE_DEADLINE} AT TIME ZONE 'Europe/Zurich') < {{now}}
),
audience AS (
  SELECT d.id AS event_id, mt.member
    FROM due d
    JOIN events_teams et ON et.events_id = d.id
    JOIN member_teams mt ON mt.team = et.teams_id
   WHERE d.invite_guests IS NOT FALSE OR COALESCE(mt.guest_level, 0) = 0
  UNION
  SELECT d.id, em.members_id
    FROM due d
    JOIN events_members em ON em.events_id = d.id
  UNION
  SELECT d.id, m.id
    FROM due d
    CROSS JOIN members m
   WHERE d.club_wide AND m.wiedisync_active = true
),
tally AS (
  SELECT a.event_id,
         count(*)::int AS audience_size,
         count(*) FILTER (WHERE NOT EXISTS (
           SELECT 1 FROM participations p
            WHERE p.activity_type = 'event' AND p.activity_id = a.event_id::text AND p.member = a.member
         ))::int AS unanswered
    FROM audience a
    JOIN members m ON m.id = a.member
   WHERE m.wiedisync_active = true AND ${REAL_PERSON}
   GROUP BY a.event_id
)
SELECT d.id AS event_id, d.title, d.date_zh::text AS date, es.sport,
       to_char(d.deadline AT TIME ZONE 'Europe/Zurich', 'YYYY-MM-DD HH24:MI') AS deadline,
       d.club_wide, t.audience_size, t.unanswered,
       round(100.0 * t.unanswered / t.audience_size)::int AS unanswered_pct
  FROM due d
  JOIN tally t ON t.event_id = d.id
  LEFT JOIN event_sport es ON es.events_id = d.id
 WHERE t.unanswered > 0
 ORDER BY d.deadline, d.id, es.sport`,
  },
  {
    key: 'events_upcoming_zero_responses',
    section: 'events',
    sport: 'both',
    severity: 'warn',
    grain: 'event',
    title: 'Event within 14 days with no response at all',
    description: 'An event starting inside two weeks that has an audience but not a single RSVP or public signup. If notified is false the invite fan-out never fired — open the event and send the invitation.',
    sql: `
WITH ${EVENT_SPORT_CTE}
SELECT ${EVENT_COLS}, es.sport, e.event_type,
       (${EVENT_DATE} - {{today}})::int AS days_ahead,
       ${NOTIFIED} AS notified,
       (NULLIF(btrim(e.signup_url), '') IS NOT NULL) AS has_signup_form,
       ${CREATOR} AS creator
  FROM events e
  ${SPORT_JOIN}
 WHERE ${LIVE_EVENT}
   AND ${EVENT_DATE} BETWEEN {{today}} AND {{today}} + 14
   AND (${HAS_TEAMS} OR ${HAS_NAMED} OR ${HAS_ROLES} OR ${PUBLIC_TYPE})
   AND NOT EXISTS (SELECT 1 FROM participations p WHERE p.activity_type = 'event' AND p.activity_id = e.id::text)
   AND NOT EXISTS (SELECT 1 FROM event_public_signups ps WHERE ps.event = e.id)
 ${EVENT_ORDER}`,
  },
  {
    key: 'events_no_notify_fanout',
    section: 'events',
    sport: 'both',
    severity: 'info',
    grain: 'event',
    title: 'Named or role invitees were never sent the invitation',
    description: 'Only the notify fan-out reaches named invitees and role chips (the create trigger and the day-before reminder walk teams only), and the event form fires it once on create. No notify entry exists in the audit log — send the invitation from the event. Events created before 2026-08-10 predate the log and are skipped; an invitee added on a later edit is not detected (the log carries no recipient list).',
    sql: `
WITH ${EVENT_SPORT_CTE}
SELECT ${EVENT_COLS}, es.sport,
       (e.date_created AT TIME ZONE 'Europe/Zurich')::date::text AS created_date,
       (SELECT count(*)::int FROM events_members em WHERE em.events_id = e.id) AS named_invitees,
       ${ROLES_TEXT} AS invited_roles,
       ${CREATOR} AS creator
  FROM events e
  ${SPORT_JOIN}
 WHERE ${UPCOMING_EVENT}
   AND e.date_created >= TIMESTAMPTZ '2026-08-10 00:00:00+00'
   AND (${HAS_NAMED} OR ${HAS_ROLES})
   AND NOT ${NOTIFIED}
 ${EVENT_ORDER}`,
  },
  {
    key: 'events_missing_location',
    section: 'events',
    sport: 'both',
    severity: 'warn',
    grain: 'event',
    title: 'Upcoming event with no location and no hall',
    description: 'Location is optional in the form, so it is the most common omission; public rows go out to kscw.ch and every iCal subscriber with a blank place. Also catches a hall reference that points at a deleted hall. Fill in the location.',
    sql: `
WITH ${EVENT_SPORT_CTE}
SELECT ${EVENT_COLS}, es.sport, e.event_type,
       ${PUBLIC_SCOPE} AS is_public,
       (e.hall IS NOT NULL AND NOT EXISTS (SELECT 1 FROM halls h WHERE h.id = e.hall)) AS hall_missing,
       ${CREATOR} AS creator
  FROM events e
  ${SPORT_JOIN}
 WHERE ${UPCOMING_EVENT}
   AND NULLIF(btrim(e.location), '') IS NULL
   AND (e.hall IS NULL OR NOT EXISTS (SELECT 1 FROM halls h WHERE h.id = e.hall))
 ORDER BY ${PUBLIC_SCOPE} DESC, e.start_date, e.id, es.sport`,
  },
  {
    key: 'events_timed_without_time',
    section: 'events',
    sport: 'both',
    severity: 'warn',
    grain: 'event',
    title: 'Timed event at 00:00, ending before it starts, or without a start',
    description: 'The form defaults a missing start time to 00:00 for timed events, which then shows as 00:00 in every notification, the J+S export and iCal; an end before the start breaks the upcoming filter and the multi-day badge. Correct the times, or mark the event all-day.',
    sql: `
WITH ${EVENT_SPORT_CTE}
SELECT ${EVENT_COLS}, es.sport, e.all_day,
       CASE WHEN e.all_day THEN NULL ELSE to_char(e.start_date AT TIME ZONE 'Europe/Zurich', 'HH24:MI') END AS start_time,
       (e.end_date AT TIME ZONE 'Europe/Zurich')::date::text AS end_date,
       CASE WHEN e.all_day THEN NULL ELSE to_char(e.end_date AT TIME ZONE 'Europe/Zurich', 'HH24:MI') END AS end_time,
       CASE WHEN e.start_date IS NULL THEN 'No start date'
            WHEN e.end_date < e.start_date THEN 'End before start'
            ELSE 'Starts at 00:00' END AS problem
  FROM events e
  ${SPORT_JOIN}
 WHERE ${LIVE_EVENT}
   AND (e.start_date IS NULL OR (GREATEST(e.start_date, e.end_date) AT TIME ZONE 'Europe/Zurich')::date >= {{today}})
   AND (
     e.start_date IS NULL
     OR e.end_date < e.start_date
     OR (e.all_day = false AND (e.start_date AT TIME ZONE 'Europe/Zurich')::time = TIME '00:00:00')
   )
 ORDER BY e.start_date NULLS FIRST, e.id, es.sport`,
  },
  {
    key: 'events_respond_by_after_start',
    section: 'events',
    sport: 'both',
    severity: 'warn',
    grain: 'event',
    title: 'RSVP deadline lies after the event ends',
    description: 'A deadline later than the event itself is meaningless and keeps the public signup door open past the event. Move the deadline before the start (the 00:00 sentinel is resolved to the start time first).',
    sql: `
WITH ${EVENT_SPORT_CTE}
SELECT ${EVENT_COLS}, es.sport, e.all_day,
       CASE WHEN e.all_day THEN NULL ELSE to_char(e.start_date AT TIME ZONE 'Europe/Zurich', 'HH24:MI') END AS start_time,
       ${EVENT_END_DATE}::text AS end_date,
       to_char(${EFFECTIVE_DEADLINE} AT TIME ZONE 'Europe/Zurich', 'YYYY-MM-DD HH24:MI') AS deadline
  FROM events e
  ${SPORT_JOIN}
 WHERE ${UPCOMING_EVENT}
   AND e.respond_by IS NOT NULL
   AND CASE WHEN e.all_day
            THEN (e.respond_by AT TIME ZONE 'Europe/Zurich')::date > ${EVENT_END_DATE}
            ELSE ${EFFECTIVE_DEADLINE} > COALESCE(e.end_date, e.start_date) END
 ${EVENT_ORDER}`,
  },
  {
    key: 'events_inactive_team_only',
    section: 'events',
    sport: 'both',
    severity: 'error',
    grain: 'event',
    title: 'Upcoming event scoped only to archived teams',
    description: "Every linked team is inactive (last season's ids after the rollover), so the current rosters cannot see the event and the notifications went to last season's member rows. Re-link the event to the active teams.",
    sql: `
WITH ${EVENT_SPORT_CTE},
archived AS (
  SELECT et.events_id, count(*)::int AS team_count,
         string_agg(t.name || ' (' || COALESCE(t.season, '?') || ')', ', ' ORDER BY t.name, t.id) AS archived_teams
    FROM events_teams et
    JOIN teams t ON t.id = et.teams_id
   GROUP BY et.events_id
  HAVING bool_and(t.active = false)
)
SELECT ${EVENT_COLS}, es.sport, e.event_type, a.team_count, a.archived_teams
  FROM events e
  JOIN archived a ON a.events_id = e.id
  ${SPORT_JOIN}
 WHERE ${UPCOMING_EVENT}
 ${EVENT_ORDER}`,
  },
  {
    key: 'events_invited_member_not_active',
    section: 'events',
    sport: 'both',
    severity: 'info',
    grain: 'event',
    title: 'Named invitee without an active app login or membership',
    description: 'A personally invited member who cannot log in never sees the invite (push and bell need a session; email only if they have an address and opted in). Usually a stale pick from the member search — remove or replace the invitee.',
    sql: `
WITH ${EVENT_SPORT_CTE}
SELECT ${EVENT_COLS}, es.sport, ${MEMBER_COLS},
       m.wiedisync_active, m.kscw_membership_active, m.register_status
  FROM events e
  JOIN events_members em ON em.events_id = e.id
  JOIN members m ON m.id = em.members_id
  ${SPORT_JOIN}
 WHERE ${UPCOMING_EVENT}
   AND ${REAL_PERSON}
   AND (m.wiedisync_active = false OR m.kscw_membership_active = false)
 ORDER BY e.start_date, e.id, es.sport, m.last_name, m.first_name, m.id`,
  },
  {
    key: 'events_dangling_created_by_or_hall',
    section: 'events',
    sport: 'both',
    severity: 'warn',
    grain: 'event',
    title: 'Event whose creator or hall no longer exists',
    description: 'Neither created_by nor hall has a foreign key. The creator is what authorises notify, the signup form and the share link for non-admins, so a missing creator leaves only admins able to manage the event; a missing hall shows as no venue. Set a creator / clear the hall.',
    sql: `
WITH ${EVENT_SPORT_CTE}
SELECT ${EVENT_COLS}, es.sport, e.created_by,
       (e.created_by IS NULL OR NOT EXISTS (SELECT 1 FROM members m WHERE m.id = e.created_by)) AS creator_missing,
       e.hall,
       (e.hall IS NOT NULL AND NOT EXISTS (SELECT 1 FROM halls h WHERE h.id = e.hall)) AS hall_missing
  FROM events e
  ${SPORT_JOIN}
 WHERE ${LIVE_EVENT} AND ${SEASON_EVENT}
   AND (
     e.created_by IS NULL
     OR NOT EXISTS (SELECT 1 FROM members m WHERE m.id = e.created_by)
     OR (e.hall IS NOT NULL AND NOT EXISTS (SELECT 1 FROM halls h WHERE h.id = e.hall))
   )
 ${EVENT_ORDER}`,
  },
  {
    key: 'events_open_roster_drift',
    section: 'events',
    sport: 'both',
    severity: 'error',
    grain: 'event',
    title: 'Open-roster flag disagrees with its derivation',
    description: 'open_roster is trigger-derived (more or fewer than one team, or role chips) and is what lets a multi-team event show its full RSVP roster to everyone. Drift means a raw update bypassed the trigger — re-save the event or re-run the trigger update.',
    sql: `
WITH ${EVENT_SPORT_CTE}
SELECT ${EVENT_COLS}, es.sport, e.open_roster,
       fn_event_open_roster(e.id, e.invited_roles) AS should_be,
       (SELECT count(*)::int FROM events_teams et WHERE et.events_id = e.id) AS team_count,
       ${HAS_ROLES} AS has_roles
  FROM events e
  ${SPORT_JOIN}
 WHERE ${SEASON_EVENT}
   AND e.open_roster IS DISTINCT FROM fn_event_open_roster(e.id, e.invited_roles)
 ${EVENT_ORDER}`,
  },
  {
    key: 'events_js_relevant_missing_fields',
    section: 'events',
    sport: 'both',
    severity: 'warn',
    grain: 'event',
    title: 'J+S event missing its team link or mandatory export fields',
    description: 'The J+S export walks events_teams, so a J+S-relevant event without a team is silently never exported; and for type Training the NDS rejects the file when ZEIT or ORT is empty (all-day blanks the time). Link a team and fill in time and location.',
    sql: `
WITH ${EVENT_SPORT_CTE}
SELECT ${EVENT_COLS}, es.sport,
       CASE WHEN e.js_activity_type IN ('Wettkampf', 'Trainingstag', 'Lagertag') THEN e.js_activity_type ELSE 'Training' END AS js_activity_type,
       e.all_day, e.location,
       (NOT ${HAS_TEAMS}) AS no_team_link,
       (e.js_activity_type IS DISTINCT FROM 'Wettkampf' AND e.js_activity_type IS DISTINCT FROM 'Trainingstag'
        AND e.js_activity_type IS DISTINCT FROM 'Lagertag'
        AND (NULLIF(btrim(e.location), '') IS NULL OR e.all_day)) AS training_missing_time_or_place
  FROM events e
  ${SPORT_JOIN}
 WHERE e.js_relevant = true AND ${LIVE_EVENT} AND ${SEASON_EVENT}
   AND (
     NOT ${HAS_TEAMS}
     OR (e.js_activity_type IS DISTINCT FROM 'Wettkampf' AND e.js_activity_type IS DISTINCT FROM 'Trainingstag'
         AND e.js_activity_type IS DISTINCT FROM 'Lagertag'
         AND (NULLIF(btrim(e.location), '') IS NULL OR e.all_day))
   )
 ${EVENT_ORDER}`,
  },
  {
    key: 'events_max_players_overbooked',
    section: 'events',
    sport: 'both',
    severity: 'info',
    grain: 'event',
    title: 'Event with more confirmed players than its cap',
    description: 'Confirmed players plus the +1s they bring exceed max_players — the same sum the roster modal shows as "Full" (staff rows excluded, one count per member across per-day sessions). The cap is only a client-side warning, so auto-confirm and the roster modal can push past it — move the surplus to the waitlist or raise the cap.',
    sql: `
WITH ${EVENT_SPORT_CTE},
per_member AS (
  SELECT p.activity_id, p.member,
         bool_or(p.status = 'confirmed' AND p.is_staff = false) AS confirmed_player,
         max(p.guest_count) FILTER (WHERE p.status = 'confirmed' AND p.is_staff = false) AS plus_ones,
         bool_or(p.status = 'waitlisted') AS waitlisted
    FROM participations p
   WHERE p.activity_type = 'event'
   GROUP BY p.activity_id, p.member
),
tally AS (
  SELECT activity_id,
         count(*) FILTER (WHERE confirmed_player)::int AS confirmed_players,
         COALESCE(sum(plus_ones) FILTER (WHERE confirmed_player), 0)::int AS plus_ones,
         count(*) FILTER (WHERE waitlisted)::int AS waitlisted
    FROM per_member
   GROUP BY activity_id
)
SELECT ${EVENT_COLS}, es.sport, e.max_players, t.confirmed_players, t.plus_ones, t.waitlisted,
       (t.confirmed_players + t.plus_ones - e.max_players) AS over_by
  FROM events e
  JOIN tally t ON t.activity_id = e.id::text
  ${SPORT_JOIN}
 WHERE ${UPCOMING_EVENT}
   AND COALESCE(e.max_players, 0) > 0
   AND t.confirmed_players + t.plus_ones > e.max_players
 ${EVENT_ORDER}`,
  },
  {
    key: 'events_type_or_mode_unknown',
    section: 'events',
    sport: 'both',
    severity: 'warn',
    grain: 'event',
    title: 'Event type or RSVP mode outside the vocabulary the app knows',
    description: 'Neither column has a DB CHECK. An event_type the form cannot write (or NULL) has no type chip, no public branch and no i18n label; a participation_mode outside whole / per_day / per_session (legacy opt_in, empty string) is skipped by auto-confirm and the absence sweep but not by the sessions logic. Re-save the event with a valid type and mode.',
    sql: `
WITH ${EVENT_SPORT_CTE}
SELECT ${EVENT_COLS}, es.sport, e.event_type, e.participation_mode,
       concat_ws(', ',
         CASE WHEN COALESCE(e.event_type, '') NOT IN ${KNOWN_TYPES} THEN 'Unknown event_type' END,
         CASE WHEN e.participation_mode IS NOT NULL AND e.participation_mode NOT IN ('whole', 'per_day', 'per_session') THEN 'Unknown participation_mode' END
       ) AS problem
  FROM events e
  ${SPORT_JOIN}
 WHERE ${LIVE_EVENT} AND ${SEASON_EVENT}
   AND (
     COALESCE(e.event_type, '') NOT IN ${KNOWN_TYPES}
     OR (e.participation_mode IS NOT NULL AND e.participation_mode NOT IN ('whole', 'per_day', 'per_session'))
   )
 ${EVENT_ORDER}`,
  },
  {
    key: 'events_season_sport_summary',
    section: 'events',
    sport: 'both',
    severity: 'info',
    grain: 'club',
    title: 'Season event totals by sport',
    description: 'Context, not a defect list: events since the June rollover per sport (an event with teams of both sports counts in both; club-wide events have no sport). with_rsvp counts events that received at least one answer, confirmed_people the distinct members confirmed across them.',
    sql: `
WITH ${EVENT_SPORT_CTE},
ev AS (
  SELECT e.id, e.cancelled, es.sport,
         ${EVENT_END_DATE} AS end_zh
    FROM events e
    ${SPORT_JOIN}
   WHERE ${SEASON_EVENT}
)
SELECT ev.sport,
       count(DISTINCT ev.id)::int AS events,
       count(DISTINCT ev.id) FILTER (WHERE NOT ev.cancelled AND ev.end_zh >= {{today}})::int AS upcoming,
       count(DISTINCT ev.id) FILTER (WHERE NOT ev.cancelled AND ev.end_zh < {{today}})::int AS past,
       count(DISTINCT ev.id) FILTER (WHERE ev.cancelled)::int AS cancelled,
       count(DISTINCT ev.id) FILTER (WHERE p.id IS NOT NULL)::int AS with_rsvp,
       count(DISTINCT p.member) FILTER (WHERE p.status = 'confirmed' AND p.is_staff = false)::int AS confirmed_people
  FROM ev
  LEFT JOIN participations p ON p.activity_type = 'event' AND p.activity_id = ev.id::text
 GROUP BY ev.sport
 ORDER BY ev.sport NULLS LAST`,
  },
]
