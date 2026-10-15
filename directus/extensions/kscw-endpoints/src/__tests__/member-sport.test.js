import { describe, expect, it } from 'vitest'
import {
  sportFromParts, sportFromPartsDetailed, resolveMemberSports,
  resolveMemberSportsDetailed, resolveMemberSport,
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
    { id: 10, club_section: null, fee_category: null },
    { id: 11, club_section: null, fee_category: null },
    { id: 12, club_section: null, fee_category: null },
    { id: 13, club_section: null, fee_category: null },
    { id: 14, club_section: null, fee_category: null },
    { id: 15, club_section: 'Basketball', fee_category: null },
    { id: 20, club_section: 'Volleyball', fee_category: null },
    { id: 21, club_section: 'KSCW', fee_category: 'BB Jugend Meisterschaft' },
    { id: 22, club_section: null, fee_category: 'VB Erwerbstätige' },
    { id: 23, club_section: null, fee_category: 'Gratis' },
    { id: 24, club_section: null, fee_category: null },
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
    expect(sportFromParts({ teamSports: [null], club_section: 'Basketball' })).toBe('basketball')
  })

  it('teams outrank club_section — the team is the fact', () => {
    expect(sportFromParts({ teamSports: ['basketball'], club_section: 'Volleyball' })).toBe('basketball')
  })

  it('falls back to club_section, case-insensitively', () => {
    expect(sportFromParts({ club_section: 'Volleyball' })).toBe('volleyball')
    expect(sportFromParts({ club_section: '  basketball ' })).toBe('basketball')
  })

  it('falls back to the fee-category prefix when club_section is club-level', () => {
    expect(sportFromParts({ club_section: 'KSCW', fee_category: 'BB Jugend Meisterschaft' })).toBe('basketball')
    expect(sportFromParts({ fee_category: 'VB Erwerbstätige' })).toBe('volleyball')
  })

  it('is "both" when nothing resolves — permissive on purpose', () => {
    expect(sportFromParts({})).toBe('both')
    expect(sportFromParts({ fee_category: 'Gratis' })).toBe('both')
    expect(sportFromParts({ club_section: 'KSCW' })).toBe('both')
  })

  it('does not match a category that merely contains vb/bb', () => {
    // The rule is a PREFIX. 'Aktivmitglied VB' is not a volleyball marker.
    expect(sportFromParts({ fee_category: 'Aktivmitglied VB' })).toBe('both')
  })
})

describe('sportFromPartsDetailed', () => {
  // The whole reason this form exists: `sport: 'both'` is TWO different facts.
  // A UI that buckets members by section must be able to tell "plays volleyball
  // AND basketball" from "we cannot work out their section at all", and the
  // answer alone cannot.
  it('separates genuinely dual-sport from unresolvable, which both answer "both"', () => {
    const dual = sportFromPartsDetailed({ teamSports: ['volleyball', 'basketball'] })
    const unknown = sportFromPartsDetailed({})
    expect(dual).toEqual({ sport: 'both', source: 'teams' })
    expect(unknown).toEqual({ sport: 'both', source: 'unknown' })
    // …and are indistinguishable through the plain form, on purpose.
    expect(sportFromParts({ teamSports: ['volleyball', 'basketball'] }))
      .toBe(sportFromParts({}))
  })

  it('reports which input decided', () => {
    expect(sportFromPartsDetailed({ teamSports: ['volleyball'] }).source).toBe('teams')
    expect(sportFromPartsDetailed({ club_section: 'Basketball' }).source).toBe('sektion')
    expect(sportFromPartsDetailed({ fee_category: 'VB Erwerbstätige' }).source).toBe('fee')
    expect(sportFromPartsDetailed({ fee_category: 'Gratis' }).source).toBe('unknown')
  })

  it('never changes the answer the plain form gives', () => {
    // The gates (permissions, the read-privacy hook, the member DELETE guard) all
    // read `sportFromParts`. Adding the detail must not move a single verdict.
    const cases = [
      { teamSports: ['volleyball'] },
      { teamSports: ['volleyball', 'basketball'] },
      { teamSports: [null], club_section: 'Basketball' },
      { teamSports: ['basketball'], club_section: 'Volleyball' },
      { club_section: 'KSCW', fee_category: 'BB Jugend Meisterschaft' },
      { fee_category: 'Aktivmitglied VB' },
      {},
    ]
    for (const c of cases) {
      expect(sportFromParts(c)).toBe(sportFromPartsDetailed(c).sport)
    }
  })
})

describe('resolveMemberSportsDetailed (batched)', () => {
  // The rule, batched. The SQL twin (migration 406 kscw_member_sport_section)
  // must answer exactly these cases too.
  const sportsOf = async (db, ids) => {
    const detailed = await resolveMemberSportsDetailed(db, ids)
    return new Map([...detailed].map(([k, v]) => [k, v.sport]))
  }

  it('carries the source through', async () => {
    const db = fakeDb(TABLES)
    // 22 = fee-category-only volleyball, 24 = nothing resolvable.
    const detailed = await resolveMemberSportsDetailed(db, [22, 24])
    expect(detailed.get('22')).toEqual({ sport: 'volleyball', source: 'fee' })
    expect(detailed.get('24')).toEqual({ sport: 'both', source: 'unknown' })
  })

  it('resolves players, coaches and team responsibles', async () => {
    const map = await sportsOf(fakeDb(TABLES), [10, 11, 12, 13, 14])
    expect(map.get('10')).toBe('volleyball')
    expect(map.get('11')).toBe('basketball')
    expect(map.get('12')).toBe('both')
    // ⚠ A coach has NO roster row — a player-only join would call this "no team".
    expect(map.get('13')).toBe('basketball')
    expect(map.get('14')).toBe('volleyball')
  })

  it('uses sektion / category for members with no team', async () => {
    const map = await sportsOf(fakeDb(TABLES), [15, 20, 21, 22, 23])
    // 15 sits on a team with no sport set — falls through to sektion.
    expect(map.get('15')).toBe('basketball')
    expect(map.get('20')).toBe('volleyball')
    expect(map.get('21')).toBe('basketball')
    expect(map.get('22')).toBe('volleyball')
    expect(map.get('23')).toBe('both')
  })

  it('returns an entry for every id asked for, defaulting to both', async () => {
    const map = await sportsOf(fakeDb(TABLES), [24, 999])
    expect(map.get('24')).toBe('both')
    expect(map.get('999')).toBe('both')
  })

  it('runs a fixed number of queries regardless of page size', async () => {
    const small = fakeDb(TABLES)
    await resolveMemberSportsDetailed(small, [10])
    const big = fakeDb(TABLES)
    await resolveMemberSportsDetailed(big, [10, 11, 12, 13, 14, 20, 21, 22, 23, 24])
    // 3 junctions + teams + members === 5, and it must not grow with the input.
    expect(big.calls.length).toBe(small.calls.length)
    expect(big.calls.length).toBeLessThanOrEqual(5)
  })

  it('skips its own members query when rows are supplied', async () => {
    const db = fakeDb(TABLES)
    const detailed = await resolveMemberSportsDetailed(db, [21], { memberRows: TABLES.members })
    expect(detailed.get('21').sport).toBe('basketball')
    expect(db.calls).not.toContain('members')
  })

  it('matches ids across string/number forms', async () => {
    const map = await sportsOf(fakeDb(TABLES), ['10'])
    expect(map.get('10')).toBe('volleyball')
  })
})

describe('resolveMemberSports (the stored answer, migration 406)', () => {
  // Permission callers read members.sport_section — the same value the
  // KSCW Sport Admin VB / BB policy rows filter on — never the rule itself.
  const STORED = {
    members: [
      { id: 10, permissions_section: 'volleyball' },
      { id: 11, permissions_section: 'basketball' },
      { id: 12, permissions_section: 'both' },
      { id: 13, permissions_section: 'not-a-sport' },
    ],
  }

  it('returns the stored section, one members query, no junction reads', async () => {
    const db = fakeDb(STORED)
    const map = await resolveMemberSports(db, [10, 11, 12])
    expect(map.get('10')).toBe('volleyball')
    expect(map.get('11')).toBe('basketball')
    expect(map.get('12')).toBe('both')
    expect(db.calls).toEqual(['members'])
  })

  it('answers both for an unknown id or an unexpected value', async () => {
    const map = await resolveMemberSports(fakeDb(STORED), [13, 999])
    expect(map.get('13')).toBe('both')
    expect(map.get('999')).toBe('both')
  })

  it('uses supplied rows only when they carry sport_section', async () => {
    const withCol = fakeDb(STORED)
    const map = await resolveMemberSports(withCol, [11], { memberRows: [{ id: 11, permissions_section: 'basketball' }] })
    expect(map.get('11')).toBe('basketball')
    expect(withCol.calls).toHaveLength(0)

    // Rows fetched for something else (no sport_section) are not trusted.
    const without = fakeDb(STORED)
    const again = await resolveMemberSports(without, [11], { memberRows: [{ id: 11, club_section: 'Volleyball' }] })
    expect(again.get('11')).toBe('basketball')
    expect(without.calls).toEqual(['members'])
  })

  it('is empty for an empty id list and issues no queries', async () => {
    const db = fakeDb(STORED)
    expect((await resolveMemberSports(db, [])).size).toBe(0)
    expect(db.calls).toHaveLength(0)
  })

  it('matches ids across string/number forms', async () => {
    const map = await resolveMemberSports(fakeDb(STORED), ['10', 10])
    expect(map.size).toBe(1)
    expect(map.get('10')).toBe('volleyball')
  })

  it('single-member form agrees with the batched one', async () => {
    expect(await resolveMemberSport(fakeDb(STORED), 11)).toBe('basketball')
    expect(await resolveMemberSport(fakeDb(STORED), 999)).toBe('both')
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
