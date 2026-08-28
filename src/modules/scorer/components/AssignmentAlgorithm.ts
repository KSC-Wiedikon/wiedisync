import type { Game, Team, Training, Member, MemberTeam } from '../../../types'

// Teams that are OUT of the duty system entirely (Minis / DU20): never assigned
// duty, and hidden from the assign page's team summary + manual dropdowns.
export const EXCLUDED_DUTY_TEAM_NAMES = ['MiniVB', 'DU20']

// Cup games (Züri Cup + Swiss/Mobiliar Volley Cup) are NOT assigned to a duty
// team — they surface as read-only "on call" (Pikett) slots: nobody is summoned,
// officials are on standby. They show up as free slots in the plan, assigned to
// nobody. A bare /cup/ match catches every variant ("Züri Cup", "Mobiliar Volley
// Cup", "Swiss Volley Cup", "Schweizer Cup", "Zürcher …-Cup"); no regular league
// string contains "cup". (Note: detectCupMatch() only knows the two canonical
// names for chip colour — this is the wider net used to gate duty.)
export function isCupGame(league: string | null | undefined): boolean {
  return /\bcup\b|pokal|coupe|coppa/i.test(league ?? '')
}

// Duty type per PLAYING team:
//   referee  → HU20            (referee only, no licence)
//   combined → 4L / 5L (any gender) and DU23  (one team does scorer + Täfeler, no licence)
//   separate → 3L and up (2L, 1L, …) and HU23 (scorer NEEDS a licence + Täfeler)
export function classifyVbMode(teamName: string, league: string): 'referee' | 'combined' | 'separate' {
  if (teamName.startsWith('HU20')) return 'referee'
  if (teamName.startsWith('DU23')) return 'combined'
  if (teamName.startsWith('HU23')) return 'separate'
  const m = /^(\d+)L/.exec((league ?? '').trim()) // teams.league is '2L', '4L', …
  if (m) return Number(m[1]) >= 4 ? 'combined' : 'separate'
  return 'separate'
}

export interface AssignmentInput {
  games: Game[]
  teams: Team[]
  trainings: Training[]
  members: Member[]        // for scorer-licence teams (separate-mode scorer)
  memberTeams: MemberTeam[]
  halls: { id: string; name: string }[] // kept for a stable call signature
}

export interface ConflictEntry {
  key: string
  params?: Record<string, string | number>
}

export interface GameAssignment {
  gameId: string
  // 'separate' = scorer(licence) + Täfeler; 'combined' = one team does both;
  // 'referee' = referee only (HU20); 'cup' = on-call/Pikett slot (free slot,
  // no team assigned).
  mode: 'separate' | 'combined' | 'referee' | 'cup'
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
  // Optional per-role assignee (member id) — set by the admin in scorer-assign's
  // person editor and written on roll-out. `undefined` = untouched (fall back to
  // the game's current member); a string / null = explicitly set / cleared.
  scorerMemberId?: string | null
  scoreboardMemberId?: string | null
  combinedMemberId?: string | null
  refereeMemberId?: string | null
  conflicts: ConflictEntry[]
}

interface TeamScore {
  teamId: string
  teamName: string
  score: number
  disqualified: boolean
  reasons: ConflictEntry[]
}

/** Build lookup: date string → set of team IDs that have a game (used by BB). */
export function buildTeamGameDates(games: Game[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>()
  for (const g of games) {
    if (!g.date || !g.kscw_team) continue
    if (!map.has(g.date)) map.set(g.date, new Set())
    map.get(g.date)!.add(g.kscw_team)
  }
  return map
}

/** Minutes-of-day for a "HH:MM"(:SS) time string, or null if unparseable. */
export function timeToMin(time: string | null | undefined): number | null {
  if (!time) return null
  const m = /^(\d{1,2}):(\d{2})/.exec(time)
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}

/** Build lookup: "teamId|date" → array of the team's game start-times (minutes). */
export function buildTeamGameTimes(games: Game[]): Map<string, number[]> {
  const map = new Map<string, number[]>()
  for (const g of games) {
    if (!g.date || !g.kscw_team) continue
    const min = timeToMin(g.time)
    if (min == null) continue
    const key = `${g.kscw_team}|${g.date}`
    const arr = map.get(key)
    if (arr) arr.push(min)
    else map.set(key, [min])
  }
  return map
}

// A team can't do duty for a game overlapping its own (±120 min); a non-overlapping
// slot the same day is allowed, and the adjacent slot is rewarded below.
const OVERLAP_MINUTES = 120

/** Build lookup: "teamId|date" → true if team has training */
export function buildTrainingDates(trainings: Training[]): Set<string> {
  const set = new Set<string>()
  for (const tr of trainings) {
    if (tr.team && tr.date && !tr.cancelled) set.add(`${tr.team}|${tr.date}`)
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
  for (const arr of map.values()) arr.sort((a, b) => (a.time ?? '').localeCompare(b.time ?? ''))
  return map
}

/** Get teams that play immediately before/after this game at the same hall */
export function getAdjacentTeams(game: Game, gamesByDateHall: Map<string, Game[]>): Set<string> {
  const adjacent = new Set<string>()
  if (!game.date || !game.hall) return adjacent
  const gamesAtHall = gamesByDateHall.get(`${game.date}|${game.hall}`)
  if (!gamesAtHall || gamesAtHall.length <= 1) return adjacent
  const idx = gamesAtHall.findIndex((g) => g.id === game.id)
  if (idx === -1) return adjacent
  if (idx > 0 && gamesAtHall[idx - 1].kscw_team) adjacent.add(gamesAtHall[idx - 1].kscw_team)
  if (idx < gamesAtHall.length - 1 && gamesAtHall[idx + 1].kscw_team) adjacent.add(gamesAtHall[idx + 1].kscw_team)
  return adjacent
}

/** Team IDs that have a scorer-licenced (scorer_vb) non-guest member. */
function buildScorerTeams(members: Member[], memberTeams: MemberTeam[]): Set<string> {
  const licenced = new Set<string>()
  for (const m of members) if (m.scorer_vb) licenced.add(m.id)
  const teams = new Set<string>()
  for (const mt of memberTeams) {
    if (licenced.has(mt.member) && (mt.guest_level ?? 0) === 0) teams.add(mt.team)
  }
  return teams
}

/**
 * Team IDs → number of non-guest referee-licenced (referee_vb) members.
 * Teams that supply referees to the club already serve it, so they carry fewer
 * scorer duties (each referee licence counts like a duty already done — see the
 * referee-credit penalty in scoreTeam). Requested by Thamy, 2026-07-08.
 */
export function buildRefereeContribution(members: Member[], memberTeams: MemberTeam[]): Map<string, number> {
  const licenced = new Set<string>()
  for (const m of members) if (m.referee_vb) licenced.add(m.id)
  const counts = new Map<string, number>()
  for (const mt of memberTeams) {
    if (licenced.has(mt.member) && (mt.guest_level ?? 0) === 0) {
      counts.set(mt.team, (counts.get(mt.team) ?? 0) + 1)
    }
  }
  return counts
}

/**
 * Build set of "teamId|date" for teams that play a HOME game that day — i.e.
 * they're already on-site at a KSCW hall and coming anyway. Duty should prefer
 * these over teams with a free Saturday ("don't summon a team that isn't
 * playing"). Requested by Thamy, 2026-07-08.
 */
export function buildHomeGameDates(games: Game[]): Set<string> {
  const set = new Set<string>()
  for (const g of games) {
    if (g.type === 'home' && g.date && g.kscw_team) set.add(`${g.kscw_team}|${g.date}`)
  }
  return set
}

// Auto referee credit is capped at this many duties. Thamy asked for ~2 off the
// most referee-heavy team (H3, which has 5 licence holders); an uncapped -10 per
// licence would remove it from duty entirely. The manual per-team credit
// (teams.duty_credit) stacks on top for fine-tuning.
export const MAX_REFEREE_CREDIT = 2

// Per-team role nudges to rebalance duty (Thamy, 2026-07-09): move scorer duties
// OFF Legends — which backfills with the no-licence täfeler/combined duties —
// onto D1 and HU23. The points bias WHICH duty a team is picked for, not how many
// it does (rotation still governs total load), so only the role mix shifts.
//
// Tuned by simulation against the 2025/26 fixtures (85 home games). The result:
// Legends 3→1 scorer (+3 combined "scorer without licence"), and the freed scorer
// slots redistribute NATURALLY — D1 5→6 and HU23 3→4 — landing on Thamy's targets
// (Legends −3/−4 from his baseline, D1 +≈2, HU23 +1/+2) with only the Legends
// nudge. An explicit D1/HU23 scorer bias was tested and DELIBERATELY OMITTED: it
// overshoots (D1 → 8 while starving HU23 → 3, re-concentrating load — the very
// Nadine/Livi overload this rebalance is meant to relieve). For a precise per-team
// count, override the one stray game in the dropdown.
interface RoleBias { scorer?: number; scoreboard?: number; combined?: number }
const TEAM_ROLE_BIAS: Record<string, RoleBias> = {
  Legends: { scorer: -6, scoreboard: 4, combined: 4 },
}
/** Bias lookup key for a team: HU23-1/-2 would collapse to a shared 'HU23' entry. */
function biasKey(teamName: string): string {
  return teamName.startsWith('HU23') ? 'HU23' : teamName
}

/** Score a candidate team for a specific game and role */
function scoreTeam(
  teamId: string,
  teamName: string,
  game: Game,
  role: 'scorer' | 'scoreboard' | 'combined' | 'referee',
  teamGameTimes: Map<string, number[]>,
  trainingDates: Set<string>,
  adjacentTeams: Set<string>,
  homeGameDates: Set<string>,
  scorerTeams: Set<string>,
  refereeContribution: Map<string, number>,
  dutyCredits: Map<string, number>,
  assignmentCounts: Map<string, number>,
  dayAssignments: Map<string, Set<string>>,
): TeamScore {
  const reasons: ConflictEntry[] = []
  let score = 100
  let disqualified = false

  // === HARD RULES ===

  // 1. Team plays a game that OVERLAPS this one → DISQUALIFY (can't be in two
  //    places). A non-overlapping slot the same day is fine (adjacency rewarded
  //    below). Unknown time → fall back to same-day exclusion.
  const dutyMin = timeToMin(game.time)
  const ownGameMins = teamGameTimes.get(`${teamId}|${game.date}`) ?? []
  const overlaps = dutyMin == null
    ? ownGameMins.length > 0
    : ownGameMins.some((m) => Math.abs(m - dutyMin) < OVERLAP_MINUTES)
  if (overlaps) {
    disqualified = true
    reasons.push({ key: 'reason_gameSameDay' }) // never rendered (candidate filtered out)
  }

  // 2. Already assigned a duty on this day → DISQUALIFY
  if (dayAssignments.get(game.date)?.has(teamId)) {
    disqualified = true
    reasons.push({ key: 'reason_alreadyDuty' })
  }

  // 3. Separate-mode SCORER (3L and up / HU23) needs a scorer licence.
  //    Täfeler, combined and referee need none.
  if (role === 'scorer' && !scorerTeams.has(teamId)) {
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

  // On-site preference: a team that's already at the hall that day is preferred
  // over one with a free Saturday ("don't summon a team that isn't playing" —
  // Thamy). Plays right before/after at this hall → strongest (+50); otherwise
  // has any home game the same day → still on-site (+20).
  if (adjacentTeams.has(teamId)) {
    score += 50
    reasons.push({ key: 'reason_sequenceBonus', params: { points: 50 } })
  } else if (homeGameDates.has(`${teamId}|${game.date}`)) {
    score += 20
    reasons.push({ key: 'reason_onSite', params: { points: 20 } })
  }

  // Fair rotation: -10 per existing assignment
  const count = assignmentCounts.get(teamId) ?? 0
  if (count > 0) {
    const penalty = 10 * count
    score -= penalty
    reasons.push({ key: 'reason_rotation', params: { count, points: -penalty } })
  }

  // Referee credit: teams that supply referees to the club already serve it, so
  // they carry fewer scorer duties (each referee licence counts like a duty
  // already done, capped). -10 per credited referee.
  const refCredit = Math.min(refereeContribution.get(teamId) ?? 0, MAX_REFEREE_CREDIT)
  if (refCredit > 0) {
    const penalty = 10 * refCredit
    score -= penalty
    reasons.push({ key: 'reason_refereeCredit', params: { count: refCredit, points: -penalty } })
  }

  // Manual credit (teams.duty_credit): admin-set duties this team is excused
  // from. Stacks on top of the referee credit. -10 per credit.
  const manualCredit = dutyCredits.get(teamId) ?? 0
  if (manualCredit !== 0) {
    const penalty = 10 * manualCredit
    score -= penalty
    reasons.push({ key: 'reason_manualCredit', params: { count: manualCredit, points: -penalty } })
  }

  // HU20 scoreboard preference: +15
  if (role === 'scoreboard' && teamName === 'HU20') {
    score += 15
    reasons.push({ key: 'reason_hu20Taefeler', params: { points: 15 } })
  }

  // Team role nudges (Thamy rebalance): steer WHICH duty a team gets. Legends is
  // pushed off scorer toward täfeler/combined; D1 and HU23 are pulled toward
  // scorer to absorb the freed slots. Referee role is never nudged.
  if (role === 'scorer' || role === 'scoreboard' || role === 'combined') {
    const bias = TEAM_ROLE_BIAS[biasKey(teamName)]?.[role] ?? 0
    if (bias) {
      score += bias
      reasons.push({ key: 'reason_teamRoleBias', params: { team: teamName, points: bias } })
    }
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
  const { games, teams, trainings, members, memberTeams } = input

  const vbTeams = teams.filter((t) => t.sport === 'volleyball' && t.active)
  // Candidate duty providers: exclude Minis / DU20 (they never cover duties).
  const candidateTeams = vbTeams.filter((t) => !EXCLUDED_DUTY_TEAM_NAMES.includes(t.name))

  const scorerTeams = buildScorerTeams(members, memberTeams)
  const refereeContribution = buildRefereeContribution(members, memberTeams)
  const dutyCredits = new Map<string, number>()
  for (const t of vbTeams) if (t.duty_credit) dutyCredits.set(t.id, t.duty_credit)
  const teamGameTimes = buildTeamGameTimes(games)
  const trainingDates = buildTrainingDates(trainings)
  const homeGameDates = buildHomeGameDates(games)
  const gamesByDateHall = buildGamesByDateHall(games)

  const homeGames = games
    .filter((g) => g.type === 'home' && g.status !== 'postponed')
    .sort((a, b) => (a.date ?? '').localeCompare(b.date ?? '') || (a.time ?? '').localeCompare(b.time ?? ''))

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

  const pickBest = (game: Game, role: 'scorer' | 'scoreboard' | 'combined' | 'referee', adjacentTeams: Set<string>, excludeIds: (string | null)[]): TeamScore | null => {
    const scores = candidateTeams
      .filter((t) => !excludeIds.includes(t.id))
      .map((t) => scoreTeam(
        t.id, t.name, game, role,
        teamGameTimes, trainingDates, adjacentTeams, homeGameDates,
        scorerTeams, refereeContribution, dutyCredits,
        assignmentCounts, dayAssignments,
      ))
      .filter((s) => !s.disqualified)
      .sort((a, b) => b.score - a.score)
    return scores[0] ?? null
  }

  for (const game of homeGames) {
    // Skip games that already have assignments (keep them, still count for fairness).
    // ⚠ This runs BEFORE the cup rule on purpose. A cup tie is assignable by hand,
    // and once a planner has put a team on one, a recompute must keep it — reversing
    // these two blanks that decision back to "on call" every time the plan is re-run.
    const alreadyHasSeparate = !!(game.scorer_duty_team || game.scoreboard_duty_team)
    const alreadyHasCombined = !!game.scorer_scoreboard_duty_team
    const alreadyHasReferee = !!game.referee_duty_team

    if (alreadyHasSeparate || alreadyHasCombined || alreadyHasReferee) {
      const nameOf = (id: string) => vbTeams.find((t) => t.id === id)?.name ?? null
      for (const id of [game.scorer_duty_team, game.scoreboard_duty_team, game.scorer_scoreboard_duty_team, game.referee_duty_team]) {
        if (id) trackAssignment(id, game.date, assignmentCounts, dayAssignments)
      }
      const existingMode: GameAssignment['mode'] = alreadyHasReferee ? 'referee' : alreadyHasCombined ? 'combined' : 'separate'
      const a = blank(game.id, existingMode)
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

    // Cup game → on-call/Pikett free slot: no team is SUMMONED for cup duty, since
    // a cup home game is the playing team's own desk. This governs the algorithm
    // only — the planner can still assign somebody by hand on the plan row.
    if (isCupGame(game.league)) {
      const a = blank(game.id, 'cup')
      a.conflicts.push({ key: 'cupOnCall' })
      results.push(a)
      continue
    }

    const adjacentTeams = getAdjacentTeams(game, gamesByDateHall)
    const playingTeamId = game.kscw_team
    const playingTeam = vbTeams.find((t) => t.id === playingTeamId)
    const mode = classifyVbMode(playingTeam?.name ?? '', playingTeam?.league ?? '')

    if (mode === 'referee') {
      // === REFEREE ONLY (HU20) ===
      const a = blank(game.id, 'referee')
      const referee = pickBest(game, 'referee', adjacentTeams, [playingTeamId])
      if (referee) {
        a.refereeTeamId = referee.teamId; a.refereeTeamName = referee.teamName; a.scoreboardScore = referee.score
        for (const r of referee.reasons) a.conflicts.push({ ...r, params: { ...r.params, team: referee.teamName, role: 'referee' } })
        trackAssignment(referee.teamId, game.date, assignmentCounts, dayAssignments)
      } else a.conflicts.push({ key: 'noRefereeAvailable' })
      results.push(a)
    } else if (mode === 'combined') {
      // === COMBINED (4L/5L/DU23): one team, no licence ===
      const a = blank(game.id, 'combined')
      const best = pickBest(game, 'combined', adjacentTeams, [playingTeamId])
      if (best) {
        a.combinedTeamId = best.teamId; a.combinedTeamName = best.teamName; a.scorerScore = best.score
        for (const r of best.reasons) a.conflicts.push({ ...r, params: { ...r.params, team: best.teamName } })
        trackAssignment(best.teamId, game.date, assignmentCounts, dayAssignments)
      } else a.conflicts.push({ key: 'noTeamAvailable' })
      results.push(a)
    } else {
      // === SEPARATE (3L+/HU23): scorer(licence) + Täfeler ===
      const a = blank(game.id, 'separate')
      const scorer = pickBest(game, 'scorer', adjacentTeams, [playingTeamId])
      if (scorer) {
        a.scorerTeamId = scorer.teamId; a.scorerTeamName = scorer.teamName; a.scorerScore = scorer.score
        for (const r of scorer.reasons) a.conflicts.push({ ...r, params: { ...r.params, team: scorer.teamName, role: 'scorer' } })
        trackAssignment(scorer.teamId, game.date, assignmentCounts, dayAssignments)
      } else a.conflicts.push({ key: 'noScorerAvailable' })

      const scoreboard = pickBest(game, 'scoreboard', adjacentTeams, [playingTeamId, a.scorerTeamId])
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
  teamId: string
  scorer: number
  scoreboard: number
  combined: number
  referee: number
  totalDuties: number
  ownGames: number
  referees: number      // raw referee_vb licence holders on the team
  refereeCredit: number // capped auto credit actually applied (duties)
  dutyCredit: number    // manual admin credit (teams.duty_credit)
}

/** Get per-team summary: assignment counts + own game count + credit breakdown */
export function getTeamCounts(
  results: GameAssignment[],
  allTeams: Team[],
  allGames: Game[],
  members: Member[] = [],
  memberTeams: MemberTeam[] = [],
): Map<string, TeamCountRow> {
  const counts = new Map<string, TeamCountRow>()
  const refereeContribution = buildRefereeContribution(members, memberTeams)

  for (const t of allTeams) {
    if (t.sport === 'volleyball' && t.active && !EXCLUDED_DUTY_TEAM_NAMES.includes(t.name)) {
      const ownGames = allGames.filter((g) => String(g.kscw_team) === t.id).length
      const referees = refereeContribution.get(t.id) ?? 0
      counts.set(t.name, {
        teamId: t.id, scorer: 0, scoreboard: 0, combined: 0, referee: 0, totalDuties: 0, ownGames,
        referees, refereeCredit: Math.min(referees, MAX_REFEREE_CREDIT), dutyCredit: t.duty_credit ?? 0,
      })
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
