import { describe, it, expect } from 'vitest'
import { buildTeamPeopleIds, type StaffJunctionRow } from './useTeamPeopleIds'
import type { MemberTeam } from '../types'

const mt = (member: string, team: string, guest_level = 0): MemberTeam =>
  ({ id: `${member}-${team}`, member, team, season: '2026/27', guest_level }) as MemberTeam

const staff = (members_id: StaffJunctionRow['members_id'], teams_id: StaffJunctionRow['teams_id']): StaffJunctionRow =>
  ({ members_id, teams_id })

describe('buildTeamPeopleIds', () => {
  it('unions the player roster with both staff junctions', () => {
    const map = buildTeamPeopleIds(
      [mt('1', '81'), mt('2', '81')],
      [staff('155', '81'), staff('99', '82')],
    )
    expect([...map.get('81')!].sort()).toEqual(['1', '155', '2'])
    expect([...map.get('82')!]).toEqual(['99'])
  })

  it('lists a staff-only coach on the team they coach, not on their playing team', () => {
    // The D3 case: Joaquin coaches team 81 but his roster rows are 11 and 82.
    const map = buildTeamPeopleIds(
      [mt('155', '11'), mt('155', '82')],
      [staff('155', '81')],
    )
    expect(map.get('81')!.has('155')).toBe(true)
    expect(map.get('11')!.has('155')).toBe(true)
  })

  it('normalises numeric junction ids to strings so lookups by team id match', () => {
    const map = buildTeamPeopleIds([], [staff(155, 81)])
    expect(map.get('81')!.has('155')).toBe(true)
  })

  it('counts a player-coach once', () => {
    const map = buildTeamPeopleIds([mt('7', '3')], [staff('7', '3')])
    expect([...map.get('3')!]).toEqual(['7'])
  })

  it('skips junction rows with a null FK instead of inventing a "null" team', () => {
    const map = buildTeamPeopleIds([], [staff('5', null), staff(null, '9')])
    expect(map.size).toBe(0)
  })

  it('keeps guests on the roster — the guest rule is applied by the caller', () => {
    const map = buildTeamPeopleIds([mt('4', '6', 2)], [])
    expect(map.get('6')!.has('4')).toBe(true)
  })
})
