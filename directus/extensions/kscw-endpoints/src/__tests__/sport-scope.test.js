// sport-scope.js — the adapters every M7 (2026-10-12) endpoint gate goes through.
// The rule itself is member-sport.js's and is pinned in member-sport.test.js; this
// pins only the adaptation: role blobs, team lists, member lists, registrations.
//
// resolveMemberSports is mocked so these tests keep meaning the same thing when
// it starts reading the stored members.sport_section column.
import { describe, it, expect, vi } from 'vitest'

const memberSports = new Map()
vi.mock('../member-sport.js', async (orig) => ({
  ...(await orig()),
  resolveMemberSports: vi.fn(async (_db, ids) => new Map(ids.map((id) => [String(id), memberSports.get(String(id)) ?? 'both']))),
}))

const {
  parseRoles, callerSportScope, sportOfTeams, registrationSport,
  scopeAllowsTeams, membersInScope, scopeAllowsMember,
} = await import('../sport-scope.js')

function fakeDb(tables) {
  return (name) => {
    let rows = [...(tables[name] || [])]
    const chain = {
      whereIn(c, vals) { const s = new Set(vals.map(String)); rows = rows.filter((r) => s.has(String(r[c]))); return chain },
      where(obj) { for (const [k, v] of Object.entries(obj)) rows = rows.filter((r) => String(r[k]) === String(v)); return chain },
      select() { return Promise.resolve(rows) },
    }
    return chain
  }
}

const db = fakeDb({
  teams: [{ id: 1, sport: 'volleyball' }, { id: 2, sport: 'basketball' }, { id: 3, sport: null }],
})

describe('parseRoles / callerSportScope', () => {
  it('reads JSON text, arrays and junk', () => {
    expect(parseRoles('["vb_admin","board"]')).toEqual(['vb_admin', 'board'])
    expect(parseRoles(['bb_admin'])).toEqual(['bb_admin'])
    expect(parseRoles('not json')).toEqual([])
    expect(parseRoles(null)).toEqual([])
  })

  it('confines a single sport admin, board member or not', () => {
    expect(callerSportScope('["vb_admin"]')).toBe('volleyball')
    expect(callerSportScope(['board', 'bb_admin'])).toBe('basketball')
  })

  it('never confines a full admin, a dual sport admin, a Directus admin or a non-admin', () => {
    expect(callerSportScope(['board', 'vb_admin', 'admin'])).toBeNull()
    expect(callerSportScope(['vb_admin', 'bb_admin'])).toBeNull()
    expect(callerSportScope(['vb_admin'], { directusAdmin: true })).toBeNull()
    expect(callerSportScope(['user'])).toBeNull()
  })
})

describe('sportOfTeams / registrationSport', () => {
  it('no teams, mixed teams and unset sports are all "both"', () => {
    expect(sportOfTeams([])).toBe('both')
    expect(sportOfTeams(['volleyball', 'basketball'])).toBe('both')
    expect(sportOfTeams([null])).toBe('both')
    expect(sportOfTeams(['volleyball', 'volleyball'])).toBe('volleyball')
  })

  it('a passive or unset registration is "both"', () => {
    expect(registrationSport('volleyball')).toBe('volleyball')
    expect(registrationSport('basketball')).toBe('basketball')
    expect(registrationSport('passive')).toBe('both')
    expect(registrationSport(null)).toBe('both')
  })
})

describe('scopeAllowsTeams', () => {
  it('allows the own sport and refuses the other', async () => {
    expect(await scopeAllowsTeams(db, 'volleyball', [1])).toBe(true)
    expect(await scopeAllowsTeams(db, 'volleyball', [2])).toBe(false)
  })

  it('a team-less, mixed or sport-less target is "both" and allowed', async () => {
    expect(await scopeAllowsTeams(db, 'basketball', [])).toBe(true)
    expect(await scopeAllowsTeams(db, 'basketball', [null])).toBe(true)
    expect(await scopeAllowsTeams(db, 'basketball', [1, 2])).toBe(true)
    expect(await scopeAllowsTeams(db, 'basketball', [3])).toBe(true)
  })

  it('an unconfined caller is never asked', async () => {
    expect(await scopeAllowsTeams(db, null, [2])).toBe(true)
  })
})

describe('membersInScope / scopeAllowsMember', () => {
  memberSports.set('10', 'volleyball')
  memberSports.set('11', 'basketball')
  memberSports.set('12', 'both')

  it('keeps own-section and club-level members, drops the other section', async () => {
    expect([...(await membersInScope(db, 'volleyball', [10, 11, 12, 13]))].sort()).toEqual(['10', '12', '13'])
  })

  it('unconfined keeps everybody', async () => {
    expect([...(await membersInScope(db, null, [10, 11]))].sort()).toEqual(['10', '11'])
  })

  it('answers for one member', async () => {
    expect(await scopeAllowsMember(db, 'basketball', 11)).toBe(true)
    expect(await scopeAllowsMember(db, 'basketball', 10)).toBe(false)
    expect(await scopeAllowsMember(db, 'basketball', 12)).toBe(true)
    expect(await scopeAllowsMember(db, null, 10)).toBe(true)
  })
})
