import type { Team } from '../../../types'

// Volleyball teams that have no league fixtures to schedule (e.g. the kids'
// MiniVB program, and DU20 which has no league games this season) are excluded
// from Terminplanung entirely — no dashboard row, no slot config, no invites.
// Matched by exact team name. Mirror this list in the backend generate-slots
// skip (game-scheduling.js) so excluded teams produce no slots either.
export const SCHEDULING_EXCLUDED_TEAM_NAMES = ['MiniVB', 'DU20']

export function isSchedulableTeam(t: Pick<Team, 'sport' | 'active' | 'name'>): boolean {
  return t.sport === 'volleyball' && t.active && !SCHEDULING_EXCLUDED_TEAM_NAMES.includes(t.name)
}
