import type { Game, Team, Training, Member, MemberTeam } from '../../../types'
import {
  type ConflictEntry,
  buildTeamGameDates,
  buildTrainingDates,
  buildGamesByDateHall,
  getAdjacentTeams,
  trackAssignment,
} from './AssignmentAlgorithm'

// Basketball duty assignment.
//
// Unlike volleyball (separate Scorer + Scoreboard teams, with a combined
// mode at Döltschi / lower leagues), basketball assigns ONE duty team per
// home game. That team supplies all 2–3 officials — Anschreiber (OTR1),
// Zeitnehmer (OTR1) and, when the level requires it, the 24s-Operator
// (OTR2/OTN). Whether a game actually needs the 24s slot filled is decided
// per-person later on the Scorer page; the team assignment is the same
// either way, so the engine just picks the best single team.

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

/** Team IDs that have a non-guest member matching the predicate. */
function buildLicenceTeams(
  members: Member[],
  memberTeams: MemberTeam[],
  hasLicence: (m: Member) => boolean,
): Set<string> {
  const memberIds = new Set<string>()
  for (const m of members) if (hasLicence(m)) memberIds.add(m.id)
  const teams = new Set<string>()
  for (const mt of memberTeams) {
    if (memberIds.has(mt.member) && (mt.guest_level ?? 0) === 0) teams.add(mt.team)
  }
  return teams
}

function scoreTeam(
  teamId: string,
  teamName: string,
  game: Game,
  teamGameDates: Map<string, Set<string>>,
  trainingDates: Set<string>,
  adjacentTeams: Set<string>,
  otr1Teams: Set<string>,
  fullCrewTeams: Set<string>,
  assignmentCounts: Map<string, number>,
  dayAssignments: Map<string, Set<string>>,
): BbTeamScore {
  const reasons: ConflictEntry[] = []
  let score = 100
  let disqualified = false

  // === HARD RULES ===

  // 1. Team has a game on this day → DISQUALIFY
  if ((teamGameDates.get(game.date) ?? new Set()).has(teamId)) {
    disqualified = true
    reasons.push({ key: 'reason_gameSameDay' })
  }

  // 2. Already assigned a duty on this day → DISQUALIFY
  if (dayAssignments.get(game.date)?.has(teamId)) {
    disqualified = true
    reasons.push({ key: 'reason_alreadyDuty' })
  }

  // 3. Must be able to field the OTR1 officials (Anschreiber + Zeitnehmer)
  if (!otr1Teams.has(teamId)) {
    disqualified = true
    reasons.push({ key: 'reason_noOtr1' })
  }

  if (disqualified) return { teamId, teamName, score: -Infinity, disqualified, reasons }

  // === SOFT RULES ===

  // Full crew: team also has an OTR2/OTN member, so the same team can also
  // cover the 24s-Operator → keep all officials in one team. +25
  if (fullCrewTeams.has(teamId)) {
    score += 25
    reasons.push({ key: 'reason_fullCrew', params: { points: 25 } })
  }

  // Sequential game bonus: already at the hall before/after. +30
  if (adjacentTeams.has(teamId)) {
    score += 30
    reasons.push({ key: 'reason_sequenceBonus', params: { points: 30 } })
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

  const bbTeams = teams.filter((t) => t.sport === 'basketball' && t.active)

  // OTR1 coverage is the hard requirement; OTR2/OTN coverage (intersected
  // with OTR1, since one team supplies the whole crew) is the soft bonus.
  const otr1Teams = buildLicenceTeams(members, memberTeams, (m) => !!m.otr1_bb)
  // `otn_bb` is the coarse legacy flag kept by migration 228 alongside the two
  // Basketplan levels — OR all three so nobody who qualifies today drops out.
  const fullCrewTeams = buildLicenceTeams(members, memberTeams, (m) => !!(m.otr2_bb || m.otn_bb || m.otn1_bb || m.otn2_bb))
  for (const id of [...fullCrewTeams]) if (!otr1Teams.has(id)) fullCrewTeams.delete(id)

  const teamGameDates = buildTeamGameDates(games)
  const trainingDates = buildTrainingDates(trainings)
  const gamesByDateHall = buildGamesByDateHall(games)

  const homeGames = games
    .filter((g) => g.type === 'home' && g.status !== 'postponed')
    .sort((a, b) => (a.date ?? '').localeCompare(b.date ?? '') || (a.time ?? '').localeCompare(b.time ?? ''))

  const assignmentCounts = new Map<string, number>()
  const dayAssignments = new Map<string, Set<string>>()
  const results: BbGameAssignment[] = []

  for (const game of homeGames) {
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
        t.id, t.name, game,
        teamGameDates, trainingDates, adjacentTeams,
        otr1Teams, fullCrewTeams, assignmentCounts, dayAssignments,
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
