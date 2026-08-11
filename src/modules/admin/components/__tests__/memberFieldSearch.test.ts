import { describe, expect, it } from 'vitest'
import { rankMemberFields, memberFieldLabel } from '../memberFieldSearch'
import { MEMBER_FIELD_BY_KEY } from '../memberFieldSchema'

/** Keys of the top `n` matches, for terse assertions. */
function top(query: string, n = 3): string[] {
  return rankMemberFields(query).slice(0, n).map((m) => m.def.key)
}

describe('rankMemberFields', () => {
  it('returns nothing for an empty query', () => {
    // The dropdown shows its own hint instead — 110 unranked rows is the wall
    // this search exists to replace.
    expect(rankMemberFields('')).toEqual([])
    expect(rankMemberFields('   ')).toEqual([])
  })

  it('finds the AHV number by its abbreviation', () => {
    expect(top('ahv')).toContain('ahv_nummer')
  })

  it('finds the AHV number by the two-word query the user actually types', () => {
    expect(top('ahv number')).toContain('ahv_nummer')
  })

  it('finds the birthdate in German as well as English', () => {
    expect(top('birthdate')).toContain('birthdate')
    expect(top('geburtsdatum')).toContain('birthdate')
    expect(top('birthday')).toContain('birthdate')
  })

  it('treats "license" and "licence" as the same word', () => {
    const uk = rankMemberFields('licence').map((m) => m.def.key)
    const us = rankMemberFields('license').map((m) => m.def.key)
    expect(us).toEqual(uk)
    expect(uk.length).toBeGreaterThan(1)
  })

  it('surfaces the scorer licence for a licence query', () => {
    expect(rankMemberFields('licence', 30).map((m) => m.def.key)).toContain('scorer_vb')
  })

  it('ANDs the words of a multi-word query', () => {
    // "scorer" alone hits several fields; "scorer licence" must still hit the
    // flag, and must not return a field that matches only one of the two.
    const keys = rankMemberFields('scorer licence').map((m) => m.def.key)
    expect(keys).toContain('scorer_vb')
    expect(keys).not.toContain('birthdate')
  })

  it('ranks an exact label above a substring hit', () => {
    const results = rankMemberFields('iban')
    expect(results[0]?.def.key).toBe('iban')
  })

  it('returns no more than the limit', () => {
    expect(rankMemberFields('e', 5)).toHaveLength(5)
  })

  it('only ever returns real member fields', () => {
    for (const m of rankMemberFields('licence', 40)) {
      expect(MEMBER_FIELD_BY_KEY[m.def.key]).toBeDefined()
    }
  })

  it('carries the group label for the dropdown subtitle', () => {
    const ahv = rankMemberFields('ahv')[0]
    expect(ahv?.groupLabel).toBe('Finance & billing')
  })
})

describe('memberFieldLabel', () => {
  it('resolves a known key to its schema label', () => {
    expect(memberFieldLabel('ahv_nummer')).toBe('AHV number')
  })

  it('falls back to the key itself for an unknown column', () => {
    expect(memberFieldLabel('not_a_column')).toBe('not_a_column')
  })
})
