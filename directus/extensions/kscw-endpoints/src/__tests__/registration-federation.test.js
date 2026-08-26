/**
 * Unit tests for the volleyball federation-of-origin gate (registration.js) —
 * the server-side twin of the client form gate (kscw-website
 * registration-form.js, 2026-07-27). Exists because REG-2026-6400 arrived with
 * federation_of_origin NULL the day AFTER the client gate shipped: the
 * submitter's browser ran a stale cached bundle, which client-side validation
 * can never rule out.
 *
 * Also covers normalizeFederation: the column carries a CHECK constraint and
 * the route is an anonymous POST, so junk must become NULL (→ rejected by the
 * gate), never a 500 out of the database.
 *
 * Hermetic — pure functions, no DB or network.
 */
import { describe, it, expect } from 'vitest'
import { normalizeFederation, vbFederationMissing } from '../registration.js'

describe('normalizeFederation', () => {
  it('keeps ISO alpha-2 codes, case- and whitespace-insensitively', () => {
    expect(normalizeFederation('CH')).toBe('CH')
    expect(normalizeFederation(' ch ')).toBe('CH')
    expect(normalizeFederation('af')).toBe('AF')
  })

  it("folds the retired 'NONE' sentinel into CH rather than rejecting it", () => {
    // Migration 342: "nobody has licensed me yet" means the first licence is
    // the one being issued here, i.e. Swiss Volley / Swiss Basketball. A cached
    // form bundle can still send the old value; a 400 there would cost the
    // applicant everything they typed.
    expect(normalizeFederation('NONE')).toBe('CH')
    expect(normalizeFederation('none')).toBe('CH')
  })

  it('normalizes everything else to NULL — junk must never reach the CHECK', () => {
    expect(normalizeFederation('')).toBe(null)
    expect(normalizeFederation(null)).toBe(null)
    expect(normalizeFederation(undefined)).toBe(null)
    expect(normalizeFederation('Schweiz')).toBe(null)
    expect(normalizeFederation('CHE')).toBe(null) // alpha-3 is not the contract
  })
})

describe('vbFederationMissing', () => {
  it('blocks a volleyball non-guest without an answer — the REG-2026-6400 case', () => {
    expect(vbFederationMissing('volleyball', false, null)).toBe(true)
  })

  it('passes a volleyball non-guest with a federation', () => {
    expect(vbFederationMissing('volleyball', false, 'CH')).toBe(false)
    expect(vbFederationMissing('volleyball', false, 'IT')).toBe(false)
  })

  it('exempts guests — never licensed, so there is no origin federation', () => {
    expect(vbFederationMissing('volleyball', true, null)).toBe(false)
  })

  it('never applies outside volleyball', () => {
    expect(vbFederationMissing('basketball', false, null)).toBe(false)
    expect(vbFederationMissing('passive', false, null)).toBe(false)
  })
})
