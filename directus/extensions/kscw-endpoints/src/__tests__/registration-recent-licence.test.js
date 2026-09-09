/**
 * Unit tests for the basketball recent-licence gate (registration.js) — the
 * server-side twin of the client form gate (kscw-website registration-form.js,
 * migration 232). Exists for the reason its volleyball sibling does: REG-2026-6400
 * arrived with federation_of_origin NULL the day AFTER that client gate shipped,
 * because the submitter's browser ran a stale cached bundle. Client-side
 * validation can never rule that out.
 *
 * The failure this prevents is not a hole — an unanswered question keeps the
 * Freibrief REQUIRED, so nothing sneaks through. It is that the applicant is
 * then turned away for a release letter they do not owe, over a question they
 * were never shown.
 *
 * Hermetic — pure functions, no DB or network.
 */
import { describe, it, expect } from 'vitest'
import { bbRecentLicenceMissing } from '../registration.js'

const ADULT = '1999-03-02'

describe('bbRecentLicenceMissing', () => {
  it('demands the answer from a Swiss-club transfer that omits it', () => {
    expect(bbRecentLicenceMissing('basketball', false, 'transfer_ch', ADULT, null)).toBe(true)
    expect(bbRecentLicenceMissing('basketball', false, 'transfer_ch', ADULT, '')).toBe(true)
    // Junk is not an answer — migration 232 CHECKs the same two values, so this
    // must be a 400 and not a constraint error out of the database.
    expect(bbRecentLicenceMissing('basketball', false, 'transfer_ch', ADULT, 'maybe')).toBe(true)
  })

  it('accepts either real answer, case-insensitively', () => {
    expect(bbRecentLicenceMissing('basketball', false, 'transfer_ch', ADULT, 'ja')).toBe(false)
    expect(bbRecentLicenceMissing('basketball', false, 'transfer_ch', ADULT, 'nein')).toBe(false)
    expect(bbRecentLicenceMissing('basketball', false, 'transfer_ch', ADULT, 'NEIN')).toBe(false)
  })

  it('never asks outside a Swiss-club transfer', () => {
    for (const s of ['neu', 'transfer_intl', 'rueckkehr', null]) {
      expect(bbRecentLicenceMissing('basketball', false, s, ADULT, null)).toBe(false)
    }
  })

  it('never asks a volleyball or passive registration, or a guest', () => {
    expect(bbRecentLicenceMissing('volleyball', false, 'transfer_ch', ADULT, null)).toBe(false)
    expect(bbRecentLicenceMissing('passive', false, 'transfer_ch', ADULT, null)).toBe(false)
    expect(bbRecentLicenceMissing('basketball', true, 'transfer_ch', ADULT, null)).toBe(false)
  })

  it('exempts U12, where the waiver applies on age alone', () => {
    // Age is measured at Sept 1 of the current season, the same reference
    // bbFreibriefWaived uses — a child who is 11 there is exempt whether or not
    // the form ever showed them the question.
    const now = new Date()
    const seasonStartYear = (now.getUTCMonth() + 1) >= 7 ? now.getUTCFullYear() : now.getUTCFullYear() - 1
    const elevenYearOld = `${seasonStartYear - 11}-01-15`
    const twelveYearOld = `${seasonStartYear - 12}-01-15`
    expect(bbRecentLicenceMissing('basketball', false, 'transfer_ch', elevenYearOld, null)).toBe(false)
    expect(bbRecentLicenceMissing('basketball', false, 'transfer_ch', twelveYearOld, null)).toBe(true)
  })

  it('still demands the answer when the date of birth is unusable', () => {
    // No DOB means the U12 exemption cannot be established, and an unprovable
    // exemption must not be granted — the same direction bbFreibriefWaived errs in.
    expect(bbRecentLicenceMissing('basketball', false, 'transfer_ch', null, null)).toBe(true)
    expect(bbRecentLicenceMissing('basketball', false, 'transfer_ch', 'not-a-date', null)).toBe(true)
  })
})
