// Basketball duty teams are chosen PER GAME, not per seat (unlike volleyball):
// one team — or, since migration 371, several — supplies the whole table crew,
// and any member of any of them may take any seat they hold the licence for.
//
//   bb_duty_team         the primary team (auto-assign writes it; stats read it)
//   bb_extra_duty_teams  json array of further team ids sharing the duty
//
// The per-seat `bb_*_duty_team` columns are legacy (a delegation to another team
// still stamps one). A seat is open to its own team AND every game team — a
// union, so a stale per-seat value can never lock the game's teams out.

import type { Game } from '../../../types'
import { relId } from '../../../utils/relations'

export type BbSeatRole = 'bb_scorer' | 'bb_timekeeper' | 'bb_24s_official'

const SEAT_TEAM_COL: Record<BbSeatRole, 'bb_scorer_duty_team' | 'bb_timekeeper_duty_team' | 'bb_24s_duty_team'> = {
  bb_scorer: 'bb_scorer_duty_team',
  bb_timekeeper: 'bb_timekeeper_duty_team',
  bb_24s_official: 'bb_24s_duty_team',
}

function uniq(ids: string[]): string[] {
  return [...new Set(ids.filter(Boolean))]
}

/** Every team on duty for this game, primary first. */
export function bbGameDutyTeamIds(game: Pick<Game, 'bb_duty_team' | 'bb_extra_duty_teams'>): string[] {
  const extra = Array.isArray(game.bb_extra_duty_teams) ? game.bb_extra_duty_teams : []
  return uniq([relId(game.bb_duty_team), ...extra.map((x) => relId(x))])
}

/** Teams whose members may take this seat: its own legacy team ∪ the game teams. */
export function bbSeatDutyTeamIds(game: Game, role: BbSeatRole): string[] {
  return uniq([relId(game[SEAT_TEAM_COL[role]]), ...bbGameDutyTeamIds(game)])
}

/** Every team with any BB duty on this game (seat overrides included). */
export function bbAllDutyTeamIds(game: Game): string[] {
  return uniq([
    relId(game.bb_scorer_duty_team), relId(game.bb_timekeeper_duty_team), relId(game.bb_24s_duty_team),
    ...bbGameDutyTeamIds(game),
  ])
}

/** Items-API payload for a new game-level team selection. Clears the per-seat
 *  columns so the game teams are the one source again. */
export function bbDutyTeamsPayload(teamIds: string[]): Partial<Record<string, unknown>> {
  const ids = uniq(teamIds)
  return {
    bb_duty_team: ids[0] ?? null,
    bb_extra_duty_teams: ids.length > 1 ? ids.slice(1).map(Number) : null,
    bb_scorer_duty_team: null,
    bb_timekeeper_duty_team: null,
    bb_24s_duty_team: null,
  }
}
