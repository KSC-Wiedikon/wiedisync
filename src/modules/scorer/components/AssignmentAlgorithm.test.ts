import { describe, expect, it } from 'vitest'
import type { Game, Team, Member, MemberTeam } from '../../../types'
import { runAssignment, getTeamCounts, classifyVbMode, type AssignmentInput } from './AssignmentAlgorithm'

// Minimal fixture factories — the algorithm reads name, league, sport, active.
const team = (id: string, name: string, league: string): Team =>
  ({ id, name, league, sport: 'volleyball', active: true } as unknown as Team)

const game = (id: string, kscwTeamId: string, date: string, opts: Partial<Game> = {}): Game =>
  ({ id, kscw_team: kscwTeamId, date, time: '18:00', type: 'home', status: 'scheduled', hall: 'h1', league: '', ...opts } as unknown as Game)

const TEAMS = [
  team('1', 'HU20', 'HU20'),   // referee
  team('2', 'H1', '2L'),       // separate
  team('3', 'H2', '4L'),       // combined
  team('4', 'D1', '2L'),       // separate
  team('5', 'MiniVB', 'MiniVB'), // excluded
  team('6', 'DU20', 'DU20'),   // excluded
  team('7', 'Legends', '4L'),  // combined
  team('9', 'DU23-1', 'U23'),  // combined (name)
  team('10', 'HU23-1', 'U23'), // separate (name)
]

// A licenced scorer on team '3' (H2) so separate-mode scorer can be staffed.
const LIC_MEMBERS = [{ id: 'm1', scorer_vb: true } as unknown as Member]
const LIC_TEAMS = [{ member: 'm1', team: '3', guest_level: 0 } as unknown as MemberTeam]

const base = (games: Game[], members: Member[] = [], memberTeams: MemberTeam[] = []): AssignmentInput => ({
  games, teams: TEAMS, trainings: [], members, memberTeams, halls: [{ id: 'h1', name: 'Sporthalle' }],
})

describe('classifyVbMode', () => {
  it('maps team/league to duty type', () => {
    expect(classifyVbMode('HU20', 'HU20')).toBe('referee')
    expect(classifyVbMode('DU23-1', 'U23')).toBe('combined')
    expect(classifyVbMode('HU23-1', 'U23')).toBe('separate')
    expect(classifyVbMode('H2', '4L')).toBe('combined')
    expect(classifyVbMode('D3', '5L')).toBe('combined')
    expect(classifyVbMode('H1', '2L')).toBe('separate')
    expect(classifyVbMode('D2', '3L')).toBe('separate')
  })
})

describe('runAssignment', () => {
  it('HU20 → referee only (no scorer/scoreboard/combined), no licence needed', () => {
    const [a] = runAssignment(base([game('g1', '1', '2026-09-15')]))
    expect(a.mode).toBe('referee')
    expect(a.refereeTeamId).toBeTruthy()
    expect(a.scorerTeamId).toBeNull()
    expect(a.scoreboardTeamId).toBeNull()
    expect(a.combinedTeamId).toBeNull()
  })

  it('4L → combined, assigned even with no licenced members', () => {
    const [a] = runAssignment(base([game('g1', '3', '2026-09-15')])) // H2 plays (4L)
    expect(a.mode).toBe('combined')
    expect(a.combinedTeamId).toBeTruthy()
    expect(a.scorerTeamId).toBeNull()
  })

  it('DU23 → combined (by team name)', () => {
    const [a] = runAssignment(base([game('g1', '9', '2026-09-15')]))
    expect(a.mode).toBe('combined')
    expect(a.combinedTeamId).toBeTruthy()
  })

  it('separate-mode scorer REQUIRES a licence', () => {
    // H1 (2L) plays → separate. With no licenced team, the scorer is unfilled.
    const none = runAssignment(base([game('g1', '2', '2026-09-15')]))[0]
    expect(none.mode).toBe('separate')
    expect(none.scorerTeamId).toBeNull()
    expect(none.conflicts.some((c) => c.key === 'noScorerAvailable')).toBe(true)
    // With team '3' holding a licenced scorer, it takes the scorer slot.
    const withLic = runAssignment(base([game('g2', '2', '2026-09-15')], LIC_MEMBERS, LIC_TEAMS))[0]
    expect(withLic.scorerTeamId).toBe('3')
    expect(withLic.scoreboardTeamId).toBeTruthy() // Täfeler needs no licence
  })

  it('never assigns MiniVB or DU20 as a duty provider', () => {
    const games = [game('g1', '2', '2026-09-15'), game('g2', '3', '2026-09-22'), game('g3', '4', '2026-09-29')]
    const names = runAssignment(base(games, LIC_MEMBERS, LIC_TEAMS)).flatMap((r) => [r.scorerTeamName, r.scoreboardTeamName, r.combinedTeamName, r.refereeTeamName])
    expect(names).not.toContain('MiniVB')
    expect(names).not.toContain('DU20')
  })

  it('a team can cover a non-overlapping slot the same day; overlapping cannot', () => {
    // Both are 4L (combined, no licence) to isolate the time logic.
    const g1 = game('g1', '3', '2026-09-15', { time: '11:00', hall: 'h1' }) // H2 plays 11:00
    const g2 = game('g2', '7', '2026-09-15', { time: '16:00', hall: 'h1' }) // Legends plays 16:00
    const g2res = runAssignment(base([g1, g2])).find((r) => r.gameId === 'g2')!
    expect(g2res.combinedTeamId).toBe('3') // H2 (played 11:00) covers the 16:00 game
    // Overlap: H2 plays 16:00, can't cover another 16:00 game
    const o1 = game('o1', '3', '2026-09-20', { time: '16:00', hall: 'h1' })
    const o2 = game('o2', '7', '2026-09-20', { time: '16:00', hall: 'h2' })
    const o2res = runAssignment(base([o1, o2])).find((r) => r.gameId === 'o2')!
    expect(o2res.combinedTeamId).not.toBe('3')
  })

  it('team summary omits MiniVB / DU20', () => {
    const results = runAssignment(base([game('g1', '1', '2026-09-15')]))
    const counts = getTeamCounts(results, TEAMS, [game('g1', '1', '2026-09-15')])
    expect(counts.has('MiniVB')).toBe(false)
    expect(counts.has('DU20')).toBe(false)
  })

  it('prefers an on-site team (plays a home game that day) over a free team', () => {
    // Two combined (4L) games the same day at DIFFERENT halls, so neither team is
    // "adjacent" — only the on-site bonus separates a playing team from a free one.
    const g1 = game('g1', '3', '2026-09-15', { time: '12:00', hall: 'h1' }) // H2 plays h1 12:00
    const g2 = game('g2', '7', '2026-09-15', { time: '09:00', hall: 'h2' }) // Legends plays h2 09:00
    const res = runAssignment(base([g1, g2]))
    // g1's duty goes to Legends (on-site: has a home game that day), not a team
    // with no game that day.
    expect(res.find((r) => r.gameId === 'g1')!.combinedTeamName).toBe('Legends')
  })

  it('referee credit caps at 2 duties and deprioritises referee-heavy teams', () => {
    const P = team('p', 'H9', '4L') // playing team → combined
    const A = team('a', 'AAA', '4L') // 5 referee_vb → credit capped at 2 (-20)
    const B = team('b', 'BBB', '4L') // no referees
    const members = Array.from({ length: 5 }, (_, i) => ({ id: `r${i}`, referee_vb: true } as unknown as Member))
    const memberTeams = members.map((m) => ({ member: m.id, team: 'a', guest_level: 0 } as unknown as MemberTeam))
    const input: AssignmentInput = { games: [game('g1', 'p', '2026-09-15')], teams: [P, A, B], trainings: [], members, memberTeams, halls: [] }
    expect(runAssignment(input)[0].combinedTeamName).toBe('BBB')
    const counts = getTeamCounts([], [P, A, B], [], members, memberTeams)
    expect(counts.get('AAA')!.referees).toBe(5)
    expect(counts.get('AAA')!.refereeCredit).toBe(2) // capped, not 5
  })

  it('manual duty credit lowers a team\'s duty priority', () => {
    const P = team('p', 'H9', '4L')
    const A = { ...team('a', 'AAA', '4L'), duty_credit: 3 } as Team // -30
    const B = team('b', 'BBB', '4L')
    const input: AssignmentInput = { games: [game('g1', 'p', '2026-09-15')], teams: [P, A, B], trainings: [], members: [], memberTeams: [], halls: [] }
    expect(runAssignment(input)[0].combinedTeamName).toBe('BBB')
    // Without the credit, AAA (first in order, equal score) would be chosen.
    const A0 = team('a', 'AAA', '4L')
    expect(runAssignment({ ...input, teams: [P, A0, B] })[0].combinedTeamName).toBe('AAA')
  })

  it('cup games are free slots — on-call/Pikett, no team assigned', () => {
    // Both Züri Cup and Swiss/Mobiliar Volley Cup home games are on-call
    // (Pikett) slots → surfaced as mode 'cup', assigned to nobody.
    const zuri = game('c1', '2', '2026-09-15', { league: 'Züri Cup — 1/8-Final, Spiel 4' })
    const swiss = game('c2', '4', '2026-09-22', { league: 'Mobiliar Volley Cup — Runde 1, Spiel 37' })
    const res = runAssignment(base([zuri, swiss], LIC_MEMBERS, LIC_TEAMS))
    for (const a of res) {
      expect(a.mode).toBe('cup')
      expect(a.scorerTeamId).toBeNull()
      expect(a.scoreboardTeamId).toBeNull()
      expect(a.combinedTeamId).toBeNull()
      expect(a.conflicts.some((c) => c.key === 'cupOnCall')).toBe(true)
    }
    // Cup duties never count toward any team's totals.
    const counts = getTeamCounts(res, TEAMS, [zuri, swiss])
    for (const c of counts.values()) expect(c.totalDuties).toBe(0)
  })

  it('keeps a cup duty a planner assigned by hand — the cup rule must not outrank it', () => {
    // A cup tie is assignable on the plan row. Once a team is saved on it, a
    // recompute has to hand it back as 'existingKept'; if the cup rule ran first
    // it would blank the decision back to "on call" on every re-run.
    const assigned = game('c1', '2', '2026-09-15', {
      league: 'Züri Cup — Runde 2, Spiel 3',
      scorer_scoreboard_duty_team: '3',
    })
    const [a] = runAssignment(base([assigned], LIC_MEMBERS, LIC_TEAMS))
    expect(a.mode).toBe('combined')
    expect(a.combinedTeamId).toBe('3')
    expect(a.combinedTeamName).toBe('H2')
    expect(a.conflicts.some((c) => c.key === 'existingKept')).toBe(true)
    expect(a.conflicts.some((c) => c.key === 'cupOnCall')).toBe(false)
  })

  it('still leaves an untouched cup game on call', () => {
    // The precedence change must not start auto-summoning teams for cup ties.
    const [a] = runAssignment(base([game('c1', '2', '2026-09-15', { league: 'Züri Cup — Runde 2, Spiel 3' })], LIC_MEMBERS, LIC_TEAMS))
    expect(a.mode).toBe('cup')
    expect(a.combinedTeamId).toBeNull()
  })

  it('a hand-assigned cup duty counts toward the team it was given to', () => {
    // It is a real duty now, so fairness must see it — unlike an on-call slot.
    const assigned = game('c1', '2', '2026-09-15', { league: 'Züri Cup — Runde 2, Spiel 3', scorer_scoreboard_duty_team: '3' })
    const counts = getTeamCounts(runAssignment(base([assigned], LIC_MEMBERS, LIC_TEAMS)), TEAMS, [assigned])
    // getTeamCounts is keyed by team NAME, not id.
    expect(counts.get('H2')?.totalDuties).toBe(1)
    expect(counts.get('H2')?.combined).toBe(1)
  })

  it('Legends is steered off scorer onto scoreboard, even when it is licenced', () => {
    // Rebalance (Thamy): Legends offloads scorer onto other teams and backfills
    // with the easier täfeler/combined duty. Here Legends HOLDS a scorer licence
    // but still yields the scorer slot to X and takes the scoreboard instead.
    const P = team('p', 'P1', '2L')      // playing → separate (scorer + Täfeler)
    const X = team('x', 'X1', '2L')      // holds the scorer licence
    const L = team('7', 'Legends', '4L') // ALSO licenced, but biased off scorer
    const Y = team('y', 'Y1', '4L')      // rival scoreboard candidate
    const members = [
      { id: 'mx', scorer_vb: true } as unknown as Member,
      { id: 'ml', scorer_vb: true } as unknown as Member,
    ]
    const memberTeams = [
      { member: 'mx', team: 'x', guest_level: 0 } as unknown as MemberTeam,
      { member: 'ml', team: '7', guest_level: 0 } as unknown as MemberTeam,
    ]
    const input: AssignmentInput = {
      games: [game('g1', 'p', '2026-09-15')], teams: [P, X, L, Y],
      trainings: [], members, memberTeams, halls: [],
    }
    const [a] = runAssignment(input)
    expect(a.mode).toBe('separate')
    expect(a.scorerTeamName).toBe('X1')          // Legends yields scorer despite its licence
    expect(a.scoreboardTeamName).toBe('Legends')  // and takes the easier täfeler
  })

  it('Legends is preferred for the combined "scorer without licence" duty', () => {
    // The other half of the backfill: Legends leans into combined duty.
    const P = team('p', 'P1', '4L')      // playing → combined mode (no licence needed)
    const L = team('7', 'Legends', '4L') // +combined bias
    const Z = team('z', 'Z1', '4L')      // rival combined candidate
    const input: AssignmentInput = { games: [game('g1', 'p', '2026-09-15')], teams: [P, L, Z], trainings: [], members: [], memberTeams: [], halls: [] }
    const [a] = runAssignment(input)
    expect(a.mode).toBe('combined')
    expect(a.combinedTeamName).toBe('Legends') // Legends preferred over Z
  })
})
