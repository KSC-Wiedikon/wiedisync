import { describe, expect, it } from 'vitest'
import {
  sportFromParts, resolveMemberSports, resolveMemberSport,
  sportAdminScope, sportScopeAllows,
} from '../member-sport.js'

/**
 * Minimal knex stand-in: `db('table').whereIn(col, ids).select(...)` resolves to
 * the rows in `tables[table]` whose `col` is in `ids`. Counts calls so the
 * batching promise ("four queries whatever the page size") is actually pinned.
 */
function fakeDb(tables) {
  const calls = []
  const api = (table) => {
    const state = { table, ids: null, col: null }
    const chain = {
      whereIn(col, ids) { state.col = col; state.ids = ids; return chain },
      where(obj) { const [c, v] = Object.entries(obj)[0]; state.col = c; state.ids = [v]; return chain },
      select() {
        calls.push(state.table)
        const rows = tables[state.table] ?? []
        if (state.ids === null) return Promise.resolve(rows)
        const want = new Set(state.ids.map(String))
        return Promise.resolve(rows.filter((r) => want.has(String(r[state.col]))))
      },
    }
    return chain
  }
  api.calls = calls
  return api
}

const TABLES = {
  teams: [
    { id: 1, sport: 'volleyball' },
    { id: 2, sport: 'basketball' },
    { id: 3, sport: null },
  ],
  member_teams: [
    { member: 10, team: 1 },   // pure VB player
    { member: 11, team: 2 },   // pure BB player
    { member: 12, team: 1 },   // both sports
    { member: 12, team: 2 },
    { member: 15, team: 3 },   // team with no sport set
  ],
  teams_coaches: [
    { members_id: 13, teams_id: 2 }, // coach only — NO roster row
  ],
  teams_responsibles: [
    { members_id: 14, teams_id: 1 }, // TR only
  ],
  members: [
    { id: 10, sektion: null, beitragskategorie: null },
    { id: 11, sektion: null, beitragskategorie: null },
    { id: 12, sektion: null, beitragskategorie: null },
    { id: 13, sektion: null, beitragskategorie: null },
    { id: 14, sektion: null, beitragskategorie: null },
    { id: 15, sektion: 'Basketball', beitragskategorie: null },
    { id: 20, sektion: 'Volleyball', beitragskategorie: null },
    { id: 21, sektion: 'KSCW', beitragskategorie: 'BB Jugend Meisterschaft' },
    { id: 22, sektion: null, beitragskategorie: 'VB Erwerbstätige' },
    { id: 23, sektion: null, beitragskategorie: 'Gratis' },
    { id: 24, sektion: null, beitragskategorie: null },
  ],
}

describe('sportFromParts', () => {
  it('takes the sport from a single team', () => {
    expect(sportFromParts({ teamSports: ['volleyball'] })).toBe('volleyball')
    expect(sportFromParts({ teamSports: ['basketball'] })).toBe('basketball')
  })

  it('is "both" when the member is in teams of both sports', () => {
    expect(sportFromParts({ teamSports: ['volleyball', 'basketball'] })).toBe('both')
  })

  it('ignores a team whose sport is null and falls through', () => {
    expect(sportFromParts({ teamSports: [null], sektion: 'Basketball' })).toBe('basketball')
  })

  it('teams outrank sektion — the team is the fact', () => {
    expect(sportFromParts({ teamSports: ['basketball'], sektion: 'Volleyball' })).toBe('basketball')
  })

  it('falls back to sektion, case-insensitively', () => {
    expect(sportFromParts({ sektion: 'Volleyball' })).toBe('volleyball')
    expect(sportFromParts({ sektion: '  basketball ' })).toBe('basketball')
  })

  it('falls back to the fee-category prefix when sektion is club-level', () => {
    expect(sportFromParts({ sektion: 'KSCW', beitragskategorie: 'BB Jugend Meisterschaft' })).toBe('basketball')
    expect(sportFromParts({ beitragskategorie: 'VB Erwerbstätige' })).toBe('volleyball')
  })

  it('is "both" when nothing resolves — permissive on purpose', () => {
    expect(sportFromParts({})).toBe('both')
    expect(sportFromParts({ beitragskategorie: 'Gratis' })).toBe('both')
    expect(sportFromParts({ sektion: 'KSCW' })).toBe('both')
  })

  it('does not match a category that merely contains vb/bb', () => {
    // The rule is a PREFIX. 'Aktivmitglied VB' is not a volleyball marker.
    expect(sportFromParts({ beitragskategorie: 'Aktivmitglied VB' })).toBe('both')
  })
})

describe('resolveMemberSports (batched)', () => {
  it('resolves players, coaches and team responsibles', async () => {
    const db = fakeDb(TABLES)
    const map = await resolveMemberSports(db, [10, 11, 12, 13, 14])
    expect(map.get('10')).toBe('volleyball')
    expect(map.get('11')).toBe('basketball')
    expect(map.get('12')).toBe('both')
    // ⚠ A coach has NO roster row — a player-only join would call this "no team".
    expect(map.get('13')).toBe('basketball')
    expect(map.get('14')).toBe('volleyball')
  })

  it('uses sektion / category for members with no team', async () => {
    const db = fakeDb(TABLES)
    const map = await resolveMemberSports(db, [20, 21, 22, 23])
    expect(map.get('20')).toBe('volleyball')
    expect(map.get('21')).toBe('basketball')
    expect(map.get('22')).toBe('volleyball')
    expect(map.get('23')).toBe('both')
  })

  it('returns an entry for every id asked for, defaulting to both', async () => {
    const db = fakeDb(TABLES)
    const map = await resolveMemberSports(db, [24, 999])
    expect(map.get('24')).toBe('both')
    expect(map.get('999')).toBe('both')
  })

  it('runs a fixed number of queries regardless of page size', async () => {
    const small = fakeDb(TABLES)
    await resolveMemberSports(small, [10])
    const big = fakeDb(TABLES)
    await resolveMemberSports(big, [10, 11, 12, 13, 14, 20, 21, 22, 23, 24])
    // 3 junctions + teams + members === 5, and it must not grow with the input.
    expect(big.calls.length).toBe(small.calls.length)
    expect(big.calls.length).toBeLessThanOrEqual(5)
  })

  it('skips its own members query when rows are supplied', async () => {
    const db = fakeDb(TABLES)
    const map = await resolveMemberSports(db, [21], { memberRows: TABLES.members })
    expect(map.get('21')).toBe('basketball')
    expect(db.calls).not.toContain('members')
  })

  it('is empty for an empty id list and issues no queries', async () => {
    const db = fakeDb(TABLES)
    expect((await resolveMemberSports(db, [])).size).toBe(0)
    expect(db.calls).toHaveLength(0)
  })

  it('matches ids across string/number forms', async () => {
    const db = fakeDb(TABLES)
    const map = await resolveMemberSports(db, ['10'])
    expect(map.get('10')).toBe('volleyball')
  })

  it('single-member form agrees with the batched one', async () => {
    expect(await resolveMemberSport(fakeDb(TABLES), 13)).toBe('basketball')
    expect(await resolveMemberSport(fakeDb(TABLES), 999)).toBe('both')
  })
})

describe('sportAdminScope', () => {
  it('confines a single-sport admin', () => {
    expect(sportAdminScope(['user', 'vb_admin'])).toBe('volleyball')
    expect(sportAdminScope(['user', 'bb_admin'])).toBe('basketball')
  })

  it('does not confine a dual sport admin', () => {
    expect(sportAdminScope(['user', 'vb_admin', 'bb_admin'])).toBeNull()
  })

  it('does not confine a full admin even when a sport flag is present', () => {
    expect(sportAdminScope(['user', 'vb_admin', 'admin'])).toBeNull()
    expect(sportAdminScope(['user', 'bb_admin', 'superuser'])).toBeNull()
  })

  it('returns null for a non-admin — callers must check staffness separately', () => {
    expect(sportAdminScope(['user'])).toBeNull()
    expect(sportAdminScope([])).toBeNull()
    expect(sportAdminScope(null)).toBeNull()
    expect(sportAdminScope(undefined)).toBeNull()
  })
})

describe('sportScopeAllows', () => {
  it('lets an unconfined caller through', () => {
    expect(sportScopeAllows(null, 'basketball')).toBe(true)
    expect(sportScopeAllows(null, undefined)).toBe(true)
  })

  it('allows own section and club-level, refuses the other section', () => {
    expect(sportScopeAllows('volleyball', 'volleyball')).toBe(true)
    expect(sportScopeAllows('volleyball', 'both')).toBe(true)
    expect(sportScopeAllows('volleyball', 'basketball')).toBe(false)
    expect(sportScopeAllows('basketball', 'volleyball')).toBe(false)
  })

  it('fails closed on an unresolved section', () => {
    // The hook relies on this: an item whose sport could not be resolved is
    // redacted, never exposed.
    expect(sportScopeAllows('volleyball', undefined)).toBe(false)
    expect(sportScopeAllows('basketball', null)).toBe(false)
  })
})
