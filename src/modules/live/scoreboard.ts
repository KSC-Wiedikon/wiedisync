// Pure helpers shared by the sport-specific boards. Kept out of the component
// files so react-refresh sees those as component-only modules.

import type { BoardState, LiveSport, SetResult, TeamView } from './types'

/** FIBA: the 5th team foul in a period puts the OPPONENT in the bonus. */
export const TEAM_FOUL_LIMIT = 5

/** Coerce an unknown `sport` (null, or a value a newer board publishes) to a known one. */
export function normaliseSport(v: unknown): LiveSport {
  return v === 'beach' || v === 'basketball' ? v : 'volleyball'
}

const toNum = (v: unknown): number => {
  const n = typeof v === 'string' ? Number(v) : (v as number)
  return Number.isFinite(n) ? n : 0
}

/**
 * Coerce one raw `set_results` entry. `dur` (seconds, optional) is kept only when
 * it is a finite, non-negative number — anything else means "not measured", so a
 * garbage value can never produce a bogus match time.
 */
export function normaliseSetResult(r: unknown): SetResult {
  const o = (r && typeof r === 'object' ? r : {}) as Record<string, unknown>
  const out: SetResult = { a: toNum(o.a), b: toNum(o.b) }
  const d = typeof o.dur === 'string' && o.dur.trim() !== '' ? Number(o.dur) : o.dur
  if (typeof d === 'number' && Number.isFinite(d) && d >= 0) out.dur = Math.round(d)
  return out
}

/**
 * Whether team A is the home team, for a board that sent no full names and so no way to tell by
 * name. The row is always A = left and the teams change ends, so it goes by the set: home starts
 * on the left, every set changes ends, and the fifth changes again at 8. Whoever started on the
 * left is home. Only a guess if the crew does not switch ends when the rules say.
 */
export function homeIsTeamA(s: Pick<BoardState, 'sport' | 'period' | 'points_a' | 'points_b'>): boolean {
  if (s.sport !== 'volleyball') return true
  const set = Math.max(s.period, 1)
  if (set === 5 && Math.max(s.points_a, s.points_b) >= 8) return false
  return set % 2 === 1
}

/** A team on the page: its full name, else what the crew typed, else Home / Away. */
export function teamLabel(team: Pick<TeamView, 'name' | 'short' | 'homeAway'>, t: (key: string) => string): string {
  return team.name || team.short || t(team.homeAway === 'home' ? 'teamHome' : 'teamAway')
}

/** The board's own default names already say it, and beach changes ends every 7 points. */
function tagsMakeSense(s: BoardState): boolean {
  const defaults = ['HOME', 'AWAY']
  return s.sport !== 'beach' && !defaults.includes(s.team_a_short.toUpperCase()) && !defaults.includes(s.team_b_short.toUpperCase())
}

/** Split a board snapshot into two side-agnostic team views (A=left by getState()). */
export function toTeams(s: BoardState): [TeamView, TeamView] {
  const aIsHome = homeIsTeamA(s)
  const tags = tagsMakeSense(s)
  return [
    {
      name: s.team_a_name,
      homeAway: aIsHome ? 'home' : 'away',
      tagged: tags && !s.team_a_name && !!s.team_a_short,
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
      homeAway: aIsHome ? 'away' : 'home',
      tagged: tags && !s.team_b_name && !!s.team_b_short,
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

/**
 * The `live_history` filter for a /live channel: a game's own channel (`game-<id>`) lists
 * that game's archived matches (`game_id`, migration 425 — the board archives a match it
 * could tie to its fixture with it), any other channel that board's log.
 */
export function historyFilter(channel: string): Record<string, unknown> {
  const game = /^game-(\d+)$/.exec(channel)
  return game ? { game_id: { _eq: Number(game[1]) } } : { channel: { _eq: channel } }
}
