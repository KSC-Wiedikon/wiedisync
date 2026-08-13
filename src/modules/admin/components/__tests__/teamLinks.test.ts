// The three team relations, pinned.
//
// Two things here fail SILENTLY rather than loudly, which is why they are
// tested rather than eyeballed:
//
//   • The junction column names are not uniform. `member_teams` is keyed
//     `member` / `team`; the two staff junctions came out of the Directus M2M
//     wizard and are keyed `members_id` / `teams_id`. Writing one through the
//     other's names creates a row with two NULL sides — accepted, invisible,
//     and attached to nobody.
//   • Coaching must not touch the roster. A coach with a `member_teams` row
//     shows up in the squad, in RSVP counts, in the scorer duty pool and in the
//     ClubDesk player group as though they played.

import { describe, it, expect } from 'vitest'
import { TEAM_LINK_KINDS, TEAM_LINK_KIND_LIST, teamLinkKind } from '../teamLinks'
import { COACH_VIRTUAL_KEY, TEAMS_VIRTUAL_KEY, TR_VIRTUAL_KEY } from '../memberFieldSchema'
import type { CacheShape } from '../explorerHelpers'

function cacheWith(over: Partial<CacheShape>): CacheShape {
  return {
    members: [], teams: [], events: [], trainings: [], games: [],
    teamLookup: new Map(),
    memberTeams: new Map(), memberTeamRows: [],
    memberCoachTeams: new Map(), memberTrTeams: new Map(),
    coachRows: [], trRows: [],
    clubdeskInfo: new Map(), clubdeskSync: new Map(), regFiles: new Map(),
    loadedAt: 1,
    ...over,
  } as CacheShape
}

describe('team link kinds', () => {
  it('maps each virtual key to its own junction collection', () => {
    expect(TEAM_LINK_KINDS[TEAMS_VIRTUAL_KEY].collection).toBe('member_teams')
    expect(TEAM_LINK_KINDS[COACH_VIRTUAL_KEY].collection).toBe('teams_coaches')
    expect(TEAM_LINK_KINDS[TR_VIRTUAL_KEY].collection).toBe('teams_responsibles')
    expect(new Set(TEAM_LINK_KIND_LIST.map((k) => k.collection)).size).toBe(3)
  })

  it('uses member/team for the roster and members_id/teams_id for the staff junctions', () => {
    expect(TEAM_LINK_KINDS[TEAMS_VIRTUAL_KEY].createPayload('7', '3', '2026/27'))
      .toEqual({ member: '7', team: '3', season: '2026/27' })
    // ⚠ Not `member` / `team`. The M2M wizard generated these names.
    expect(TEAM_LINK_KINDS[COACH_VIRTUAL_KEY].createPayload('7', '3', '2026/27'))
      .toEqual({ members_id: '7', teams_id: '3' })
    expect(TEAM_LINK_KINDS[TR_VIRTUAL_KEY].createPayload('7', '3', '2026/27'))
      .toEqual({ members_id: '7', teams_id: '3' })
  })

  it('stamps the season on the roster only — the staff junctions have no season column', () => {
    for (const key of [COACH_VIRTUAL_KEY, TR_VIRTUAL_KEY] as const) {
      expect(TEAM_LINK_KINDS[key].createPayload('7', '3', '2026/27')).not.toHaveProperty('season')
    }
  })

  it('reads each relation from its own cache map', () => {
    const cache = cacheWith({
      memberTeams: new Map([['7', ['3']]]),
      memberCoachTeams: new Map([['7', ['9']]]),
      memberTrTeams: new Map([['7', ['12']]]),
    })
    expect(TEAM_LINK_KINDS[TEAMS_VIRTUAL_KEY].idsOf(cache, '7')).toEqual(['3'])
    expect(TEAM_LINK_KINDS[COACH_VIRTUAL_KEY].idsOf(cache, '7')).toEqual(['9'])
    expect(TEAM_LINK_KINDS[TR_VIRTUAL_KEY].idsOf(cache, '7')).toEqual(['12'])
  })

  it('returns only THIS member’s rows, so a delete cannot hit somebody else’s link', () => {
    const cache = cacheWith({
      coachRows: [
        { id: 'c1', member: '7', team: '9' },
        { id: 'c2', member: '8', team: '9' },
      ],
    })
    expect(TEAM_LINK_KINDS[COACH_VIRTUAL_KEY].rowsOf(cache, '7')).toEqual([{ id: 'c1', team: '9' }])
  })

  it('adding a coaching link leaves the roster untouched', () => {
    const cache = cacheWith({})
    const next = TEAM_LINK_KINDS[COACH_VIRTUAL_KEY].applyAdd(cache, {
      id: 'c9', member: '7', team: '3', season: '2026/27', guestLevel: 0,
    })
    expect(next.coachRows).toEqual([{ id: 'c9', member: '7', team: '3' }])
    expect(next.memberCoachTeams.get('7')).toEqual(['3'])
    // The part that matters: no roster row appeared.
    expect(next.memberTeamRows).toEqual([])
    expect(next.memberTeams.size).toBe(0)
  })

  it('adding a roster link leaves the staff junctions untouched', () => {
    const next = TEAM_LINK_KINDS[TEAMS_VIRTUAL_KEY].applyAdd(cacheWith({}), {
      id: 'r9', member: '7', team: '3', season: '2026/27', guestLevel: 0,
    })
    expect(next.memberTeams.get('7')).toEqual(['3'])
    expect(next.memberTeamRows[0].season).toBe('2026/27')
    expect(next.coachRows).toEqual([])
    expect(next.trRows).toEqual([])
  })

  it('removes by junction primary key and rebuilds the derived map', () => {
    const cache = cacheWith({
      trRows: [
        { id: 't1', member: '7', team: '9' },
        { id: 't2', member: '7', team: '12' },
      ],
    })
    const next = TEAM_LINK_KINDS[TR_VIRTUAL_KEY].applyRemove(cache, 't1')
    expect(next.trRows).toEqual([{ id: 't2', member: '7', team: '12' }])
    expect(next.memberTrTeams.get('7')).toEqual(['12'])
  })

  it('resolves a known key and refuses an unknown one', () => {
    expect(teamLinkKind(COACH_VIRTUAL_KEY)?.collection).toBe('teams_coaches')
    // A real `members` column must never be mistaken for a link.
    expect(teamLinkKind('first_name')).toBeUndefined()
    expect(teamLinkKind('__fee_amount')).toBeUndefined()
  })
})
