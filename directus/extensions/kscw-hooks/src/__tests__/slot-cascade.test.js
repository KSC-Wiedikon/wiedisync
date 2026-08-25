/**
 * Unit tests for the hall-slot → trainings generation WINDOW rule.
 *
 * The invariant these lock down: `valid_until` is the bound whenever it is set,
 * `indefinite` or not. `indefinite` only decides what happens when a slot has NO
 * end date, and it is then the ONLY case where nothing may be trimmed off the
 * tail (the rolling horizon is soft and the nightly top-up keeps moving it).
 *
 * Regression this covers: treating every indefinite slot as open-ended left the
 * 2026/27 season materialised to today+12 weeks while the Hallenplan ran to
 * 17.08.2027, so the J+S activity export stopped mid-November.
 *
 * Hermetic — pure functions, no DB or network.
 */
import { describe, it, expect } from 'vitest'
import { effectiveEnd, validityEnd } from '../slot-cascade.js'

const MAX_GENERATION_DAYS = 400
const INDEFINITE_HORIZON_WEEKS = 12

function daysFromToday(n) {
  const d = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

describe('validityEnd — the bound trimming may delete against', () => {
  it('is valid_until whenever it is set, indefinite or not', () => {
    expect(validityEnd({ indefinite: true, valid_until: '2027-08-17' })).toBe('2027-08-17')
    expect(validityEnd({ indefinite: false, valid_until: '2027-05-31' })).toBe('2027-05-31')
  })
  it('is null for a genuinely open-ended slot — nothing may be trimmed', () => {
    expect(validityEnd({ indefinite: true, valid_until: null })).toBeNull()
  })
  it('falls back to season-end for a legacy dateless bounded slot', () => {
    expect(validityEnd({ indefinite: false, valid_until: null })).toMatch(/^\d{4}-05-31$/)
  })
})

describe('effectiveEnd — the bound generation reaches', () => {
  it('generates an indefinite slot to its explicit valid_until, not today+12w', () => {
    const end = daysFromToday(300)
    expect(effectiveEnd({ indefinite: true, valid_until: end })).toBe(end)
  })
  it('rides the rolling horizon only when there is no end date', () => {
    expect(effectiveEnd({ indefinite: true, valid_until: null }))
      .toBe(daysFromToday(INDEFINITE_HORIZON_WEEKS * 7))
  })
  it('clamps a far-future end date so one pass cannot insert decades of rows', () => {
    expect(effectiveEnd({ indefinite: true, valid_until: '2099-12-31' }))
      .toBe(daysFromToday(MAX_GENERATION_DAYS))
  })
  it('stops generating once an indefinite slot has expired (no trailing phantoms)', () => {
    // Range collapses to start > end, so expectedDates yields nothing.
    expect(effectiveEnd({ indefinite: true, valid_until: '2020-06-30' })).toBe('2020-06-30')
  })
  it('leaves bounded slots exactly as before — unclamped, valid_until or season-end', () => {
    expect(effectiveEnd({ indefinite: false, valid_until: '2099-12-31' })).toBe('2099-12-31')
    expect(effectiveEnd({ indefinite: false, valid_until: null })).toMatch(/^\d{4}-05-31$/)
  })
})
