// Duties a member has served: the seats they held on past games.

import type { Game } from '../../../types'

export type SeatKey =
  | 'scorer_member' | 'scoreboard_member' | 'scorer_scoreboard_member' | 'referee_member'
  | 'bb_scorer_member' | 'bb_timekeeper_member' | 'bb_24s_official'

const VB_SEATS: SeatKey[] = ['scorer_member', 'scoreboard_member', 'scorer_scoreboard_member', 'referee_member']
const BB_SEATS: SeatKey[] = ['bb_scorer_member', 'bb_timekeeper_member', 'bb_24s_official']

export interface ServedDuty {
  gameId: string
  date: string
  seat: SeatKey
}

/** Member id → duties served, newest first. One person holds one seat per game. */
export function servedDutiesByMember(games: Game[], sport: 'volleyball' | 'basketball'): Map<string, ServedDuty[]> {
  const seats = sport === 'volleyball' ? VB_SEATS : BB_SEATS
  const out = new Map<string, ServedDuty[]>()
  for (const g of games) {
    for (const seat of seats) {
      const holder = (g as unknown as Record<string, unknown>)[seat]
      if (holder == null || holder === '') continue
      const id = String(typeof holder === 'object' ? (holder as { id: unknown }).id : holder)
      const list = out.get(id) ?? []
      list.push({ gameId: String(g.id), date: String(g.date).slice(0, 10), seat })
      out.set(id, list)
    }
  }
  for (const list of out.values()) list.sort((a, b) => b.date.localeCompare(a.date))
  return out
}
