import { describe, expect, it } from 'vitest'
import type { Game, Team, Member, MemberTeam } from '../../../types'
import { runBbAssignment, canFieldSeats, type BbAssignmentInput } from './AssignmentAlgorithmBb'
import { TABELLE_I, resolveBbRequirement, licenceRank, seatCount } from '../lib/bbLeagueRequirements'

// Minimal fixture factories — the BB engine reads name, league, sport, active.
const team = (id: string, name: string, league = 'H4LZ'): Team =>
  ({ id, name, league, sport: 'basketball', active: true } as unknown as Team)

const game = (id: string, kscwTeamId: string, date: string, league: string, opts: Partial<Game> = {}): Game =>
  ({ id, kscw_team: kscwTeamId, date, time: '18:00', type: 'home', status: 'scheduled', hall: 'h1', league, ...opts } as unknown as Game)

/** n members on `teamId` at the given licence level. */
const staff = (teamId: string, level: 'otr2' | 'otr1' | 'none', n: number, seed: string) => {
  const members: Member[] = []
  const memberTeams: MemberTeam[] = []
  for (let i = 0; i < n; i++) {
    const id = `${seed}${i}`
    members.push({ id, otr1_bb: level !== 'none', otr2_bb: level === 'otr2' } as unknown as Member)
    memberTeams.push({ member: id, team: teamId, guest_level: 0 } as unknown as MemberTeam)
  }
  return { members, memberTeams }
}

const merge = (...parts: { members: Member[]; memberTeams: MemberTeam[] }[]) => ({
  members: parts.flatMap((p) => p.members),
  memberTeams: parts.flatMap((p) => p.memberTeams),
})

const input = (games: Game[], teams: Team[], staffed: { members: Member[]; memberTeams: MemberTeam[] }): BbAssignmentInput => ({
  games, teams, trainings: [], ...staffed,
})

describe('Tabelle I', () => {
  it('splits the three-seat leagues into their two shapes', () => {
    // Most top leagues want 1 OTR2 + 2 OTR1 …
    expect(TABELLE_I.H2LR.seats).toEqual(['otr2', 'otr1', 'otr1'])
    // … but the U14 interregional third seat is unlicensed.
    expect(TABELLE_I.HU14I.seats).toEqual(['otr2', 'otr1', 'none'])
  })

  it('resolves from the game competition code, not the team code', () => {
    // Herren 2 carries teams.league 'H3LS' but plays '2LRM' — three seats.
    expect(resolveBbRequirement('2LRM').row).toBe('H2LR')
    expect(seatCount('2LRM')).toBe(3)
    expect(seatCount('4LZM')).toBe(2)
  })

  it('treats U8/U6 as referee-only', () => {
    expect(resolveBbRequirement('MixU 8M').refereeOnly).toBe(true)
  })

  it('falls back to two seats on an unknown league instead of throwing', () => {
    const req = resolveBbRequirement('SomeNewLeague 2030')
    expect(req.row).toBe('unknown')
    expect(req.seats).toHaveLength(2)
  })

  it('ranks OTN above OTR2 above OTR1', () => {
    expect(licenceRank({ otn1_bb: true } as unknown as Member)).toBeGreaterThan(
      licenceRank({ otr2_bb: true } as unknown as Member))
    expect(licenceRank({ otr2_bb: true } as unknown as Member)).toBeGreaterThan(
      licenceRank({ otr1_bb: true } as unknown as Member))
  })
})

describe('canFieldSeats', () => {
  const d1 = TABELLE_I.D1LR // otr2 + otr1 + otr1

  it('rejects one OTR2 alone for a 1 OTR2 + 2 OTR1 crew', () => {
    expect(canFieldSeats([2], d1)).toBe(false)
  })

  it('accepts one OTR2 plus two OTR1', () => {
    expect(canFieldSeats([2, 1, 1], d1)).toBe(true)
  })

  it('lets an OTN holder fill the OTR2 seat', () => {
    expect(canFieldSeats([3, 1, 1], d1)).toBe(true)
  })

  it('rejects three OTR1 with no OTR2', () => {
    expect(canFieldSeats([1, 1, 1], d1)).toBe(false)
  })

  it('counts an unlicensed body for the HU14I third seat', () => {
    expect(canFieldSeats([2, 1, 0], TABELLE_I.HU14I)).toBe(true)
    expect(canFieldSeats([2, 1], TABELLE_I.HU14I)).toBe(false)
  })
})

describe('runBbAssignment', () => {
  it('never assigns a three-seat league to a team with no OTR2', () => {
    const teams = [team('1', 'Lions D1', 'D1LRA'), team('2', 'NoOtr2')]
    const staffed = staff('2', 'otr1', 5, 'a')
    const [a] = runBbAssignment(input([game('g1', '1', '2026-10-21', '1LRAF')], teams, staffed))
    expect(a.dutyTeamId).toBeNull()
    expect(a.conflicts[0].key).toBe('noTeamAvailable')
  })

  it('assigns a three-seat league to a team that can field the crew', () => {
    const teams = [team('1', 'Lions D1', 'D1LRA'), team('2', 'Herren 1')]
    const staffed = merge(staff('2', 'otr2', 1, 'a'), staff('2', 'otr1', 2, 'b'))
    const [a] = runBbAssignment(input([game('g1', '1', '2026-10-21', '1LRAF')], teams, staffed))
    expect(a.dutyTeamId).toBe('2')
  })

  it('prefers the team playing immediately before at the same hall', () => {
    // The whole point of the overlap-only rewrite: team 2 has its own game
    // that day, which the old same-day rule disqualified outright. g0 carries
    // its own duty team so it does not consume a candidate — team 2 and team 3
    // then compete on score alone, and the sequence bonus decides.
    const teams = [team('1', 'Rhinos D3', 'D3LR'), team('2', 'Adjacent'), team('3', 'Idle'), team('4', 'Other')]
    const staffed = merge(staff('2', 'otr1', 3, 'a'), staff('3', 'otr1', 3, 'b'), staff('4', 'otr1', 3, 'c'))
    const games = [
      game('g0', '2', '2026-10-27', '4LZM', { time: '14:00', bb_duty_team: '4' }), // team 2 plays earlier, same hall
      game('g1', '1', '2026-10-27', '3LRF', { time: '18:00' }),
    ]
    const results = runBbAssignment(input(games, teams, staffed))
    const target = results.find((r) => r.gameId === 'g1')!
    expect(target.dutyTeamId).toBe('2')
    expect(target.conflicts.some((c) => c.key === 'reason_sequenceBonus')).toBe(true)
  })

  it('still excludes a team whose own game overlaps the duty slot', () => {
    // g0 is an away fixture: it gives team 2 a clashing start time without
    // being a home game that needs duty of its own.
    const teams = [team('1', 'Rhinos D3', 'D3LR'), team('2', 'Overlapping'), team('3', 'Idle')]
    const staffed = merge(staff('2', 'otr1', 3, 'a'), staff('3', 'otr1', 3, 'b'))
    const games = [
      game('g0', '2', '2026-10-27', '4LZM', { time: '17:30', type: 'away' }), // 30 min before → overlaps
      game('g1', '1', '2026-10-27', '3LRF', { time: '18:00' }),
    ]
    const results = runBbAssignment(input(games, teams, staffed))
    expect(results.find((r) => r.gameId === 'g1')!.dutyTeamId).toBe('3')
  })

  it('assigns no duty at all for U8/U6', () => {
    const teams = [team('1', 'MU8', 'MixU 8M'), team('2', 'Helper')]
    const staffed = staff('2', 'otr2', 5, 'a')
    const [a] = runBbAssignment(input([game('g1', '1', '2026-11-07', 'MixU 8M')], teams, staffed))
    expect(a.dutyTeamId).toBeNull()
    expect(a.conflicts[0].key).toBe('noTableRequired')
  })

  it('excludes the Classics umbrellas from the candidate pool', () => {
    const teams = [team('1', 'Rhinos D3', 'D3LR'), team('2', 'H-Classics 1LR', 'H-Classics')]
    const staffed = staff('2', 'otr2', 10, 'a')
    const [a] = runBbAssignment(input([game('g1', '1', '2026-10-27', '3LRF')], teams, staffed))
    expect(a.dutyTeamId).toBeNull()
  })
})
