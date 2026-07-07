import { describe, expect, it } from 'vitest'
import type { Game, Team } from '../../../types'
import { runAssignment, getTeamCounts, type AssignmentInput } from './AssignmentAlgorithm'

// Minimal fixture factories — the algorithm only reads a handful of fields.
const team = (id: string, name: string): Team =>
  ({ id, name, sport: 'volleyball', active: true } as unknown as Team)

const game = (id: string, kscwTeamId: string, date: string, opts: Partial<Game> = {}): Game =>
  ({ id, kscw_team: kscwTeamId, date, time: '18:00', type: 'home', status: 'scheduled', hall: 'h1', league: '2L', ...opts } as unknown as Game)

const TEAMS = [
  team('1', 'HU20'),
  team('2', 'H1'),
  team('3', 'H2'),
  team('4', 'D1'),
  team('5', 'MiniVB'),
  team('6', 'DU20'),
]

// members/memberTeams are intentionally EMPTY → proves no scorer licence is required.
const base = (games: Game[]): AssignmentInput => ({
  games, teams: TEAMS, trainings: [], members: [], memberTeams: [],
  halls: [{ id: 'h1', name: 'Sporthalle' }],
})

describe('runAssignment — referee / exclusions / no-licence', () => {
  it('HU20 home game → scorer + referee (never a scoreboard or combined team)', () => {
    const [a] = runAssignment(base([game('g1', '1', '2026-09-15')]))
    expect(a.mode).toBe('referee')
    expect(a.scorerTeamId).toBeTruthy()
    expect(a.refereeTeamId).toBeTruthy()
    expect(a.scoreboardTeamId).toBeNull()
    expect(a.combinedTeamId).toBeNull()
    // scorer and referee are two different teams, neither is the playing team
    expect(a.scorerTeamId).not.toBe(a.refereeTeamId)
    expect([a.scorerTeamId, a.refereeTeamId]).not.toContain('1')
  })

  it('assigns duties with NO licenced members present (licence rule dropped)', () => {
    const [a] = runAssignment(base([game('g1', '2', '2026-09-15')])) // H1 home
    expect(a.mode).toBe('separate')
    expect(a.scorerTeamId).toBeTruthy()
    expect(a.scoreboardTeamId).toBeTruthy()
  })

  it('never assigns MiniVB or DU20 as a duty provider', () => {
    const games = [
      game('g1', '2', '2026-09-15'),
      game('g2', '3', '2026-09-22'),
      game('g3', '4', '2026-09-29'),
      game('g4', '1', '2026-10-06'),
    ]
    const results = runAssignment(base(games))
    const names = results.flatMap((r) => [r.scorerTeamName, r.scoreboardTeamName, r.combinedTeamName, r.refereeTeamName])
    expect(names).not.toContain('MiniVB')
    expect(names).not.toContain('DU20')
  })

  it('team summary counts referee duties and omits MiniVB / DU20', () => {
    const results = runAssignment(base([game('g1', '1', '2026-09-15')]))
    const counts = getTeamCounts(results, TEAMS, [game('g1', '1', '2026-09-15')])
    const totalReferee = Array.from(counts.values()).reduce((s, r) => s + r.referee, 0)
    expect(totalReferee).toBe(1)
    expect(counts.has('MiniVB')).toBe(false)
    expect(counts.has('DU20')).toBe(false)
  })
})
