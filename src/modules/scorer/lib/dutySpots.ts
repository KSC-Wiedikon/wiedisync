// Duty "spots" — one per game × role — behind the assignment overview.
//
// A spot EXISTS when the game carries a duty team for that role (or somebody is
// already signed up); it is OPEN when nobody has signed up yet. Emptiness is
// keyed off the member ID, never the resolved name: a member who has since left
// the club is absent from the (active-only) members query, and treating an
// unresolvable name as "nobody" would report a filled spot as open — exactly the
// row the "only empty spots" filter is supposed to hide.

import type { Game } from '../../../types'
import { relId } from '../../../utils/relations'
// Deliberately the ALGORITHM's isCupGame, not the looser one in
// utils/leagueClassification: a game the planner renders as an on-call slot and
// a game the overview renders as one must be the same set, always.
import { isCupGame } from '../components/AssignmentAlgorithm'

export type DutyRole =
  | 'scorer' | 'scoreboard' | 'scorer_scoreboard' | 'referee' | 'cup_on_call'
  | 'bb_scorer' | 'bb_timekeeper' | 'bb_24s_official'

export interface DutySpot {
  game: Game
  role: DutyRole
  teamId: string
  teamName: string
  /** '' when nobody has signed up — the ONE emptiness test. */
  memberId: string
  /** null when the id resolves to nobody (e.g. a member who left the club). */
  memberName: string | null
  /**
   * A cup game's on-call (Pikett) slot: shown so the game is visible, but a free
   * slot BY DESIGN, never an open gap. Callers must exclude it from the
   * open-spot count and the "only empty spots" filter — `!memberId` alone would
   * paint it red and send somebody chasing a duty nobody owes.
   */
  onCall: boolean
}

// Within one game: the order the roles are listed in.
const ROLE_ORDER: Record<DutyRole, number> = {
  scorer: 0, scoreboard: 1, scorer_scoreboard: 2, referee: 3, cup_on_call: 4,
  bb_scorer: 0, bb_timekeeper: 1, bb_24s_official: 2,
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

/** Fixed English 3-letter weekday (duty tables + exports are always English). */
export function weekdayShort(date: string): string {
  const d = new Date(date + 'T00:00:00')
  return Number.isNaN(d.getTime()) ? '' : WEEKDAYS[d.getDay()]
}

/** Every duty spot across the given games, chronological then by role. */
export function buildDutySpots(
  games: Game[],
  sport: 'volleyball' | 'basketball',
  teamNameById: Map<string, string>,
  memberNameById: Map<string, string>,
): DutySpot[] {
  const out: DutySpot[] = []
  const add = (game: Game, role: DutyRole, teamVal: unknown, memberVal: unknown) => {
    const teamId = relId(teamVal)
    const memberId = relId(memberVal)
    if (!teamId && !memberId) return // this game has no such duty
    out.push({
      game,
      role,
      teamId,
      teamName: teamId ? (teamNameById.get(teamId) ?? '?') : '',
      memberId,
      memberName: memberId ? (memberNameById.get(memberId) ?? null) : null,
      onCall: false,
    })
  }

  for (const game of games) {
    if (sport === 'volleyball') {
      const before = out.length
      add(game, 'scorer_scoreboard', game.scorer_scoreboard_duty_team, game.scorer_scoreboard_member)
      add(game, 'scorer', game.scorer_duty_team, game.scorer_member)
      add(game, 'scoreboard', game.scoreboard_duty_team, game.scoreboard_member)
      add(game, 'referee', game.referee_duty_team, game.referee_member)
      // A cup home game is assigned to nobody on purpose (runAssignment's 'cup'
      // mode = on-call/Pikett), so the four adds above emit nothing and the game
      // used to drop out of the overview entirely — a home game that still needs
      // somebody at the desk, invisible in the one view used to check coverage.
      // Emit a single standing row instead. Guarded on `before` so a cup game
      // that HAS been given a duty team or an assignee by hand keeps its real
      // spots rather than gaining a phantom second row.
      if (out.length === before && isCupGame(game.league)) {
        out.push({ game, role: 'cup_on_call', teamId: '', teamName: '', memberId: '', memberName: null, onCall: true })
      }
    } else {
      // One duty team supplies the whole crew unless a per-role team overrides it.
      const shared = relId(game.bb_duty_team)
      add(game, 'bb_scorer', relId(game.bb_scorer_duty_team) || shared, game.bb_scorer_member)
      add(game, 'bb_timekeeper', relId(game.bb_timekeeper_duty_team) || shared, game.bb_timekeeper_member)
      // The 24s desk is optional — it's opened per game on /scorer. Deriving it
      // from the shared duty team would invent an open spot on EVERY basketball
      // game, so it counts only once it has its own duty team or an assignee.
      const own24s = relId(game.bb_24s_duty_team)
      const has24s = !!own24s || !!relId(game.bb_24s_official)
      if (has24s) add(game, 'bb_24s_official', own24s || shared, game.bb_24s_official)
    }
  }

  return out.sort((a, b) =>
    a.game.date.localeCompare(b.game.date)
    || (a.game.time ?? '').localeCompare(b.game.time ?? '')
    || ROLE_ORDER[a.role] - ROLE_ORDER[b.role])
}
