import type { Game, Team, Training, Member, MemberTeam } from '../../../types'
import {
  type ConflictEntry,
  OVERLAP_MINUTES,
  buildTeamGameTimes,
  buildTrainingDates,
  buildGamesByDateHall,
  getAdjacentTeams,
  timeToMin,
  trackAssignment,
} from './AssignmentAlgorithm'
import {
  type BbLeagueRequirement,
  licenceRank,
  resolveBbRequirement,
  seatRank,
} from '../lib/bbLeagueRequirements'

// Basketball duty assignment.
//
// Unlike volleyball (separate Scorer + Scoreboard teams, with a combined
// mode at Döltschi / lower leagues), basketball assigns ONE duty team per
// home game. That team supplies the whole crew — Anschreiber, Zeitnehmer
// and, where the league requires it, the 24s-Operator.
//
// How many officials that is, and which licence each needs, comes from
// ProBasket's Weisungen Sport Tabelle I via `bbLeagueRequirements`. It is not
// a flat two: D1/H1/H2 and the interregional youth leagues need three seats
// including an OTR2, and U8/U6 need no table at all. A team is only a
// candidate if it can actually field the seats that game's league demands —
// previously OTR2 was a soft bonus, so a D1 game could land on a team with
// none, which the referee then rejects at the table (Weisungen Spielleitung
// Art. 21).

export interface BbAssignmentInput {
  games: Game[]
  teams: Team[]
  trainings: Training[]
  members: Member[]
  memberTeams: MemberTeam[]
}

export interface BbGameAssignment {
  gameId: string
  dutyTeamId: string | null
  dutyTeamName: string | null
  score: number
  // Optional per-role assignee (member id) — set in scorer-assign's person editor
  // and written on roll-out. `undefined` = untouched (fall back to the game's
  // current member); string / null = explicitly set / cleared.
  bbScorerMemberId?: string | null
  bbTimekeeperMemberId?: string | null
  bb24sMemberId?: string | null
  conflicts: ConflictEntry[]
}

interface BbTeamScore {
  teamId: string
  teamName: string
  score: number
  disqualified: boolean
  reasons: ConflictEntry[]
}

/** Licence ranks of each team's non-guest members, highest first. */
function buildTeamLicenceRanks(members: Member[], memberTeams: MemberTeam[]): Map<string, number[]> {
  const rankByMember = new Map<string, number>()
  for (const m of members) rankByMember.set(m.id, licenceRank(m))

  const byTeam = new Map<string, number[]>()
  for (const mt of memberTeams) {
    if ((mt.guest_level ?? 0) !== 0) continue
    const rank = rankByMember.get(mt.member)
    if (rank == null) continue
    const arr = byTeam.get(mt.team)
    if (arr) arr.push(rank)
    else byTeam.set(mt.team, [rank])
  }
  for (const arr of byTeam.values()) arr.sort((a, b) => b - a)
  return byTeam
}

/**
 * Can this team staff every seat the league requires?
 *
 * Seats are nested by licence (a seat needing OTR1 is also satisfied by an
 * OTR2 or OTN holder), so it is enough to check, at each licence threshold,
 * that the team has at least as many members at or above it as there are
 * seats demanding it. Counting licences in total is not enough: three seats
 * needing one OTR2 and two OTR1 cannot be covered by one OTR2 alone.
 */
export function canFieldSeats(ranks: number[], req: BbLeagueRequirement): boolean {
  if (req.refereeOnly) return false
  const thresholds = [...new Set(req.seats.map(seatRank))]
  return thresholds.every((t) => {
    const seatsNeeding = req.seats.filter((seat) => seatRank(seat) >= t).length
    const membersAble = ranks.filter((r) => r >= t).length
    return membersAble >= seatsNeeding
  })
}

/** Classics rosters are league umbrellas that overlap the real squads. */
function isClassicsUmbrella(team: Team): boolean {
  return /classics/i.test(team.league ?? '')
}

function scoreTeam(
  teamId: string,
  teamName: string,
  game: Game,
  requirement: BbLeagueRequirement,
  teamGameTimes: Map<string, number[]>,
  trainingDates: Set<string>,
  adjacentTeams: Set<string>,
  teamRanks: Map<string, number[]>,
  assignmentCounts: Map<string, number>,
  dayAssignments: Map<string, Set<string>>,
): BbTeamScore {
  const reasons: ConflictEntry[] = []
  let score = 100
  let disqualified = false

  // === HARD RULES ===

  // 1. Team plays a game that OVERLAPS this one → DISQUALIFY (can't be in two
  //    places). A non-overlapping slot the same day is fine and in fact
  //    preferred — the crew is already at the hall, rewarded below. Excluding
  //    the whole day, as this engine used to, made the club's first-priority
  //    vorher/nachher rule impossible to express. Unknown time → fall back to
  //    same-day exclusion. Mirrors the volleyball engine.
  const dutyMin = timeToMin(game.time)
  const ownGameMins = teamGameTimes.get(`${teamId}|${game.date}`) ?? []
  const overlaps = dutyMin == null
    ? ownGameMins.length > 0
    : ownGameMins.some((m) => Math.abs(m - dutyMin) < OVERLAP_MINUTES)
  if (overlaps) {
    disqualified = true
    reasons.push({ key: 'reason_gameOverlap' })
  }

  // 2. Already assigned a duty on this day → DISQUALIFY
  if (dayAssignments.get(game.date)?.has(teamId)) {
    disqualified = true
    reasons.push({ key: 'reason_alreadyDuty' })
  }

  // 3. Must be able to staff every seat this league requires (Tabelle I).
  const ranks = teamRanks.get(teamId) ?? []
  if (!canFieldSeats(ranks, requirement)) {
    disqualified = true
    reasons.push({ key: 'reason_cannotFieldCrew', params: { row: requirement.row, seats: requirement.seats.length } })
  }

  if (disqualified) return { teamId, teamName, score: -Infinity, disqualified, reasons }

  // === SOFT RULES ===

  // Sequential game bonus: already at the hall before/after. The club's first
  // priority, so it must outweigh every other signal here. +50
  if (adjacentTeams.has(teamId)) {
    score += 50
    reasons.push({ key: 'reason_sequenceBonus', params: { points: 50 } })
  }

  // Spare OTR2 depth beyond the bare minimum → resilient to a late drop-out. +10
  const otr2Needed = requirement.seats.filter((seat) => seatRank(seat) >= 2).length
  const otr2Available = ranks.filter((r) => r >= 2).length
  if (otr2Needed > 0 && otr2Available > otr2Needed) {
    score += 10
    reasons.push({ key: 'reason_otr2Depth', params: { points: 10 } })
  }

  // Training conflict same day: -20
  if (trainingDates.has(`${teamId}|${game.date}`)) {
    score -= 20
    reasons.push({ key: 'reason_training', params: { points: -20 } })
  }

  // Fair rotation: -10 per existing duty this run
  const count = assignmentCounts.get(teamId) ?? 0
  if (count > 0) {
    const penalty = 10 * count
    score -= penalty
    reasons.push({ key: 'reason_rotation', params: { count, points: -penalty } })
  }

  // Weekend without training: +5
  const gameDay = new Date(game.date + 'T00:00:00').getDay()
  if ((gameDay === 0 || gameDay === 6) && !trainingDates.has(`${teamId}|${game.date}`)) {
    score += 5
    reasons.push({ key: 'reason_weekendFree', params: { points: 5 } })
  }

  return { teamId, teamName, score, disqualified, reasons }
}

export function runBbAssignment(input: BbAssignmentInput): BbGameAssignment[] {
  const { games, teams, trainings, members, memberTeams } = input

  // Classics are league umbrellas whose rosters overlap the real squads, so
  // counting them as duty teams would assign the same people twice.
  const bbTeams = teams.filter((t) => t.sport === 'basketball' && t.active && !isClassicsUmbrella(t))

  const teamRanks = buildTeamLicenceRanks(members, memberTeams)
  const teamGameTimes = buildTeamGameTimes(games)
  const trainingDates = buildTrainingDates(trainings)
  const gamesByDateHall = buildGamesByDateHall(games)

  const homeGames = games
    .filter((g) => g.type === 'home' && g.status !== 'postponed')
    .sort((a, b) => (a.date ?? '').localeCompare(b.date ?? '') || (a.time ?? '').localeCompare(b.time ?? ''))

  const assignmentCounts = new Map<string, number>()
  const dayAssignments = new Map<string, Set<string>>()
  const results: BbGameAssignment[] = []

  for (const game of homeGames) {
    const requirement = resolveBbRequirement(game.league)

    // U8/U6 are refereed, not tabled — there is no duty to assign.
    if (requirement.refereeOnly) {
      results.push({ gameId: game.id, dutyTeamId: null, dutyTeamName: null, score: 0, conflicts: [{ key: 'noTableRequired' }] })
      continue
    }

    const adjacentTeams = getAdjacentTeams(game, gamesByDateHall)

    // Keep an existing duty team (still counts toward fairness)
    if (game.bb_duty_team) {
      trackAssignment(game.bb_duty_team, game.date, assignmentCounts, dayAssignments)
      results.push({
        gameId: game.id,
        dutyTeamId: game.bb_duty_team,
        dutyTeamName: bbTeams.find((t) => t.id === game.bb_duty_team)?.name ?? null,
        score: 0,
        conflicts: [{ key: 'existingKept' }],
      })
      continue
    }

    const playingTeamId = game.kscw_team
    const scores = bbTeams
      .filter((t) => t.id !== playingTeamId)
      .map((t) => scoreTeam(
        t.id, t.name, game, requirement,
        teamGameTimes, trainingDates, adjacentTeams,
        teamRanks, assignmentCounts, dayAssignments,
      ))
      .filter((s) => !s.disqualified)
      .sort((a, b) => b.score - a.score)

    if (scores.length > 0) {
      const best = scores[0]
      trackAssignment(best.teamId, game.date, assignmentCounts, dayAssignments)
      results.push({
        gameId: game.id,
        dutyTeamId: best.teamId,
        dutyTeamName: best.teamName,
        score: best.score,
        conflicts: best.reasons.map((r) => ({ ...r, params: { ...r.params, team: best.teamName } })),
      })
    } else {
      results.push({ gameId: game.id, dutyTeamId: null, dutyTeamName: null, score: 0, conflicts: [{ key: 'noTeamAvailable' }] })
    }
  }

  return results
}

export interface BbTeamCountRow {
  duties: number
  ownGames: number
}

/** Per-team summary: duty count + own game count. */
export function getBbTeamCounts(
  results: BbGameAssignment[],
  allTeams: Team[],
  allGames: Game[],
): Map<string, BbTeamCountRow> {
  const counts = new Map<string, BbTeamCountRow>()

  for (const t of allTeams) {
    if (t.sport === 'basketball' && t.active) {
      const ownGames = allGames.filter((g) => String(g.kscw_team) === t.id).length
      counts.set(t.name, { duties: 0, ownGames })
    }
  }

  for (const r of results) {
    if (r.dutyTeamName && counts.has(r.dutyTeamName)) {
      counts.get(r.dutyTeamName)!.duties++
    }
  }

  return counts
}
