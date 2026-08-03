import { describe, it, expect } from 'vitest'
import {
  TRAINER_LICENCE_CODES,
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

  it('sorts into canonical JS,C,B,A order regardless of input order', () => {
    expect(parseTrainerLicences('A,B,C,JS')).toEqual(['JS', 'C', 'B', 'A'])
    expect(parseTrainerLicences('B,JS')).toEqual(['JS', 'B'])
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
  })

  it('round-trips through parse unchanged', () => {
    for (const stored of ['JS', 'JS,C', 'JS,C,B,A', 'B,A']) {
      expect(serializeTrainerLicences(parseTrainerLicences(stored)))
        .toBe(serializeTrainerLicences(stored.split(',')))
    }
  })

  it('produces values the DB CHECK accepts', () => {
    const dbCheck = /^(JS|C|B|A)(,(JS|C|B|A))*$/
    expect(serializeTrainerLicences([...TRAINER_LICENCE_CODES])).toMatch(dbCheck)
    expect(serializeTrainerLicences(['js', ' b '])).toMatch(dbCheck)
  })
})

describe('TRAINER_LICENCE_I18N_KEYS', () => {
  it('covers every code — a missing key would render the raw token to the user', () => {
    for (const code of TRAINER_LICENCE_CODES) {
      expect(TRAINER_LICENCE_I18N_KEYS[code]).toBeTruthy()
    }
  })
})
