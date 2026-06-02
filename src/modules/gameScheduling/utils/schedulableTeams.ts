import type { Team } from '../../../types'

// Volleyball teams that have no league fixtures to schedule (e.g. the kids'
// MiniVB program) are excluded from Terminplanung entirely — no dashboard row,
// no slot config, no invites. Matched by exact team name so HU20/DU20/Legends
// (which do play league games) are unaffected.
export const SCHEDULING_EXCLUDED_TEAM_NAMES = ['MiniVB']

export function isSchedulableTeam(t: Pick<Team, 'sport' | 'active' | 'name'>): boolean {
  return t.sport === 'volleyball' && t.active && !SCHEDULING_EXCLUDED_TEAM_NAMES.includes(t.name)
}
