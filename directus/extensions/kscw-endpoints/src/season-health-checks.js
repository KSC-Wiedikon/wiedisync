/**
 * Season health — the check registry.
 *
 * One flat list assembled from the per-domain modules so the endpoint, the
 * unit test and the dev validation harness (`scripts/season-health-sql-check.mjs`)
 * all read the same thing. Add a domain by importing its `CHECKS` here.
 *
 * Contract for every entry (enforced by season-health.test.js):
 *   key          unique snake_case, prefixed by domain (vb_/bb_/team_/dues_/games_/duty_/rsvp_/tr_/events_/…)
 *   section      'players'|'teams'|'finance'|'games'|'duties'|'rsvp'|'trainings'|'events'
 *   sport        'vb'|'bb'|'both' — 'both' means every row carries a `sport` column
 *                ('volleyball'|'basketball'|NULL) OR the check names `memberIdColumn`
 *                so the runner can derive it, OR grain is 'club'
 *   severity     'error'|'warn'|'info'
 *   grain        'player'|'team'|'game'|'training'|'event'|'club'
 *   title        English, sentence case — the i18n fallback
 *   description  English — what "unhealthy" means and what to do about it
 *   sql          static SQL, `{{token}}` anchors only (see season-health-sql.js),
 *                deterministic ORDER BY, dates as ::text, times as HH:MM
 *   memberIdColumn  optional — column holding members.id for sport derivation
 *
 * Row conventions the frontend relies on: `*_id` columns are link targets and
 * are hidden; `sport` picks the tab; `first_name` + `last_name` render as one
 * Name cell; `team` renders as a TeamChip; booleans render as ✓/✗.
 */
import { CHECKS as PLAYERS, ROSTER_SQL } from './season-health-checks-players.js'
import { CHECKS as TEAMS, TEAM_SUMMARY_SQL } from './season-health-checks-teams.js'
import { CHECKS as FINANCE } from './season-health-checks-finance.js'
import { CHECKS as GAMES } from './season-health-checks-games.js'
import { CHECKS as DUTIES } from './season-health-checks-duties.js'
import { CHECKS as RSVP } from './season-health-checks-rsvp.js'
import { CHECKS as TRAININGS } from './season-health-checks-trainings.js'
import { CHECKS as EVENTS } from './season-health-checks-events.js'

export const SECTIONS = ['players', 'teams', 'finance', 'games', 'duties', 'rsvp', 'trainings', 'events']
export const SPORTS = ['vb', 'bb', 'both']
export const SEVERITIES = ['error', 'warn', 'info']
export const GRAINS = ['player', 'team', 'game', 'training', 'event', 'club']

export const CHECKS = [
  ...PLAYERS, ...TEAMS, ...FINANCE, ...GAMES, ...DUTIES, ...RSVP, ...TRAININGS, ...EVENTS,
]

/** The two tables that are not findings: every core roster player, every active team. */
export const TABLES = {
  players: ROSTER_SQL,
  teams: TEAM_SUMMARY_SQL,
}

/** Throws if the registry violates its own contract — called at module load by the endpoint. */
export function assertRegistry(checks = CHECKS) {
  const seen = new Set()
  for (const c of checks) {
    const where = `season-health check "${c.key ?? '?'}"`
    if (!c.key || !/^[a-z][a-z0-9_]+$/.test(c.key)) throw new Error(`${where}: bad key`)
    if (seen.has(c.key)) throw new Error(`${where}: duplicate key`)
    seen.add(c.key)
    if (!SECTIONS.includes(c.section)) throw new Error(`${where}: bad section ${c.section}`)
    if (!SPORTS.includes(c.sport)) throw new Error(`${where}: bad sport ${c.sport}`)
    if (!SEVERITIES.includes(c.severity)) throw new Error(`${where}: bad severity ${c.severity}`)
    if (!GRAINS.includes(c.grain)) throw new Error(`${where}: bad grain ${c.grain}`)
    if (typeof c.title !== 'string' || !c.title) throw new Error(`${where}: missing title`)
    if (typeof c.description !== 'string' || !c.description) throw new Error(`${where}: missing description`)
    if (typeof c.sql !== 'string' || !/\bselect\b/i.test(c.sql)) throw new Error(`${where}: missing sql`)
    // knex named binds are not supported here (see season-health-sql.js).
    // Strip string literals ('HH24:MI') and casts (::int) before looking.
    const bare = c.sql.replace(/'(?:[^']|'')*'/g, "''").replace(/::/g, ' ')
    if (/(^|[^:\\]):[a-z_]+\b/i.test(bare)) {
      throw new Error(`${where}: sql uses a :named bind — use {{tokens}}`)
    }
    if (c.sport === 'both' && c.grain !== 'club' && !c.memberIdColumn && !/\bsport\b/i.test(c.sql)) {
      throw new Error(`${where}: sport 'both' but the sql never selects a sport column`)
    }
  }
}
