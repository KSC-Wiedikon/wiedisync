import { describe, it, expect } from 'vitest'
import { canAccessSpielplanung } from '../utils/spielplanerAccess'

const base = {
  isAdmin: false,
  is_spielplaner: false,
  spielplanerTeamIds: [] as string[],
  coachTeamIds: [] as string[],
  teamResponsibleIds: [] as string[],
}

describe('canAccessSpielplanung', () => {
  it('admits admins', () => {
    expect(canAccessSpielplanung({ ...base, isAdmin: true })).toBe(true)
  })

  it('admits club-wide spielplaners', () => {
    expect(canAccessSpielplanung({ ...base, is_spielplaner: true })).toBe(true)
  })

  it('admits scoped spielplaners with at least one assignment', () => {
    expect(canAccessSpielplanung({ ...base, spielplanerTeamIds: ['3'] })).toBe(true)
  })

  it('admits coaches (read-only planner access)', () => {
    expect(canAccessSpielplanung({ ...base, coachTeamIds: ['5'] })).toBe(true)
  })

  it('admits team responsibles (read-only planner access)', () => {
    expect(canAccessSpielplanung({ ...base, teamResponsibleIds: ['7'] })).toBe(true)
  })

  it('rejects users with none of the above', () => {
    expect(canAccessSpielplanung(base)).toBe(false)
  })

  it('rejects empty role arrays', () => {
    expect(
      canAccessSpielplanung({ ...base, spielplanerTeamIds: [], coachTeamIds: [], teamResponsibleIds: [] }),
    ).toBe(false)
  })
})
