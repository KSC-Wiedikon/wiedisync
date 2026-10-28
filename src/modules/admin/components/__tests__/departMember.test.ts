// Unit tests for the pure half of departMember.ts.
//
// Same reason bulkEdit.test.ts exists: this is the part that can be wrong
// quietly. `alreadyDeparted` decides whether a member is written at all, so a
// false positive silently SKIPS a departure — on a bulk run over 120 people
// nobody would notice, and the register would keep billing them.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({
  fetchItems: vi.fn(),
  deleteRecord: vi.fn(),
  updateRecord: vi.fn(),
}))
vi.mock('../../../../lib/api', () => api)

import { DEPARTED_ORDERED, alreadyDeparted, buildDepartPatch, dropStaffLinksOnTeams } from '../departMember'

const PATCH = buildDepartPatch('former', '2026-06-30')

describe('buildDepartPatch', () => {
  it('writes all four columns, both flags off', () => {
    expect(PATCH).toEqual({
      register_status: 'former',
      left_on: '2026-06-30',
      kscw_membership_active: false,
      wiedisync_active: false,
    })
  })
})

describe('DEPARTED_ORDERED', () => {
  it('is the register picklist verbatim, without Zwischenjahr', () => {
    expect(DEPARTED_ORDERED).toEqual(['former', 'non_member', 'deceased'])
    expect(DEPARTED_ORDERED).not.toContain('gap_year')
  })
})

describe('alreadyDeparted', () => {
  const departed = {
    register_status: 'former',
    left_on: '2026-06-30',
    kscw_membership_active: false,
    wiedisync_active: false,
  }

  it('is true when all four columns already match', () => {
    expect(alreadyDeparted(departed, PATCH)).toBe(true)
  })

  it('tolerates a timestamp-shaped austritt', () => {
    expect(alreadyDeparted({ ...departed, left_on: '2026-06-30T00:00:00Z' }, PATCH)).toBe(true)
  })

  it('is false on a different exit date', () => {
    expect(alreadyDeparted({ ...departed, left_on: '2026-05-31' }, PATCH)).toBe(false)
  })

  it('is false on a different departed status', () => {
    expect(alreadyDeparted({ ...departed, register_status: 'non_member' }, PATCH)).toBe(false)
  })

  it('is false while either flag is still on', () => {
    expect(alreadyDeparted({ ...departed, kscw_membership_active: true }, PATCH)).toBe(false)
    expect(alreadyDeparted({ ...departed, wiedisync_active: true }, PATCH)).toBe(false)
  })

  // The regression that motivated asBool(): Directus serves these two columns as
  // `true` / `'true'` / `1` depending on the path, and a bare `=== true` read a
  // still-active member as already departed — i.e. skipped their departure.
  it('reads a stringified or numeric truthy flag as still active', () => {
    expect(alreadyDeparted({ ...departed, kscw_membership_active: 'true' }, PATCH)).toBe(false)
    expect(alreadyDeparted({ ...departed, wiedisync_active: 1 }, PATCH)).toBe(false)
  })

  it('is false on a member who was never departed at all', () => {
    expect(alreadyDeparted(
      { register_status: 'active', left_on: null, kscw_membership_active: true, wiedisync_active: true },
      PATCH,
    )).toBe(false)
  })
})

// Staff (coach / team responsible) never have a member_teams row, so a departure
// that only dropped rosters left a departed coach on the staff list.
describe('dropStaffLinksOnTeams', () => {
  beforeEach(() => {
    api.fetchItems.mockReset()
    api.deleteRecord.mockReset()
  })

  it('does nothing without active teams', async () => {
    expect(await dropStaffLinksOnTeams('42', [])).toEqual({ teams_coaches: 0, teams_responsibles: 0 })
    expect(api.fetchItems).not.toHaveBeenCalled()
  })

  it('deletes both junctions\' rows on the active teams, scoped by member + team', async () => {
    api.fetchItems.mockImplementation(async (collection: string) =>
      collection === 'teams_coaches' ? [{ id: '7' }, { id: '8' }] : [{ id: '9' }])
    api.deleteRecord.mockResolvedValue(undefined)

    const dropped = await dropStaffLinksOnTeams('42', ['3', '4'])

    expect(dropped).toEqual({ teams_coaches: 2, teams_responsibles: 1 })
    expect(api.fetchItems).toHaveBeenCalledWith('teams_coaches', expect.objectContaining({
      filter: { members_id: { _eq: '42' }, teams_id: { _in: ['3', '4'] } },
    }))
    expect(api.fetchItems).toHaveBeenCalledWith('teams_responsibles', expect.objectContaining({
      filter: { members_id: { _eq: '42' }, teams_id: { _in: ['3', '4'] } },
    }))
    expect(api.deleteRecord.mock.calls).toEqual([
      ['teams_coaches', '7'], ['teams_coaches', '8'], ['teams_responsibles', '9'],
    ])
  })

  it('counts only the rows that actually went', async () => {
    api.fetchItems.mockImplementation(async (collection: string) =>
      collection === 'teams_coaches' ? [{ id: '7' }, { id: '8' }] : [])
    api.deleteRecord.mockRejectedValueOnce(new Error('403')).mockResolvedValue(undefined)

    expect(await dropStaffLinksOnTeams('42', ['3'])).toEqual({ teams_coaches: 1, teams_responsibles: 0 })
  })
})
