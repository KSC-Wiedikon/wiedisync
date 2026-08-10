// src/utils/__tests__/licenceStatus.test.ts
//
// The licence status is season-scoped, and the one thing that can go wrong is a
// green "Licenced" badge outliving the licence it describes. The nightly sweep
// resets stale stamps, but between the 1 June rollover and the sweep that
// follows it — and on any row a raw-SQL path created without a stamp — the
// column still holds last season's answer. `effectiveLicenceStatus` is the
// guard, so it is worth pinning rather than trusting.

import { describe, it, expect } from 'vitest'
import {
  LICENCE_STATUSES,
  effectiveLicenceStatus,
  isLicenceStatus,
  LICENCE_STATUS_BADGE,
} from '../licenceStatus'
import { currentSeasonShort } from '../season'

// Fixed clocks either side of the Jun 1 rollover. May 2027 is still 2026/27;
// June 2027 is 2027/28.
const IN_2026_27 = new Date('2027-05-15T12:00:00Z')
const IN_2027_28 = new Date('2027-06-15T12:00:00Z')

describe('effectiveLicenceStatus', () => {
  it('returns the stored status when the stamp is the current season', () => {
    const m = { licence_status: 'ordered', licence_status_season: '2026/27' }
    expect(effectiveLicenceStatus(m, IN_2026_27)).toEqual({ status: 'ordered', stale: false })
  })

  it('reads a confirmed licence as licenced inside its season', () => {
    const m = { licence_status: 'licenced', licence_status_season: '2026/27' }
    const r = effectiveLicenceStatus(m, IN_2026_27)
    expect(r.status).toBe('licenced')
    expect(r.stale).toBe(false)
  })

  // The whole point of the module.
  it('drops last season\'s "licenced" to none the moment the season rolls over', () => {
    const m = { licence_status: 'licenced', licence_status_season: '2026/27' }
    const r = effectiveLicenceStatus(m, IN_2027_28)
    expect(r.status).toBe('none')
    expect(r.stale).toBe(true)
  })

  it('treats a missing stamp as stale rather than as this season', () => {
    // Rows born from a raw-knex path that never set the column. `null !== '2026/27'`
    // has to fall on the safe side, which is "nobody has answered yet".
    const r = effectiveLicenceStatus({ licence_status: 'finalized', licence_status_season: null }, IN_2026_27)
    expect(r.status).toBe('none')
    expect(r.stale).toBe(true)
  })

  it('falls back to none for a value outside the closed set', () => {
    // Can't reach the DB past the CHECK constraint, but a stale bundle reading
    // a column a future migration widened must not render a blank badge.
    const r = effectiveLicenceStatus(
      { licence_status: 'Licensed', licence_status_season: currentSeasonShort() },
    )
    expect(r.status).toBe('none')
  })

  it('survives a null member (the profile card renders before auth resolves)', () => {
    expect(effectiveLicenceStatus(null).status).toBe('none')
    expect(effectiveLicenceStatus(undefined).status).toBe('none')
  })
})

describe('the closed set', () => {
  it('is the five states, in workflow order', () => {
    expect(LICENCE_STATUSES).toEqual(['none', 'to_be_ordered', 'ordered', 'finalized', 'licenced'])
  })

  it('accepts exactly those five and nothing else', () => {
    for (const s of LICENCE_STATUSES) expect(isLicenceStatus(s)).toBe(true)
    for (const s of ['', 'Ordered', 'licensed', 'pending', null, 3, undefined]) {
      expect(isLicenceStatus(s)).toBe(false)
    }
  })

  it('gives every state a badge — a missing one renders as unstyled text', () => {
    for (const s of LICENCE_STATUSES) {
      expect(LICENCE_STATUS_BADGE[s], `${s} has no badge`).toBeTruthy()
      // Both themes, or the chip vanishes into the background in one of them.
      expect(LICENCE_STATUS_BADGE[s]).toMatch(/dark:/)
    }
  })
})
