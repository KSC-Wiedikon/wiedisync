import type { Game, Team, Training, Member, MemberTeam } from '../../../types'

// Teams that can score at Döltschi venue
const UNDER_TEAM_NAMES = ['HU20', 'HU23-1', 'DU23-1', 'DU23-2']

// Teams/leagues that use combined mode (scorer/scoreboard = 1 team does both)
// Based on sheet: Döltschi games, Legends (4L), D3 (5L), D4 (5L) all use combined
const COMBINED_LEAGUES = ['4L', '5L']

// Teams whose HOME games use a referee instead of a Täfeler (scoreboard):
// HU20 home games are staffed scorer + referee. The referee is a duty team
// like the scorer (no licence required).
const REFEREE_HOME_TEAM_NAMES = ['HU20']

// Teams that are OUT of the duty system entirely (Minis / DU20): never assigned
// duty, and hidden from the assign page's team summary + manual dropdowns.
export const EXCLUDED_DUTY_TEAM_NAMES = ['MiniVB', 'DU20']

export interface AssignmentInput {
  games: Game[]
  teams: Team[]
  trainings: Training[]
  // members/memberTeams are no longer consumed (scorer duty needs no licence),
  // kept on the input for a stable call signature.
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
  // 'separate' = scorer + Täfeler; 'combined' = one team does both;
  // 'referee' = scorer + referee (HU20 home games).
  mode: 'separate' | 'combined' | 'referee'
  scorerTeamId: string | null
  scorerTeamName: string | null
  scoreboardTeamId: string | null
  scoreboardTeamName: string | null
  combinedTeamId: string | null
  combinedTeamName: string | null
  refereeTeamId: string | null
  refereeTeamName: string | null
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

/** Build lookup: date string → set of team IDs that have a game */
export function buildTeamGameDates(games: Game[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>()
  for (const g of games) {
    if (!g.date || !g.kscw_team) continue
    if (!map.has(g.date)) map.set(g.date, new Set())
    map.get(g.date)!.add(g.kscw_team)
  }
  return map
}

/** Build lookup: "teamId|date" → true if team has training */
export function buildTrainingDates(trainings: Training[]): Set<string> {
  const set = new Set<string>()
  for (const tr of trainings) {
    if (tr.team && tr.date && !tr.cancelled) {
      set.add(`${tr.team}|${tr.date}`)
    }
  }
  return set
}

/** Build lookup: "date|hallId" → array of home games sorted by time */
export function buildGamesByDateHall(games: Game[]): Map<string, Game[]> {
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
export function getAdjacentTeams(game: Game, gamesByDateHall: Map<string, Game[]>): Set<string> {
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
  role: 'scorer' | 'scoreboard' | 'combined' | 'referee',
  hallName: string,
  teamGameDates: Map<string, Set<string>>,
  trainingDates: Set<string>,
  adjacentTeams: Set<string>,
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

  // (No licence requirement — scorer / Täfeler / referee need no licence.)

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
  const gameDay = new Date(game.date + 'T00:00:00').getDay()
  if ((gameDay === 0 || gameDay === 6) && !trainingDates.has(`${teamId}|${game.date}`)) {
    score += 5
    reasons.push({ key: 'reason_weekendFree', params: { points: 5 } })
  }

  return { teamId, teamName, score, disqualified, reasons }
}

/** Track an assignment in running counters */
export function trackAssignment(
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
  const { games, teams, trainings, halls } = input

  const vbTeams = teams.filter((t) => t.sport === 'volleyball' && t.active)
  // Candidate duty providers: exclude Minis / DU20 (they never cover duties).
  const candidateTeams = vbTeams.filter((t) => !EXCLUDED_DUTY_TEAM_NAMES.includes(t.name))

  // Build lookups
  const hallNameById = new Map<string, string>()
  for (const h of halls) hallNameById.set(h.id, h.name)

  const underTeamIds = new Set<string>()
  for (const t of vbTeams) {
    if (UNDER_TEAM_NAMES.includes(t.name)) underTeamIds.add(t.id)
  }

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

  const blank = (gameId: string, mode: GameAssignment['mode']): GameAssignment => ({
    gameId, mode,
    scorerTeamId: null, scorerTeamName: null,
    scoreboardTeamId: null, scoreboardTeamName: null,
    combinedTeamId: null, combinedTeamName: null,
    refereeTeamId: null, refereeTeamName: null,
    scorerScore: 0, scoreboardScore: 0, conflicts: [],
  })

  // Pick the best available candidate team for a role, excluding `excludeIds`.
  const pickBest = (game: Game, role: 'scorer' | 'scoreboard' | 'combined' | 'referee', hallName: string, adjacentTeams: Set<string>, excludeIds: (string | null)[]): TeamScore | null => {
    const scores = candidateTeams
      .filter((t) => !excludeIds.includes(t.id))
      .map((t) => scoreTeam(
        t.id, t.name, game, role, hallName,
        teamGameDates, trainingDates, adjacentTeams,
        underTeamIds, assignmentCounts, dayAssignments,
      ))
      .filter((s) => !s.disqualified)
      .sort((a, b) => b.score - a.score)
    return scores[0] ?? null
  }

  for (const game of homeGames) {
    const hallName = hallNameById.get(game.hall) ?? ''
    const adjacentTeams = getAdjacentTeams(game, gamesByDateHall)
    const playingTeamId = game.kscw_team
    const playingTeamName = vbTeams.find((t) => t.id === playingTeamId)?.name ?? ''
    const isRefereeGame = REFEREE_HOME_TEAM_NAMES.includes(playingTeamName)
    // HU20 games are scorer + referee (never combined).
    const useCombined = !isRefereeGame && shouldUseCombined(game, hallName)

    // Skip games that already have assignments (keep them, still count for fairness)
    const alreadyHasSeparate = !!(game.scorer_duty_team || game.scoreboard_duty_team)
    const alreadyHasCombined = !!game.scorer_scoreboard_duty_team
    const alreadyHasReferee = !!game.referee_duty_team

    if (alreadyHasSeparate || alreadyHasCombined || alreadyHasReferee) {
      const nameOf = (id: string) => vbTeams.find((t) => t.id === id)?.name ?? null
      for (const id of [game.scorer_duty_team, game.scoreboard_duty_team, game.scorer_scoreboard_duty_team, game.referee_duty_team]) {
        if (id) trackAssignment(id, game.date, assignmentCounts, dayAssignments)
      }
      const mode: GameAssignment['mode'] = alreadyHasReferee ? 'referee' : alreadyHasCombined ? 'combined' : 'separate'
      const a = blank(game.id, mode)
      a.scorerTeamId = game.scorer_duty_team || null
      a.scorerTeamName = game.scorer_duty_team ? nameOf(game.scorer_duty_team) : null
      a.scoreboardTeamId = game.scoreboard_duty_team || null
      a.scoreboardTeamName = game.scoreboard_duty_team ? nameOf(game.scoreboard_duty_team) : null
      a.combinedTeamId = game.scorer_scoreboard_duty_team || null
      a.combinedTeamName = game.scorer_scoreboard_duty_team ? nameOf(game.scorer_scoreboard_duty_team) : null
      a.refereeTeamId = game.referee_duty_team || null
      a.refereeTeamName = game.referee_duty_team ? nameOf(game.referee_duty_team) : null
      a.conflicts.push({ key: 'existingKept' })
      results.push(a)
      continue
    }

    if (isRefereeGame) {
      // === REFEREE MODE (HU20): scorer + referee ===
      const a = blank(game.id, 'referee')
      const scorer = pickBest(game, 'scorer', hallName, adjacentTeams, [playingTeamId])
      if (scorer) {
        a.scorerTeamId = scorer.teamId; a.scorerTeamName = scorer.teamName; a.scorerScore = scorer.score
        for (const r of scorer.reasons) a.conflicts.push({ ...r, params: { ...r.params, team: scorer.teamName, role: 'scorer' } })
        trackAssignment(scorer.teamId, game.date, assignmentCounts, dayAssignments)
      } else a.conflicts.push({ key: 'noScorerAvailable' })

      const referee = pickBest(game, 'referee', hallName, adjacentTeams, [playingTeamId, a.scorerTeamId])
      if (referee) {
        a.refereeTeamId = referee.teamId; a.refereeTeamName = referee.teamName; a.scoreboardScore = referee.score
        for (const r of referee.reasons) a.conflicts.push({ ...r, params: { ...r.params, team: referee.teamName, role: 'referee' } })
        trackAssignment(referee.teamId, game.date, assignmentCounts, dayAssignments)
      } else a.conflicts.push({ key: 'noRefereeAvailable' })

      results.push(a)
    } else if (useCombined) {
      // === COMBINED MODE ===
      const a = blank(game.id, 'combined')
      const best = pickBest(game, 'combined', hallName, adjacentTeams, [playingTeamId])
      if (best) {
        a.combinedTeamId = best.teamId; a.combinedTeamName = best.teamName; a.scorerScore = best.score
        for (const r of best.reasons) a.conflicts.push({ ...r, params: { ...r.params, team: best.teamName } })
        trackAssignment(best.teamId, game.date, assignmentCounts, dayAssignments)
      } else a.conflicts.push({ key: 'noTeamAvailable' })
      results.push(a)
    } else {
      // === SEPARATE MODE: scorer + Täfeler ===
      const a = blank(game.id, 'separate')
      const scorer = pickBest(game, 'scorer', hallName, adjacentTeams, [playingTeamId])
      if (scorer) {
        a.scorerTeamId = scorer.teamId; a.scorerTeamName = scorer.teamName; a.scorerScore = scorer.score
        for (const r of scorer.reasons) a.conflicts.push({ ...r, params: { ...r.params, team: scorer.teamName, role: 'scorer' } })
        trackAssignment(scorer.teamId, game.date, assignmentCounts, dayAssignments)
      } else a.conflicts.push({ key: 'noScorerAvailable' })

      const scoreboard = pickBest(game, 'scoreboard', hallName, adjacentTeams, [playingTeamId, a.scorerTeamId])
      if (scoreboard) {
        a.scoreboardTeamId = scoreboard.teamId; a.scoreboardTeamName = scoreboard.teamName; a.scoreboardScore = scoreboard.score
        for (const r of scoreboard.reasons) a.conflicts.push({ ...r, params: { ...r.params, team: scoreboard.teamName, role: 'scoreboard' } })
        trackAssignment(scoreboard.teamId, game.date, assignmentCounts, dayAssignments)
      } else a.conflicts.push({ key: 'noTaefelerAvailable' })

      results.push(a)
    }
  }

  return results
}

export interface TeamCountRow {
  scorer: number
  scoreboard: number
  combined: number
  referee: number
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
    if (t.sport === 'volleyball' && t.active && !EXCLUDED_DUTY_TEAM_NAMES.includes(t.name)) {
      const ownGames = allGames.filter((g) => String(g.kscw_team) === t.id).length
      counts.set(t.name, { scorer: 0, scoreboard: 0, combined: 0, referee: 0, totalDuties: 0, ownGames })
    }
  }

  const bump = (name: string | null, key: 'scorer' | 'scoreboard' | 'combined' | 'referee') => {
    if (name && counts.has(name)) {
      const row = counts.get(name)!
      row[key]++
      row.totalDuties++
    }
  }

  for (const r of results) {
    bump(r.scorerTeamName, 'scorer')
    bump(r.scoreboardTeamName, 'scoreboard')
    bump(r.combinedTeamName, 'combined')
    bump(r.refereeTeamName, 'referee')
  }

  return counts
}
