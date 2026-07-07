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
})
