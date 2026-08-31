import type { Team } from '../../../types'

// Volleyball teams that have no league fixtures to schedule (e.g. the kids'
// MiniVB program, and DU20 which has no league games this season) are excluded
// from Terminplanung entirely — no dashboard row, no slot config, no invites.
// Matched by exact team name. Mirror this list in the backend generate-slots
// skip (game-scheduling.js) so excluded teams produce no slots either.
export const SCHEDULING_EXCLUDED_TEAM_NAMES = ['MiniVB', 'DU20']

/**
 * Is this team part of the VOLLEYBALL Terminplanung engine — slot inventory,
 * opponent invites, home/away proposals, the admin dashboard?
 *
 * ⚠ This is a question about the NEGOTIATION, not about whether the team has a
 * schedule. Basketball plays a full season; ProBasket just decides it at the
 * Spielplansitzung instead of bilaterally, so there is nothing here to negotiate.
 * Use `hasFixtureSchedule` for "does this team have games to show".
 */
export function isSchedulableTeam(t: Pick<Team, 'sport' | 'active' | 'name'>): boolean {
  return t.sport === 'volleyball' && t.active && !SCHEDULING_EXCLUDED_TEAM_NAMES.includes(t.name)
}

/**
 * Does this team have a FIXTURE LIST worth showing — a season of games in
 * `games`, whoever produced them (Swiss Volley / VolleyManager, Basketplan, or a
 * planner entering one by hand)?
 *
 * ⚠⚠ Deliberately NOT `isSchedulableTeam`. Reusing that gate is what kept every
 * basketball team's schedule blank: the calendar page's "Schedule" tab is hidden
 * outright when no team passes, so a basketball-only member never saw the tab
 * exist — and a Herren 2 away game entered by hand on 14.08.2026 was reported
 * missing twice for exactly that reason. The volleyball engine gate happens to
 * have been a correct filter while basketball held no fixtures; it stopped being
 * one the moment ProBasket published the 2026/27 schedule.
 *
 * Still excludes MiniVB/DU20: they play no league games, so the list would be an
 * empty box on a page that renders it even when empty (`hideWhenEmpty={false}`).
 */
export function hasFixtureSchedule(t: Pick<Team, 'sport' | 'active' | 'name'>): boolean {
  return t.active && !SCHEDULING_EXCLUDED_TEAM_NAMES.includes(t.name)
}
