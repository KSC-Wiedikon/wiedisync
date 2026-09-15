import { useMemo } from 'react'
import type { Game, Team, Hall, BaseRecord } from '../types'
import { useCollection } from '../lib/query'
import { useAuth } from './useAuth'
import { useNow } from './useNow'
import { startMsOf, DUTY_EVENT_DURATION_MS } from './useMyDuties'
import { DEEP_LINK_FIELDS } from './useDeepLinkedActivity'
import { addDays, toISODate } from '../utils/dateHelpers'

/** A home game keeps nudging for this many days after it was played. */
export const REF_EXPENSE_NUDGE_LOOKBACK_DAYS = 14

/** A game as the nudge fetches it — `DEEP_LINK_FIELDS.games`, so GameDetailModal renders it as-is. */
export type NudgeGame = Game & {
  kscw_team?: (Team & BaseRecord) | string
  hall?: (Hall & BaseRecord) | string
}

/** The two columns of a `referee_expenses` row the nudge reads. */
export interface RefereeExpenseRef {
  id: string | number
  game: string | number | null
}

const EMPTY_GAMES: NudgeGame[] = []

/** True once the match window (kickoff + DUTY_EVENT_DURATION_MS) is behind `nowMs`. */
export function refereeGameEnded(g: Pick<Game, 'date' | 'time'>, nowMs: number): boolean {
  const start = startMsOf(g)
  return start != null && start + DUTY_EVENT_DURATION_MS <= nowMs
}

/**
 * Pure core of the nudge: the games that have ENDED and have NO
 * `referee_expenses` row. Order is preserved from `games`.
 *
 * Ids are compared as strings on both sides — `fetchItems` stringifies FK ids
 * (`referee_expenses.game` arrives as `"123"`) while a game's own `id` may be a
 * number depending on the caller, and a naive `===` would report every game as
 * missing.
 */
export function missingRefereeGames<G extends { id: string | number } & Pick<Game, 'date' | 'time'>>(
  games: readonly G[],
  refereeRows: readonly RefereeExpenseRef[],
  nowMs: number,
): G[] {
  const recorded = new Set<string>()
  for (const r of refereeRows) {
    if (r.game != null) recorded.add(String(r.game))
  }
  return games.filter((g) => refereeGameEnded(g, nowMs) && !recorded.has(String(g.id)))
}

/**
 * Volleyball HOME games of the teams the logged-in member coaches / is
 * responsible for that have ended in the last two weeks and still have no
 * referee-expense row.
 *
 * Request budget (CLAUDE.md → "slow app = count requests"): exactly two for a
 * leader — one `games` list, one `referee_expenses` list keyed on the ended
 * games' ids — and ZERO for everyone else (`enabled` off `coachTeamIds`). No
 * per-row hooks. The `referee_expenses` query is invalidated by `useMutation`
 * on save, so a row recorded through GameDetailModal drops off the nudge
 * without a reload.
 *
 * Gated on `coachTeamIds` (coaches ∪ team responsibles of ACTIVE teams), NOT
 * `isCoach` — that flag is true for every global admin, who would otherwise be
 * nagged about every team's home games.
 */
export function useMissingRefereeExpenses(): { games: NudgeGame[]; isLoading: boolean } {
  const { user, isApproved, coachTeamIds } = useAuth()
  const isLeader = !!user && isApproved && coachTeamIds.length > 0
  // Minute clock so a game that ends while Home is open surfaces on its own,
  // and the date window rolls over at midnight without a reload. The window
  // strings only change once a day, so the query key (and the request) does not.
  const now = useNow()
  const from = useMemo(() => toISODate(addDays(new Date(now), -REF_EXPENSE_NUDGE_LOOKBACK_DAYS)), [now])
  const to = useMemo(() => toISODate(new Date(now)), [now])

  const filter = useMemo(() => ({
    _and: [
      { kscw_team: { _in: coachTeamIds.length ? coachTeamIds : ['-1'] } },
      // M2O walk (games.kscw_team → teams.sport), not an M2M — and both
      // collections are unfiltered member reads, so no deep-filter trap.
      { kscw_team: { sport: { _eq: 'volleyball' } } },
      { type: { _eq: 'home' } },
      { away_team: { _nnull: true } },
      { date: { _gte: from } },
      { date: { _lte: to } },
      // `status` defaults NULL and sv-sync only sets 'completed' once a winner
      // exists. A bare `_nin` is SQL NOT IN, which drops NULL rows — keep them.
      { _or: [{ status: { _null: true } }, { status: { _nin: ['cancelled', 'postponed'] } }] },
    ],
  }), [coachTeamIds, from, to])

  const { data: gamesData, isLoading: gamesLoading } = useCollection<NudgeGame>('games', {
    filter,
    fields: [...DEEP_LINK_FIELDS.games],
    sort: ['-date', '-time'],
    limit: 20,
    enabled: isLeader,
  })
  const games = gamesData ?? EMPTY_GAMES

  // Only the games that have actually ended need a row lookup — a home game
  // scheduled for tonight is not a candidate yet, and on a day with nothing
  // ended in the window this saves the second request entirely.
  const endedIds = useMemo(
    () => games.filter((g) => refereeGameEnded(g, now)).map((g) => String(g.id)),
    [games, now],
  )

  const { data: rows, isLoading: rowsLoading } = useCollection<RefereeExpenseRef>('referee_expenses', {
    filter: { game: { _in: endedIds.length ? endedIds : ['-1'] } },
    fields: ['id', 'game'],
    limit: 50,
    enabled: endedIds.length > 0,
  })

  // Strict waterfall: the render that first enables the rows query is one where
  // `rows` is necessarily undefined. Treating that as "no rows" would flash the
  // banner for every ended game and then hide the recorded ones a round-trip
  // later — so nothing is "missing" until the rows have actually landed. On a
  // failed rows read this stays empty (fail closed: better silence than nagging
  // a coach about an expense they already recorded).
  const missing = useMemo(
    () => (endedIds.length > 0 && rows !== undefined ? missingRefereeGames(games, rows, now) : []),
    [games, rows, endedIds.length, now],
  )

  const isLoading = isLeader && (gamesLoading || (endedIds.length > 0 && rowsLoading))

  return { games: missing, isLoading }
}
