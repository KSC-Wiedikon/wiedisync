import { describe, expect, it } from 'vitest'
import { getStaffCode } from './memberRole'
import type { Team } from '../../types'

const team = (extra: Partial<Team> = {}): Team => ({
  id: '92',
  name: 'H3',
  coach: [{ id: 1, members_id: 11 }, { id: 2, members_id: 446 }],
  team_responsible: [{ id: 3, members_id: 8 }, { id: 4, members_id: 6 }],
  captain: 19,
  features_enabled: {},
  ...extra,
} as unknown as Team)

describe('getStaffCode', () => {
  it('calls every coach C while no head coach is named', () => {
    expect(getStaffCode(11, team())).toBe('C')
    expect(getStaffCode('446', team())).toBe('C')
  })

  it('follows the Einsatzliste officials when they are set', () => {
    const t = team({ features_enabled: { nomination_officials: { coach: '446', assistant_coach_1: '11' } } })
    expect(getStaffCode(446, t)).toBe('C')
    expect(getStaffCode(11, t)).toBe('AC1')
  })

  it('calls a coach left out of the officials AC once a head coach is named', () => {
    const t = team({ features_enabled: { nomination_officials: { coach: '446', assistant_coach_1: null } } })
    expect(getStaffCode(11, t)).toBe('AC')
  })

  it('codes a team responsible TR and anyone else nothing', () => {
    expect(getStaffCode(8, team())).toBe('TR')
    expect(getStaffCode(19, team())).toBeNull()
    expect(getStaffCode(11, null)).toBeNull()
  })

  it('names a team responsible who is an official by the official slot', () => {
    const t = team({ features_enabled: { nomination_officials: { assistant_coach_2: '8' } } })
    expect(getStaffCode(8, t)).toBe('AC2')
  })
})
