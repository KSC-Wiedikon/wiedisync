import { describe, it, expect } from 'vitest'
import { buildMemberGroups, countMembers, sportsForMember, type MemberGroupCache, type MemberGroupNode } from './memberGroups'

const TEAMS = [
  { id: 1, sport: 'volleyball', name: 'D1', active: true },
  { id: 2, sport: 'volleyball', name: 'D2', active: true },
  // ⚠ A basketball team whose NAME reads volleyball. Only `sport` decides.
  { id: 3, sport: 'basketball', name: 'Herren 2 H3', active: true },
  { id: 4, sport: 'basketball', name: 'HU14', active: false },
]

function cacheOf(opts: {
  players?: Record<string, string[]>
  coaches?: Record<string, string[]>
  responsibles?: Record<string, string[]>
} = {}): MemberGroupCache {
  return {
    teams: TEAMS,
    memberTeams: new Map(Object.entries(opts.players ?? {})),
    memberCoachTeams: new Map(Object.entries(opts.coaches ?? {})),
    memberTrTeams: new Map(Object.entries(opts.responsibles ?? {})),
  }
}

/** Flatten a built tree to `key -> member ids`, for readable assertions. */
function flatten(nodes: MemberGroupNode[], prefix = ''): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const n of nodes) {
    const key = prefix ? `${prefix}/${n.key}` : n.key
    if (n.memberIds) out[key] = n.memberIds
    if (n.children) Object.assign(out, flatten(n.children, key))
  }
  return out
}

describe('sportsForMember', () => {
  it('reads the sport off the team, never off its name', () => {
    const cache = cacheOf({ players: { '1': ['3'] } })
    expect(sportsForMember({ id: 1 }, cache)).toEqual(['basketball'])
  })

  /**
   * ⚠ The bug this whole module exists for. A member with no roster row used to
   * land in "Other" even with a section on record — three real members did.
   */
  it('falls back to sektion, then to the fee category', () => {
    expect(sportsForMember({ id: 1, sektion: 'Volleyball' }, cacheOf())).toEqual(['volleyball'])
    expect(sportsForMember({ id: 2, beitragskategorie: 'BB Jugend Meisterschaft' }, cacheOf())).toEqual(['basketball'])
  })

  it('counts a coach as their team, though coaches hold no roster row', () => {
    const cache = cacheOf({ coaches: { '9': ['1'] } })
    expect(sportsForMember({ id: 9 }, cache)).toEqual(['volleyball'])
  })

  it('spreads a genuine two-sport player across both, but never a club-level member', () => {
    expect(sportsForMember({ id: 1 }, cacheOf({ players: { '1': ['1', '3'] } })))
      .toEqual(['volleyball', 'basketball'])
    // sektion KSCW resolves to 'both' as a FIELD GATE, but says nothing about
    // sport — it must not put a committee member on two sport rosters.
    expect(sportsForMember({ id: 2, sektion: 'KSCW' }, cacheOf())).toEqual([])
    expect(sportsForMember({ id: 3 }, cacheOf())).toEqual([])
  })
})

describe('buildMemberGroups', () => {
  it('files a member under every group they qualify for', () => {
    const cache = cacheOf({ players: { '1': ['1'] }, coaches: { '1': ['1'] } })
    const m = { id: 1, sektion: 'Volleyball', role: ['user', 'vorstand'], scorer_vb: true }
    const g = flatten(buildMemberGroups([m], [m], cache))
    expect(g['sport:volleyball/sport:volleyball:teams/sport:volleyball:team:1']).toEqual(['1'])
    expect(g['sport:volleyball/officials:vb/officials:vb:scorers']).toEqual(['1'])
    expect(g['sport:volleyball/staff:volleyball/staff:volleyball:coaches']).toEqual(['1'])
    expect(g['club:vorstand']).toEqual(['1'])
  })

  it('puts a section member with no roster row under the sport\'s "Other", not "Unassigned"', () => {
    const m = { id: 7, sektion: 'Volleyball', beitragskategorie: 'Passivmitglied' }
    const g = flatten(buildMemberGroups([m], [m], cacheOf()))
    expect(g['sport:volleyball/sport:volleyball:other']).toEqual(['7'])
    expect(g['club:unassigned']).toBeUndefined()
  })

  /**
   * ⚠ Register-status groups read the UNFILTERED list. The page defaults to
   * `kscw_membership_active = yes`, so sourcing them from the working set would
   * make "Former members" permanently empty — the exact failure that made this
   * group worth loading extra rows for.
   */
  it('builds register-status groups from all members, ignoring the page filters', () => {
    const active = { id: 1, sektion: 'Volleyball' }
    const departed = { id: 2, register_status: 'Ehemaliges Mitglied', kscw_membership_active: false }
    const g = flatten(buildMemberGroups([active], [active, departed], cacheOf()))
    expect(g['club:former']).toEqual(['2'])
    // ...while sport groups stay narrowed to the working set.
    expect(g['sport:volleyball/sport:volleyball:other']).toEqual(['1'])
  })

  it('keeps the OTR/OTN grades separate and lets one member hold several', () => {
    const m = { id: 5, otr1_bb: true, otr2_bb: true, sektion: 'Basketball' }
    const g = flatten(buildMemberGroups([m], [m], cacheOf()))
    expect(g['sport:basketball/officials:bb/officials:bb:otr1']).toEqual(['5'])
    expect(g['sport:basketball/officials:bb/officials:bb:otr2']).toEqual(['5'])
    expect(g['sport:basketball/officials:bb/officials:bb:otn1']).toBeUndefined()
  })

  it('reads role from a JSON string as well as an array', () => {
    const m = { id: 6, role: '["user","vorstand"]' }
    const g = flatten(buildMemberGroups([m], [m], cacheOf()))
    expect(g['club:vorstand']).toEqual(['6'])
  })

  it('omits inactive teams so the parallel BB squads are not listed twice', () => {
    const m = { id: 8 }
    const cache = cacheOf({ players: { '8': ['4'] } })
    const g = flatten(buildMemberGroups([m], [m], cache))
    expect(Object.keys(g).some((k) => k.includes('team:4'))).toBe(false)
  })

  it('drops empty groups but keeps whoever it genuinely cannot place', () => {
    const m = { id: 9 }
    const nodes = buildMemberGroups([m], [m], cacheOf())
    const g = flatten(nodes)
    expect(g['club:unassigned']).toEqual(['9'])
    expect(g['club:honorary']).toBeUndefined()
    expect(nodes.every((n) => countMembers(n) > 0)).toBe(true)
  })

  it('gives each sport its own Teams / Officials / Staff / Other', () => {
    const cache = cacheOf({ players: { '1': ['1'] }, coaches: { '2': ['1'] } })
    const a = { id: 1, scorer_vb: true }
    const b = { id: 2 }
    const vb = buildMemberGroups([a, b], [a, b], cache).find((n) => n.key === 'sport:volleyball')!
    expect(vb.children!.map((c) => c.key)).toEqual([
      'sport:volleyball:teams',
      'officials:vb',
      'staff:volleyball',
    ])
  })

  /**
   * ⚠ "Other" is a RESIDUE, not "has no team". A scorer without a squad is
   * already findable under Officials, and repeating them here would pad the one
   * list people scan for the unexplained.
   */
  it('keeps a member out of "Other" when another branch already accounts for them', () => {
    const scorer = { id: 1, sektion: 'Volleyball', scorer_vb: true }
    const plain = { id: 2, sektion: 'Volleyball' }
    const g = flatten(buildMemberGroups([scorer, plain], [scorer, plain], cacheOf()))
    expect(g['sport:volleyball/officials:vb/officials:vb:scorers']).toEqual(['1'])
    expect(g['sport:volleyball/sport:volleyball:other']).toEqual(['2'])
  })

  /**
   * ⚠ Distinct, not summed. Overlapping leaves are the design — one person can
   * hold OTR1 and OTR2, or play for two squads. Summing made "Basketball" read
   * 494 against a section of 314 on prod.
   */
  it('counts a branch distinctly, not as the sum of its leaves', () => {
    const both = { id: 1, otr1_bb: true, otr2_bb: true }
    const one = { id: 2, otr2_bb: true }
    const nodes = buildMemberGroups([both, one], [both, one], cacheOf())
    const bb = nodes.find((n) => n.key === 'sport:basketball')!
      .children!.find((n) => n.key === 'officials:bb')!
    expect(countMembers(bb)).toBe(2)
    expect(bb.children!.reduce((n, c) => n + countMembers(c), 0)).toBe(3)
  })
})
