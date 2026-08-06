// Unit gate for the phone-prefix data + parser. `splitDialCode` is the only
// piece of PhoneInput with real logic — everything else delegates to
// `normalizePhone`, which has its own parity harness against the backend.
import { describe, it, expect } from 'vitest'
import { COUNTRIES } from '../../../utils/countries.generated'
import { DIAL_CODES, FAVORITE_DIAL_CODES, dialCodeFor, splitDialCode } from '../dialCodes'

describe('DIAL_CODES', () => {
  it('covers every country in the generated list', () => {
    const covered = new Set(DIAL_CODES.map((d) => d.code))
    const missing = COUNTRIES.map((c) => c.code).filter((code) => !covered.has(code))
    expect(missing).toEqual([])
  })

  it('is sorted by English name', () => {
    const names = DIAL_CODES.map((d) => d.name)
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'en')))
  })

  it('stores the calling code without a plus and as digits only', () => {
    for (const d of DIAL_CODES) expect(d.dial).toMatch(/^[1-9][0-9]{0,3}$/)
  })

  it('gives every entry an uppercase ISO-2 code and a flag', () => {
    for (const d of DIAL_CODES) {
      expect(d.code).toMatch(/^[A-Z]{2}$/)
      expect(d.flag.length).toBeGreaterThan(0)
    }
  })

  it('has no duplicate country codes', () => {
    expect(new Set(DIAL_CODES.map((d) => d.code)).size).toBe(DIAL_CODES.length)
  })

  it('lists every favourite', () => {
    for (const code of FAVORITE_DIAL_CODES) expect(dialCodeFor(code)).toBeDefined()
  })

  it('knows the codes the club actually uses', () => {
    expect(dialCodeFor('CH')?.dial).toBe('41')
    expect(dialCodeFor('DE')?.dial).toBe('49')
    expect(dialCodeFor('FR')?.dial).toBe('33')
    expect(dialCodeFor('AT')?.dial).toBe('43')
    expect(dialCodeFor('IT')?.dial).toBe('39')
    expect(dialCodeFor('LI')?.dial).toBe('423')
  })
})

describe('dialCodeFor', () => {
  it('is case- and whitespace-insensitive', () => {
    expect(dialCodeFor(' ch ')?.code).toBe('CH')
    expect(dialCodeFor('Ch')?.code).toBe('CH')
  })

  it('returns undefined for junk', () => {
    expect(dialCodeFor(null)).toBeUndefined()
    expect(dialCodeFor(undefined)).toBeUndefined()
    expect(dialCodeFor('')).toBeUndefined()
    expect(dialCodeFor('ZZ')).toBeUndefined()
  })
})

describe('splitDialCode', () => {
  it('splits the canonical Swiss shape and keeps the grouping', () => {
    expect(splitDialCode('+41 79 123 45 67')).toEqual({ dial: '41', national: '79 123 45 67' })
  })

  it('defaults a bare national number to +41 and keeps the trunk zero', () => {
    expect(splitDialCode('079 123 45 67')).toEqual({ dial: '41', national: '079 123 45 67' })
  })

  it('defaults an empty value to +41', () => {
    expect(splitDialCode('')).toEqual({ dial: '41', national: '' })
    expect(splitDialCode(null)).toEqual({ dial: '41', national: '' })
    expect(splitDialCode(undefined)).toEqual({ dial: '41', national: '' })
    expect(splitDialCode('   ')).toEqual({ dial: '41', national: '' })
  })

  it('handles the 00 international prefix', () => {
    expect(splitDialCode('0041 79 123 45 67')).toEqual({ dial: '41', national: '79 123 45 67' })
    expect(splitDialCode('0049 170 1234567')).toEqual({ dial: '49', national: '170 1234567' })
  })

  it('splits compact E.164 foreign numbers', () => {
    expect(splitDialCode('+436501234567')).toEqual({ dial: '43', national: '6501234567' })
    expect(splitDialCode('+390612345678')).toEqual({ dial: '39', national: '0612345678' })
  })

  it('prefers the longest matching prefix', () => {
    // Liechtenstein is 423, not 4 + something; Antigua is 1268, not bare 1.
    expect(splitDialCode('+4237712345').dial).toBe('423')
    expect(splitDialCode('+12687641234').dial).toBe('1268')
    expect(splitDialCode('+15551234567').dial).toBe('1')
  })

  it('does not consume separators into the calling code', () => {
    expect(splitDialCode('+43 650 123 45 67')).toEqual({ dial: '43', national: '650 123 45 67' })
    expect(splitDialCode('+1 555 010 0000')).toEqual({ dial: '1', national: '555 010 0000' })
  })

  it('keeps an unknown calling code intact so normalizePhone still sees E.164', () => {
    expect(splitDialCode('+9991234567')).toEqual({ dial: '41', national: '+9991234567' })
  })

  it('round-trips: dial + national recomposes to the original digits', () => {
    for (const raw of ['+41 79 123 45 67', '+436501234567', '+4237712345', '+12687641234']) {
      const { dial, national } = splitDialCode(raw)
      expect(`+${dial}${national}`.replace(/\D/g, '')).toBe(raw.replace(/\D/g, ''))
    }
  })
})
