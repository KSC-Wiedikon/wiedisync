import type { Game, Team, Training, Member, MemberTeam } from '../../../types'

// Teams that can score at Döltschi venue
const UNDER_TEAM_NAMES = ['HU20', 'HU23-1', 'DU23-1', 'DU23-2']

// Teams/leagues that use combined mode (scorer/scoreboard = 1 team does both)
// Based on sheet: Döltschi games, Legends (4L), D3 (5L), D4 (5L) all use combined
const COMBINED_LEAGUES = ['4L', '5L']

export interface AssignmentInput {
  games: Game[]
  teams: Team[]
  trainings: Training[]
  members: Member[]
  memberTeams: MemberTeam[]
  halls: { id: string; name: string }[]
}

export interface ConflictEntry {
  key: string
  params?: Record<string, string | number>
}

export interface GameAssignment {
  gameId: string
  mode: 'separate' | 'combined'
  scorerTeamId: string | null
  scorerTeamName: string | null
  scoreboardTeamId: string | null
  scoreboardTeamName: string | null
  combinedTeamId: string | null
  combinedTeamName: string | null
  scorerScore: number
  scoreboardScore: number
  conflicts: ConflictEntry[]
}

interface TeamScore {
  teamId: string
  teamName: string
  score: number
  disqualified: boolean
  reasons: ConflictEntry[]
}

/** Check if a hall name matches Döltschi */
function isDoltschi(hallName: string): boolean {
  const n = hallName.toLowerCase()
  return n.includes('döltschi') || n.includes('doltschi')
}

/** Determine if a game should use combined mode based on sheet patterns */
function shouldUseCombined(game: Game, hallName: string): boolean {
  // Döltschi games always combined
  if (isDoltschi(hallName)) return true
  // Lower leagues (4L, 5L) use combined
  if (game.league) {
    const league = game.league.trim()
    if (COMBINED_LEAGUES.some((l) => league.includes(l))) return true
  }
  return false
}

/** Build a set of team IDs that have scorer-licenced members */
function buildScorerTeams(members: Member[], memberTeams: MemberTeam[]): Set<string> {
  const scorerMemberIds = new Set<string>()
  for (const m of members) {
    if (m.scorer_vb) {
      scorerMemberIds.add(m.id)
    }
  }
  const teams = new Set<string>()
  for (const mt of memberTeams) {
    if (scorerMemberIds.has(mt.member) && (mt.guest_level ?? 0) === 0) {
      teams.add(mt.team)
    }
  }
  return teams
}

/** Build lookup: date string → set of team IDs that have a game */
function buildTeamGameDates(games: Game[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>()
  for (const g of games) {
    if (!g.date || !g.kscw_team) continue
    if (!map.has(g.date)) map.set(g.date, new Set())
    map.get(g.date)!.add(g.kscw_team)
  }
  return map
}

/** Build lookup: "teamId|date" → true if team has training */
function buildTrainingDates(trainings: Training[]): Set<string> {
  const set = new Set<string>()
  for (const tr of trainings) {
    if (tr.team && tr.date && !tr.cancelled) {
      set.add(`${tr.team}|${tr.date}`)
    }
  }
  return set
}

/** Build lookup: "date|hallId" → array of home games sorted by time */
function buildGamesByDateHall(games: Game[]): Map<string, Game[]> {
  const map = new Map<string, Game[]>()
  for (const g of games) {
    if (!g.date || !g.hall || g.type !== 'home') continue
    const key = `${g.date}|${g.hall}`
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(g)
  }
  for (const arr of map.values()) {
    arr.sort((a, b) => (a.time ?? '').localeCompare(b.time ?? ''))
  }
  return map
}

/** Get teams that play immediately before/after this game at the same hall */
function getAdjacentTeams(game: Game, gamesByDateHall: Map<string, Game[]>): Set<string> {
  const adjacent = new Set<string>()
  if (!game.date || !game.hall) return adjacent

  const key = `${game.date}|${game.hall}`
  const gamesAtHall = gamesByDateHall.get(key)
  if (!gamesAtHall || gamesAtHall.length <= 1) return adjacent

  const idx = gamesAtHall.findIndex((g) => g.id === game.id)
  if (idx === -1) return adjacent

  if (idx > 0 && gamesAtHall[idx - 1].kscw_team) {
    adjacent.add(gamesAtHall[idx - 1].kscw_team)
  }
  if (idx < gamesAtHall.length - 1 && gamesAtHall[idx + 1].kscw_team) {
    adjacent.add(gamesAtHall[idx + 1].kscw_team)
  }
  return adjacent
}

/** Score a candidate team for a specific game and role */
function scoreTeam(
  teamId: string,
  teamName: string,
  game: Game,
  role: 'scorer' | 'scoreboard' | 'combined',
  hallName: string,
  teamGameDates: Map<string, Set<string>>,
  trainingDates: Set<string>,
  adjacentTeams: Set<string>,
  scorerTeams: Set<string>,
  underTeamIds: Set<string>,
  assignmentCounts: Map<string, number>,
  dayAssignments: Map<string, Set<string>>,
): TeamScore {
  const reasons: ConflictEntry[] = []
  let score = 100
  let disqualified = false

  // === HARD RULES ===

  // 1. Team has a game on this day → DISQUALIFY
  const teamsPlayingToday = teamGameDates.get(game.date) ?? new Set()
  if (teamsPlayingToday.has(teamId)) {
    disqualified = true
    reasons.push({ key: 'reason_gameSameDay' })
  }

  // 2. Döltschi venue → only Under teams allowed
  if (isDoltschi(hallName) && !underTeamIds.has(teamId)) {
    disqualified = true
    reasons.push({ key: 'reason_doltschiUnderOnly' })
  }

  // 3. Already assigned a duty on this day → DISQUALIFY
  if (dayAssignments.get(game.date)?.has(teamId)) {
    disqualified = true
    reasons.push({ key: 'reason_alreadyDuty' })
  }

  // 4. Scorer/combined role requires licence
  if ((role === 'scorer' || role === 'combined') && !scorerTeams.has(teamId)) {
    disqualified = true
    reasons.push({ key: 'reason_noLicence' })
  }

  if (disqualified) return { teamId, teamName, score: -Infinity, disqualified, reasons }

  // === SOFT RULES ===

  // Training conflict: -20
  if (trainingDates.has(`${teamId}|${game.date}`)) {
    score -= 20
    reasons.push({ key: 'reason_training', params: { points: -20 } })
  }

  // Sequential game bonus: +30
  if (adjacentTeams.has(teamId)) {
    score += 30
    reasons.push({ key: 'reason_sequenceBonus', params: { points: 30 } })
  }

  // Fair rotation: -10 per existing assignment
  const count = assignmentCounts.get(teamId) ?? 0
  if (count > 0) {
    const penalty = 10 * count
    score -= penalty
    reasons.push({ key: 'reason_rotation', params: { count, points: -penalty } })
  }

  // HU20 scoreboard preference: +15
  if (role === 'scoreboard' && teamName === 'HU20') {
    score += 15
    reasons.push({ key: 'reason_hu20Taefeler', params: { points: 15 } })
  }

  // Under teams preferred for combined mode at Döltschi: +10
  if (role === 'combined' && isDoltschi(hallName) && underTeamIds.has(teamId)) {
    score += 10
    reasons.push({ key: 'reason_underDoltschi', params: { points: 10 } })
  }

  // Legends bonus for scorer role: +8
  if (role === 'scorer' && teamName === 'Legends') {
    score += 8
    reasons.push({ key: 'reason_legendsScorer', params: { points: 8 } })
  }

  // Weekend no-training bonus: +5
  const gameDay = new Date(game.date).getDay()
  if ((gameDay === 0 || gameDay === 6) && !trainingDates.has(`${teamId}|${game.date}`)) {
    score += 5
    reasons.push({ key: 'reason_weekendFree', params: { points: 5 } })
  }

  return { teamId, teamName, score, disqualified, reasons }
}

/** Track an assignment in running counters */
function trackAssignment(
  teamId: string,
  date: string,
  assignmentCounts: Map<string, number>,
  dayAssignments: Map<string, Set<string>>,
) {
  assignmentCounts.set(teamId, (assignmentCounts.get(teamId) ?? 0) + 1)
  if (!dayAssignments.has(date)) dayAssignments.set(date, new Set())
  dayAssignments.get(date)!.add(teamId)
}

export function runAssignment(input: AssignmentInput): GameAssignment[] {
  const { games, teams, trainings, members, memberTeams, halls } = input

  const vbTeams = teams.filter((t) => t.sport === 'volleyball' && t.active)

  // Build lookups
  const hallNameById = new Map<string, string>()
  for (const h of halls) hallNameById.set(h.id, h.name)

  const underTeamIds = new Set<string>()
  for (const t of vbTeams) {
    if (UNDER_TEAM_NAMES.includes(t.name)) underTeamIds.add(t.id)
  }

  const scorerTeams = buildScorerTeams(members, memberTeams)
  const teamGameDates = buildTeamGameDates(games)
  const trainingDates = buildTrainingDates(trainings)
  const gamesByDateHall = buildGamesByDateHall(games)

  // Home games to assign, sorted by date+time
  const homeGames = games
    .filter((g) => g.type === 'home' && g.status !== 'postponed')
    .sort((a, b) => (a.date ?? '').localeCompare(b.date ?? '') || (a.time ?? '').localeCompare(b.time ?? ''))

  // Running counters
  const assignmentCounts = new Map<string, number>()
  const dayAssignments = new Map<string, Set<string>>()

  const results: GameAssignment[] = []

  for (const game of homeGames) {
    const hallName = hallNameById.get(game.hall) ?? ''
    const adjacentTeams = getAdjacentTeams(game, gamesByDateHall)
    const useCombined = shouldUseCombined(game, hallName)

    // Skip games that already have assignments
    const alreadyHasSeparate = !!(game.scorer_duty_team || game.scoreboard_duty_team)
    const alreadyHasCombined = !!game.scorer_scoreboard_duty_team

    if (alreadyHasSeparate || alreadyHasCombined) {
      if (game.scorer_duty_team) trackAssignment(game.scorer_duty_team, game.date, assignmentCounts, dayAssignments)
      if (game.scoreboard_duty_team) trackAssignment(game.scoreboard_duty_team, game.date, assignmentCounts, dayAssignments)
      if (game.scorer_scoreboard_duty_team) trackAssignment(game.scorer_scoreboard_duty_team, game.date, assignmentCounts, dayAssignments)

      results.push({
        gameId: game.id,
        mode: alreadyHasCombined ? 'combined' : 'separate',
        scorerTeamId: game.scorer_duty_team || null,
        scorerTeamName: game.scorer_duty_team ? vbTeams.find((t) => t.id === game.scorer_duty_team)?.name ?? null : null,
        scoreboardTeamId: game.scoreboard_duty_team || null,
        scoreboardTeamName: game.scoreboard_duty_team ? vbTeams.find((t) => t.id === game.scoreboard_duty_team)?.name ?? null : null,
        combinedTeamId: game.scorer_scoreboard_duty_team || null,
        combinedTeamName: game.scorer_scoreboard_duty_team ? vbTeams.find((t) => t.id === game.scorer_scoreboard_duty_team)?.name ?? null : null,
        scorerScore: 0,
        scoreboardScore: 0,
        conflicts: [{ key: 'existingKept' }],
      })
      continue
    }

    const playingTeamId = game.kscw_team

    if (useCombined) {
      // === COMBINED MODE ===
      const assignment: GameAssignment = {
        gameId: game.id, mode: 'combined',
        scorerTeamId: null, scorerTeamName: null,
        scoreboardTeamId: null, scoreboardTeamName: null,
        combinedTeamId: null, combinedTeamName: null,
        scorerScore: 0, scoreboardScore: 0, conflicts: [],
      }

      const scores = vbTeams
        .filter((t) => t.id !== playingTeamId)
        .map((t) => scoreTeam(
          t.id, t.name, game, 'combined', hallName,
          teamGameDates, trainingDates, adjacentTeams,
          scorerTeams, underTeamIds, assignmentCounts, dayAssignments,
        ))
        .filter((s) => !s.disqualified)
        .sort((a, b) => b.score - a.score)

      if (scores.length > 0) {
        const best = scores[0]
        assignment.combinedTeamId = best.teamId
        assignment.combinedTeamName = best.teamName
        assignment.scorerScore = best.score
        for (const r of best.reasons) {
          assignment.conflicts.push({ ...r, params: { ...r.params, team: best.teamName } })
        }
        trackAssignment(best.teamId, game.date, assignmentCounts, dayAssignments)
      } else {
        assignment.conflicts.push({ key: 'noTeamAvailable' })
      }

      results.push(assignment)
    } else {
      // === SEPARATE MODE ===
      const assignment: GameAssignment = {
        gameId: game.id, mode: 'separate',
        scorerTeamId: null, scorerTeamName: null,
        scoreboardTeamId: null, scoreboardTeamName: null,
        combinedTeamId: null, combinedTeamName: null,
        scorerScore: 0, scoreboardScore: 0, conflicts: [],
      }

      // Score all teams for SCORER
      const scorerScores = vbTeams
        .filter((t) => t.id !== playingTeamId)
        .map((t) => scoreTeam(
          t.id, t.name, game, 'scorer', hallName,
          teamGameDates, trainingDates, adjacentTeams,
          scorerTeams, underTeamIds, assignmentCounts, dayAssignments,
        ))
        .filter((s) => !s.disqualified)
        .sort((a, b) => b.score - a.score)

      if (scorerScores.length > 0) {
        const best = scorerScores[0]
        assignment.scorerTeamId = best.teamId
        assignment.scorerTeamName = best.teamName
        assignment.scorerScore = best.score
        for (const r of best.reasons) {
          assignment.conflicts.push({ ...r, params: { ...r.params, team: best.teamName, role: 'scorer' } })
        }
        trackAssignment(best.teamId, game.date, assignmentCounts, dayAssignments)
      } else {
        assignment.conflicts.push({ key: 'noScorerAvailable' })
      }

      // Score all teams for SCOREBOARD (exclude scorer team)
      const scoreboardScores = vbTeams
        .filter((t) => t.id !== playingTeamId && t.id !== assignment.scorerTeamId)
        .map((t) => scoreTeam(
          t.id, t.name, game, 'scoreboard', hallName,
          teamGameDates, trainingDates, adjacentTeams,
          scorerTeams, underTeamIds, assignmentCounts, dayAssignments,
        ))
        .filter((s) => !s.disqualified)
        .sort((a, b) => b.score - a.score)

      if (scoreboardScores.length > 0) {
        const best = scoreboardScores[0]
        assignment.scoreboardTeamId = best.teamId
        assignment.scoreboardTeamName = best.teamName
        assignment.scoreboardScore = best.score
        for (const r of best.reasons) {
          assignment.conflicts.push({ ...r, params: { ...r.params, team: best.teamName, role: 'scoreboard' } })
        }
        trackAssignment(best.teamId, game.date, assignmentCounts, dayAssignments)
      } else {
        assignment.conflicts.push({ key: 'noTaefelerAvailable' })
      }

      results.push(assignment)
    }
  }

  return results
}

export interface TeamCountRow {
  scorer: number
  scoreboard: number
  combined: number
  totalDuties: number
  ownGames: number
}

/** Get per-team summary: assignment counts + own game count */
export function getTeamCounts(
  results: GameAssignment[],
  allTeams: Team[],
  allGames: Game[],
): Map<string, TeamCountRow> {
  const counts = new Map<string, TeamCountRow>()

  for (const t of allTeams) {
    if (t.sport === 'volleyball' && t.active) {
      const ownGames = allGames.filter((g) => String(g.kscw_team) === t.id).length
      counts.set(t.name, { scorer: 0, scoreboard: 0, combined: 0, totalDuties: 0, ownGames })
    }
  }

  for (const r of results) {
    if (r.scorerTeamName && counts.has(r.scorerTeamName)) {
      counts.get(r.scorerTeamName)!.scorer++
      counts.get(r.scorerTeamName)!.totalDuties++
    }
    if (r.scoreboardTeamName && counts.has(r.scoreboardTeamName)) {
      counts.get(r.scoreboardTeamName)!.scoreboard++
      counts.get(r.scoreboardTeamName)!.totalDuties++
    }
    if (r.combinedTeamName && counts.has(r.combinedTeamName)) {
      counts.get(r.combinedTeamName)!.combined++
      counts.get(r.combinedTeamName)!.totalDuties++
    }
  }

  return counts
}
