import { describe, it, expect } from 'vitest'
import {
  TRAINER_LICENCE_CODES,
  TRAINER_LICENCE_CODES_BY_SPORT,
  parseTrainerLicences,
  serializeTrainerLicences,
  TRAINER_LICENCE_I18N_KEYS,
} from './trainerLicences'

describe('parseTrainerLicences', () => {
  it('returns [] for the empty states', () => {
    expect(parseTrainerLicences(null)).toEqual([])
    expect(parseTrainerLicences(undefined)).toEqual([])
    expect(parseTrainerLicences('')).toEqual([])
    expect(parseTrainerLicences('   ')).toEqual([])
  })

  it('parses a single code', () => {
    expect(parseTrainerLicences('JS')).toEqual(['JS'])
    expect(parseTrainerLicences('A')).toEqual(['A'])
  })

  it('normalizes case and whitespace', () => {
    expect(parseTrainerLicences(' js , b ')).toEqual(['JS', 'B'])
  })

  it('sorts into canonical JS,C,B,A,T1,T2,T3 order regardless of input order', () => {
    expect(parseTrainerLicences('A,B,C,JS')).toEqual(['JS', 'C', 'B', 'A'])
    expect(parseTrainerLicences('B,JS')).toEqual(['JS', 'B'])
    // Basketball rungs sort after the volleyball ones (migration 281).
    expect(parseTrainerLicences('T2,JS')).toEqual(['JS', 'T2'])
    expect(parseTrainerLicences('T3,T1,A')).toEqual(['A', 'T1', 'T3'])
  })

  it('accepts the basketball rungs as first-class codes, not synonyms of C/B/A', () => {
    expect(parseTrainerLicences('T1')).toEqual(['T1'])
    expect(parseTrainerLicences(' t2 ')).toEqual(['T2'])
    // Holding both ladders is legal — a coach may be qualified in both sports.
    expect(parseTrainerLicences('B,T2')).toEqual(['B', 'T2'])
    // 'T' alone and a bare digit are not rungs.
    expect(parseTrainerLicences('T')).toEqual([])
    expect(parseTrainerLicences('2')).toEqual([])
    expect(parseTrainerLicences('T4')).toEqual([])
  })

  it('de-duplicates', () => {
    expect(parseTrainerLicences('C,C,c')).toEqual(['C'])
  })

  it('drops tokens outside the closed set — the DB CHECK makes them corrupt data, not values to render', () => {
    expect(parseTrainerLicences('JS,D,B')).toEqual(['JS', 'B'])
    expect(parseTrainerLicences('D')).toEqual([])
    // Not a substring match: 'ABC' is not 'A' + 'B' + 'C'.
    expect(parseTrainerLicences('ABC')).toEqual([])
  })

  it('ignores empty segments from sloppy separators', () => {
    expect(parseTrainerLicences('JS,,B,')).toEqual(['JS', 'B'])
  })
})

describe('serializeTrainerLicences', () => {
  it('stores NULL, not an empty string, for an empty selection', () => {
    expect(serializeTrainerLicences([])).toBeNull()
    expect(serializeTrainerLicences(['D'])).toBeNull()
  })

  it('emits canonical order so the value is stable across saves', () => {
    expect(serializeTrainerLicences(['A', 'JS'])).toBe('JS,A')
    expect(serializeTrainerLicences(['B', 'C', 'JS', 'A'])).toBe('JS,C,B,A')
    expect(serializeTrainerLicences(['T2', 'JS'])).toBe('JS,T2')
  })

  it('round-trips through parse unchanged', () => {
    for (const stored of ['JS', 'JS,C', 'JS,C,B,A', 'B,A', 'JS,T2', 'T1,T3', 'C,T2']) {
      expect(serializeTrainerLicences(parseTrainerLicences(stored)))
        .toBe(serializeTrainerLicences(stored.split(',')))
    }
  })

  it('produces values the DB CHECK accepts', () => {
    // Mirrors members_trainer_licences_fmt (migration 281) verbatim — if this
    // regex and the migration drift, a save the UI allows will abort on INSERT.
    const dbCheck = /^(JS|C|B|A|T1|T2|T3)(,(JS|C|B|A|T1|T2|T3))*$/
    expect(serializeTrainerLicences([...TRAINER_LICENCE_CODES])).toMatch(dbCheck)
    expect(serializeTrainerLicences(['js', ' b '])).toMatch(dbCheck)
    expect(serializeTrainerLicences(['t2', 'JS'])).toMatch(dbCheck)
  })

  it('stays inside the column width — varchar(20), migration 274', () => {
    expect(serializeTrainerLicences([...TRAINER_LICENCE_CODES])!.length).toBeLessThanOrEqual(20)
  })
})

describe('TRAINER_LICENCE_CODES_BY_SPORT', () => {
  it('splits the two federation ladders without overlap', () => {
    const vb = TRAINER_LICENCE_CODES_BY_SPORT.volleyball
    const bb = TRAINER_LICENCE_CODES_BY_SPORT.basketball
    expect(vb.some((c) => bb.includes(c))).toBe(false)
  })

  it('accounts for every rung — a new code must be filed under a sport', () => {
    // J+S is federal and deliberately in neither list; everything else is a
    // federation rung and must belong to exactly one ladder, or the profile
    // picker would silently stop offering it.
    const filed = new Set([
      ...TRAINER_LICENCE_CODES_BY_SPORT.volleyball,
      ...TRAINER_LICENCE_CODES_BY_SPORT.basketball,
    ])
    for (const code of TRAINER_LICENCE_CODES) {
      if (code === 'JS') continue
      expect(filed.has(code)).toBe(true)
    }
    expect(filed.has('JS' as never)).toBe(false)
  })
})

describe('TRAINER_LICENCE_I18N_KEYS', () => {
  it('covers every code — a missing key would render the raw token to the user', () => {
    for (const code of TRAINER_LICENCE_CODES) {
      expect(TRAINER_LICENCE_I18N_KEYS[code]).toBeTruthy()
    }
  })
})
