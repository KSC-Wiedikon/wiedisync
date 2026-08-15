/**
 * The entitlement figure a free member's CHF 0 dues invoice prints.
 *
 * These numbers never bill anybody — but they are printed on a document that
 * goes to a member, so "what would this have cost?" has to be defensible for
 * every shape the cohort actually has on prod: 94 free members across three
 * sektionen, 86 adults, three 16-year-olds, five children under 7, six with no
 * birthdate at all, and a club-level 'KSCW' bucket with no sport to price.
 */
import { describe, it, expect } from 'vitest'
import { pickRate, isExemptCategory, feeAgeBand, referenceBase } from '../finance-dues-reference.js'

// The live 2026/27 schedule (prod, 2026-08-15) with migration 323's licence
// split, trimmed to what these assert. Basketball is seeded 0 — the club has no
// Swiss Basketball figures yet, and a guessed split on a real invoice is worse
// than none.
const RATES = [
  { category: 'Gratis', sektion: null, amount_chf: '0.00', licence_chf: '0.00', active: true },
  { category: 'Kein Beitrag', sektion: null, amount_chf: '0.00', licence_chf: '0.00', active: true },
  { category: 'VB Erwerbstätige', sektion: null, amount_chf: '440.00', licence_chf: '110.00', active: true },
  { category: 'VB Student*in Meisterschaft', sektion: null, amount_chf: '380.00', licence_chf: '110.00', active: true },
  { category: 'VB Schüler*in Meisterschaft', sektion: null, amount_chf: '310.00', licence_chf: '60.00', active: true },
  { category: 'BB Erwerbstätige', sektion: null, amount_chf: '520.00', licence_chf: '0.00', active: true },
  { category: 'BB Lernende/Studierende', sektion: null, amount_chf: '420.00', licence_chf: '0.00', active: true },
  { category: 'BB Jugend Meisterschaft', sektion: null, amount_chf: '320.00', licence_chf: '0.00', active: true },
]
const YEAR = 2026
const member = (over) => ({ sektion: 'Volleyball', birthdate: '1990-05-04', ...over })

describe('isExemptCategory', () => {
  it("is 'Gratis' — a member the club decided not to charge", () => {
    expect(isExemptCategory('Gratis')).toBe(true)
    expect(isExemptCategory(' gratis ')).toBe(true)
  })

  // 'Kein Beitrag' is the terminal NON-member bucket (ehemalige, sponsors,
  // parents). Telling a sponsor their membership "would have cost CHF 440" is
  // wrong twice over — they have no membership and never asked for one.
  it("is NOT 'Kein Beitrag', and not a paying category", () => {
    expect(isExemptCategory('Kein Beitrag')).toBe(false)
    expect(isExemptCategory('VB Erwerbstätige')).toBe(false)
    expect(isExemptCategory(null)).toBe(false)
  })
})

describe('feeAgeBand', () => {
  it('splits the ladder at 10 / 16 / 20', () => {
    expect(feeAgeBand({ birthdate: '2022-01-01' }, YEAR)).toBe('infant')
    expect(feeAgeBand({ birthdate: '2017-01-01' }, YEAR)).toBe('infant')  // turns 9 in 2026
    expect(feeAgeBand({ birthdate: '2016-01-01' }, YEAR)).toBe('youth')   // turns 10 — the boundary
    expect(feeAgeBand({ birthdate: '2014-01-01' }, YEAR)).toBe('youth')
    expect(feeAgeBand({ birthdate: '2010-01-01' }, YEAR)).toBe('junior')
    expect(feeAgeBand({ birthdate: '2006-01-01' }, YEAR)).toBe('adult')
  })

  // 86 of the 94 free members on prod are adults, and 6 carry no birthdate.
  // Adult is the only band that is right without one.
  it('reads an unknown or unusable birthdate as adult', () => {
    expect(feeAgeBand({ birthdate: null }, YEAR)).toBe('adult')
    expect(feeAgeBand({}, YEAR)).toBe('adult')
    expect(feeAgeBand({ birthdate: '0001-01-01' }, YEAR)).toBe('adult')
  })

  it('accepts a Date as well as an ISO string (pg returns either)', () => {
    expect(feeAgeBand({ birthdate: new Date('2014-06-01') }, YEAR)).toBe('youth')
  })
})

describe('referenceBase', () => {
  it('prices an adult against their own sport, licence included in the base', () => {
    expect(referenceBase(RATES, member({ sektion: 'Volleyball' }), YEAR)).toEqual({ base: 440, licence: 110 })
    expect(referenceBase(RATES, member({ sektion: 'Basketball' }), YEAR)).toEqual({ base: 520, licence: 0 })
  })

  it('follows the age ladder', () => {
    expect(referenceBase(RATES, member({ sektion: 'Basketball', birthdate: '2010-03-02' }), YEAR)).toEqual({ base: 420, licence: 0 })
    expect(referenceBase(RATES, member({ sektion: 'Volleyball', birthdate: '2013-03-02' }), YEAR)).toEqual({ base: 310, licence: 60 })
  })

  // A CHF 320 "Jugend Meisterschaft" entitlement on a four-year-old's invoice is
  // noise, not information — the exemption line stands alone instead.
  it('gives an infant no reference', () => {
    expect(referenceBase(RATES, member({ sektion: 'Basketball', birthdate: '2022-07-01' }), YEAR)).toEqual({ base: 0, licence: 0 })
  })

  // 'KSCW' is the club-level bucket (Ehrenmitglieder, staff) — no sport, so no
  // comparable membership to quote.
  it('gives a sektion outside the two sports no reference', () => {
    expect(referenceBase(RATES, member({ sektion: 'KSCW' }), YEAR).base).toBe(0)
    expect(referenceBase(RATES, member({ sektion: null }), YEAR).base).toBe(0)
  })

  it('returns 0 when the mapped category has no rate this season', () => {
    const thin = RATES.filter((r) => r.category !== 'VB Erwerbstätige')
    expect(referenceBase(thin, member({ sektion: 'Volleyball' }), YEAR).base).toBe(0)
  })

  // The treasurer's escape hatch: for an exempt category the rate row can never
  // be a bill, so a non-zero one is read as "this is what a free membership is
  // worth". The live row is 0.00 and must NOT hijack the mapping.
  it('lets a non-zero Gratis rate row win, and ignores the live 0.00 one', () => {
    const pinned = [...RATES, { category: 'Gratis', sektion: 'Volleyball', amount_chf: '250.00', licence_chf: '0.00', active: true }]
    expect(referenceBase(pinned, member({ sektion: 'Volleyball' }), YEAR)).toEqual({ base: 250, licence: 0 })
    // …only for the sektion it names.
    expect(referenceBase(pinned, member({ sektion: 'Basketball' }), YEAR).base).toBe(520)
    // The club-wide 0.00 row falls through to the mapping rather than zeroing it.
    expect(referenceBase(RATES, member({ sektion: 'Volleyball' }), YEAR).base).toBe(440)
  })

  it('ignores an inactive rate row', () => {
    const off = RATES.map((r) => (r.category === 'VB Erwerbstätige' ? { ...r, active: false } : r))
    expect(referenceBase(off, member({ sektion: 'Volleyball' }), YEAR).base).toBe(0)
  })

  // The licence is carved OUT of the rate, so it can never exceed it — a bad
  // row would otherwise print a negative Mitgliederbeitrag position.
  it('never reports a licence larger than the base', () => {
    const silly = [{ category: 'VB Erwerbstätige', sektion: null, amount_chf: '100.00', licence_chf: '250.00', active: true }]
    expect(referenceBase(silly, member({ sektion: 'Volleyball' }), YEAR)).toEqual({ base: 100, licence: 100 })
  })

  it('reads a missing or unparseable licence column as no licence', () => {
    const old = [{ category: 'VB Erwerbstätige', sektion: null, amount_chf: '440.00', active: true }]
    expect(referenceBase(old, member({ sektion: 'Volleyball' }), YEAR)).toEqual({ base: 440, licence: 0 })
  })
})

describe('pickRate', () => {
  it('prefers a sektion row over the category default', () => {
    const rates = [
      { category: 'VB Erwerbstätige', sektion: null, amount_chf: '440.00', active: true },
      { category: 'VB Erwerbstätige', sektion: 'Volleyball', amount_chf: '400.00', active: true },
    ]
    expect(pickRate(rates, 'VB Erwerbstätige', 'Volleyball').amount_chf).toBe('400.00')
    expect(pickRate(rates, 'VB Erwerbstätige', 'Basketball').amount_chf).toBe('440.00')
    expect(pickRate(rates, 'VB Erwerbstätige', null).amount_chf).toBe('440.00')
  })

  it('matches the category case-insensitively and misses cleanly', () => {
    expect(pickRate(RATES, 'gratis', null).amount_chf).toBe('0.00')
    expect(pickRate(RATES, 'Nope', null)).toBe(null)
    expect(pickRate(undefined, 'Gratis', null)).toBe(null)
  })
})
