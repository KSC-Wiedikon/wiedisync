/**
 * Season health — shared SQL rails for the check registry.
 *
 * Every check in `season-health-checks-*.js` is a STATIC SQL string. Nothing
 * from the request ever reaches the SQL; the only runtime values are the
 * season anchors, and they are rendered in as literals by `renderSql()` from
 * `{{token}}` placeholders. Two reasons for tokens instead of knex binds:
 *
 *   1. knex's `:name` named-bind parser also eats the `::type` casts these
 *      queries are full of (`btrim(m.license_nr)::bigint` → "Undefined
 *      binding(s) detected: bigint"). Positional `?` binds survive casts but
 *      cannot be repeated, and most checks need the season label three times.
 *   2. The dev validation harness (`scripts/season-health-sql-check.mjs`)
 *      pipes the same strings into psql, which has no knex to bind for it.
 *
 * Season anchors — five of them, because the club has five different ideas
 * of "this season" (see season.js header + INFRA.md):
 *   {{season}}        '2026/27'          games.season / teams.season / *_season stamps
 *   {{rollover}}      DATE '2026-06-01'  Jun 1 — the only window START that is always in the past
 *   {{season_start}}  DATE '2026-09-01'  Sep 1 — fixture calendar start (FUTURE Jun–Aug)
 *   {{season_end}}    DATE '2027-05-31'  last fixture month
 *   {{today}}         DATE '2026-09-15'  Zurich calendar date (the VPS runs UTC)
 *   {{now}}           TIMESTAMP '2026-09-15 16:20:00'  Zurich wall-clock, tz-naive —
 *                     compare against `g.date + g.time` (both tz-naive Zurich)
 */
import {
  currentSeasonShort, seasonRolloverDate, seasonStartDate, seasonEndDate,
} from './season.js'

/** Zurich wall-clock parts of `now` as [YYYY-MM-DD, HH:MM:SS]. */
function zurichStamp(now) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Zurich', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(now)
  const get = (t) => parts.find((p) => p.type === t)?.value ?? '00'
  // en-CA renders midnight as "24" in some ICU builds — normalise.
  const hh = get('hour') === '24' ? '00' : get('hour')
  return [`${get('year')}-${get('month')}-${get('day')}`, `${hh}:${get('minute')}:${get('second')}`]
}

/**
 * The anchors for a given instant. Plain strings (not SQL literals) so the
 * endpoint can echo them in the response; `renderSql` quotes them.
 */
export function seasonContext(now = new Date()) {
  const [today, clock] = zurichStamp(now)
  return {
    season: currentSeasonShort(now),
    rollover: seasonRolloverDate(now),
    season_start: seasonStartDate(now),
    season_end: seasonEndDate(now),
    today,
    now: `${today} ${clock}`,
  }
}

const TOKEN_RE = /\{\{(season|rollover|season_start|season_end|today|now)\}\}/g

/** SQL literal for a token value. Only ever called with values we produced. */
function literal(token, value) {
  const safe = String(value).replace(/'/g, "''")
  if (token === 'season') return `'${safe}'`
  if (token === 'now') return `TIMESTAMP '${safe}'`
  return `DATE '${safe}'`
}

/**
 * Render a check's SQL with the season anchors as literals. Throws on an
 * unknown `{{token}}` so a typo fails at registry load, not at 03:00 on prod.
 */
export function renderSql(sql, ctx = seasonContext()) {
  const out = sql.replace(TOKEN_RE, (_, token) => literal(token, ctx[token]))
  const leftover = out.match(/\{\{[^}]*\}\}/)
  if (leftover) throw new Error(`season-health: unknown SQL token ${leftover[0]}`)
  return out
}

// ── Shared predicates (string fragments — compose with template literals) ──
//
// Each one encodes a rule that at least one reader got wrong once. Use them
// instead of re-deriving; if you must deviate, say why next to the check.

/**
 * Real squads only: `clubdesk_group` is three-state — NULL = unconfigured
 * (reported elsewhere), '' = league umbrella (H-Classics 1LR / Damen
 * D-Classics 1LR: adults-only holding rows with no staff, large rosters).
 * Umbrellas must not trip "no coach" / "roster too big" / "member on N
 * teams". Alias the teams table as `t`.
 */
export const SQUAD_TEAM = `COALESCE(t.clubdesk_group, 'x') <> ''`

/** Active season teams. `teams.active` is the ONLY season guard for rosters. */
export const ACTIVE_TEAM = `t.active = true`

/** Sport as the two tab keys, from the one column that is allowed to say. */
export const TEAM_SPORT = `lower(t.sport)`

/** Core roster row (not a training guest). Alias member_teams as `mt`. */
export const CORE_PLAYER = `COALESCE(mt.guest_level, 0) = 0`

/**
 * Service / system rows in `members` that must never appear in a people
 * list. Alias members as `m`.
 */
export const REAL_PERSON = `NOT (m.email ILIKE 'system@%' OR m.email ILIKE '%@kscw.clubdesk.com' OR m.email ILIKE '%@kscw.ch')`

/**
 * A game that is still on the calendar. `status` is nullable by CHECK and
 * the sweeps treat NULL as scheduled — a bare `status = 'scheduled'` drops
 * every NULL row. Alias games as `g`.
 */
export const LIVE_GAME = `COALESCE(g.status, 'scheduled') NOT IN ('completed', 'cancelled', 'postponed')`

/** Upcoming = still on the calendar and not before today. */
export const UPCOMING_GAME = `${LIVE_GAME} AND g.date >= {{today}}`

/**
 * Cup ties get no duty team on purpose (Pikett). Any duty check must skip
 * them unless somebody set a duty team by hand.
 */
export const CUP_GAME = `COALESCE(g.league, '') ~* '\\mcup\\M|pokal|coupe|coppa'`

/**
 * Kick-off as a tz-naive Zurich timestamp. `time` is nullable and bp-sync
 * writes '00:00' for "no time yet".
 */
export const GAME_START = `(g.date + COALESCE(g.time, TIME '00:00'))`

/** "Game has ended" — mirrors DUTY_EVENT_DURATION_MS (3 h). */
export const GAME_ENDED = `${GAME_START} + INTERVAL '3 hours' < {{now}}`

/**
 * Volleymanager join: `members.license_nr` is a VARCHAR with significant
 * leading zeros, `sv_vm_check.association_id` is an integer. Guard the cast
 * or one hand-typed placeholder aborts the whole statement. Alias members
 * as `m`, sv_vm_check as `vm`.
 */
export const VM_JOIN = `LEFT JOIN sv_vm_check vm
       ON btrim(COALESCE(m.license_nr, '')) ~ '^[0-9]+$'
      AND vm.association_id = btrim(m.license_nr)::bigint`

/**
 * Basketplan licence-number equality. Basketplan prints every number as SIX
 * zero-padded digits ('038121') while `members.license_nr` carries the
 * ClubDesk spelling ('38121') — a plain text compare misses 14 of 248 matched
 * members (5 licensed Seniors read as unlicensed; found 2026-09-15). Leading
 * zeros are dropped on BOTH sides, still as text (no cast, so a non-numeric
 * placeholder cannot abort the statement); an all-zero value becomes NULL and
 * never matches. ⚠ licence-status.js and basketplan-scrape-people.mjs still
 * compare raw text — fix them the same way when touched.
 * Alias basketplan_people as `bp`, members as `m`.
 */
export const BP_NR_EQ = `NULLIF(ltrim(btrim(bp.licence_nr), '0'), '') = NULLIF(ltrim(btrim(COALESCE(m.license_nr, '')), '0'), '')`

/**
 * Basketplan register for THIS season: the scrape has no season column, so
 * `scraped_at >= Jun 1` is the pin (licence-status.js rule). Match by licence
 * number first (`BP_NR_EQ`), then exact name + birthdate. Yields one boolean
 * per member. Alias members as `m`.
 */
export const BP_LICENSED = `EXISTS (
  SELECT 1 FROM basketplan_people bp
   WHERE bp.scraped_at >= {{rollover}}
     AND NULLIF(btrim(bp.licence_nr), '') IS NOT NULL
     AND (
       ${BP_NR_EQ}
       OR (lower(btrim(bp.last_name)) = lower(btrim(m.last_name))
           AND lower(btrim(bp.first_name)) = lower(btrim(m.first_name))
           AND bp.birthdate = m.birthdate)
     )
)`

/**
 * Hall slot still in force. Semantics from slot-cascade.js effectiveEnd():
 * `valid_until` bounds the slot whenever set (indefinite or not); an
 * indefinite slot with no end rolls forever; a bounded slot with no end runs
 * to May 31. Alias hall_slots as `hs`.
 */
export const LIVE_SLOT = `COALESCE(hs.valid_from, {{rollover}}) <= {{today}}
  AND COALESCE(hs.valid_until, CASE WHEN hs.indefinite THEN DATE '9999-12-31' ELSE {{season_end}} END) >= {{today}}`

/** hall_slots.day_of_week is 0 = Monday … 6 = Sunday. */
export const SLOT_DOW = `(EXTRACT(ISODOW FROM d)::int - 1)`

/**
 * Everyone on a team, staff included, as (member, guest_level, is_staff).
 * Re-exported from activity-roster-sql.js so checks import one module.
 */
export { teamPeopleSql } from './activity-roster-sql.js'

/**
 * Common SELECT fragments so every row carries the same identity columns and
 * the frontend can link them. Dates go out as text (pg returns `date` as a
 * local-midnight JS Date that serialises a day off), times as HH:MM.
 */
export const MEMBER_COLS = `m.id AS member_id, m.first_name, m.last_name`
export const TEAM_COLS = `t.id AS team_id, t.name AS team, ${TEAM_SPORT} AS sport`
export const GAME_COLS = `g.id AS game_id, g.date::text AS date, to_char(g.time, 'HH24:MI') AS time,
       g.type AS home_away, g.home_team, g.away_team, g.league`
