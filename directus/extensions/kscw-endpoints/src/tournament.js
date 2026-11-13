/**
 * Tournament games — a day of short matches (SM Quali, a youth tournament), not a fixture.
 * Owner, 13.11.2026: they stay off the school's hall calendar (gcal-push.js), and the
 * members' iCal feed shows each tournament day as ONE all-day event per team
 * (ical-feed.js tournamentDayEvent). The app itself still lists the matches.
 *
 * Swiss Volley gives no "tournament" flag, so the league name decides: "SM …" (Swiss
 * championship rounds), "Turnier", "Tournoi", "Torneo", "Tournament", "Finalrunde",
 * "Final Four". The JS and SQL patterns must match the same names (tournament.test.js).
 */
export const TOURNAMENT_LEAGUE_RE = /\b(SM|Turnier|Tournoi|Torneo|Tournament|Finalrunde|Final ?Four)\b/i

// Postgres ARE: \m / \M are word boundaries. Used with ~* (case-insensitive).
export const TOURNAMENT_LEAGUE_SQL = '\\m(SM|Turnier|Tournoi|Torneo|Tournament|Finalrunde|Final ?Four)\\M'

export function isTournamentLeague(league) {
  return TOURNAMENT_LEAGUE_RE.test(String(league ?? ''))
}

/** knex: leave tournament games out. `column` is the league column, e.g. 'g.league'. */
export function excludeTournaments(qb, column = 'league') {
  return qb.whereRaw(`COALESCE(${column}, '') !~* ?`, [TOURNAMENT_LEAGUE_SQL])
}
