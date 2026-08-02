// Pure helpers shared by the sport-specific boards. Kept out of the component
// files so react-refresh sees those as component-only modules.

import type { BoardState, LiveSport, TeamView } from './types'

/** FIBA: the 5th team foul in a period puts the OPPONENT in the bonus. */
export const TEAM_FOUL_LIMIT = 5

/** Coerce an unknown `sport` (null, or a value a newer board publishes) to a known one. */
export function normaliseSport(v: unknown): LiveSport {
  return v === 'beach' || v === 'basketball' ? v : 'volleyball'
}

/** Split a board snapshot into two side-agnostic team views (A=left by getState()). */
export function toTeams(s: BoardState): [TeamView, TeamView] {
  return [
    {
      name: s.team_a_name,
      short: s.team_a_short || s.team_a_name,
      color: s.team_a_color,
      points: s.points_a,
      sets: s.sets_won_a,
      timeouts: s.timeouts_a,
      subs: s.subs_a,
      fouls: s.fouls_a,
      serving: s.serving_team === 'left',
      inBonus: s.fouls_b >= TEAM_FOUL_LIMIT,
    },
    {
      name: s.team_b_name,
      short: s.team_b_short || s.team_b_name,
      color: s.team_b_color,
      points: s.points_b,
      sets: s.sets_won_b,
      timeouts: s.timeouts_b,
      subs: s.subs_b,
      fouls: s.fouls_b,
      serving: s.serving_team === 'right',
      inBonus: s.fouls_a >= TEAM_FOUL_LIMIT,
    },
  ]
}

/** Pick a readable text colour (gray-900 or white) for a given team-colour background. */
export function readableOn(hex: string): string {
  const h = (hex || '').replace('#', '')
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  const r = parseInt(full.slice(0, 2), 16)
  const g = parseInt(full.slice(2, 4), 16)
  const b = parseInt(full.slice(4, 6), 16)
  if ([r, g, b].some(Number.isNaN)) return '#ffffff'
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return luminance > 0.6 ? '#111827' : '#ffffff'
}

/**
 * Beach teams are a two-player pair the board publishes in one name field
 * ("Müller / Meier"). Returns the individual players so the UI can stack them;
 * a single-part name comes back as a one-element array.
 */
export function beachPair(name: string): string[] {
  return (name || '')
    .split(/\s*[/&]\s*/)
    .map((p) => p.trim())
    .filter(Boolean)
}

/**
 * Which set is being played, for volleyball/beach. The board may publish it in
 * `period`; otherwise it's however many sets are already finished, plus one.
 */
export function currentSetNumber(s: BoardState): number {
  return s.period > 0 ? s.period : (s.set_results?.length ?? 0) + 1
}
