/**
 * Unit tests for `slotLiveOn` — the per-date validity gate on hall_slots used by
 * the Terminplanung slot generator (game-scheduling.js).
 *
 * Why this exists. The generator used to read every hall_slot ever assigned to a
 * team with no validity filter at all, so a block that had already expired kept
 * minting scheduling slots forever. D4's whole 2026/27 Thursday inventory (30
 * rows) was generated in KWI C — last season's hall, expired 27.06.2026 — while
 * their real slot had moved to KWI A, and that stale hall was pushed to
 * VolleyManager on every D4 home fixture. Surfaced 10.09.2026.
 *
 * What is pinned here:
 *   · the season-rollover case that caused the incident (expired block + its
 *     successor, both live in the pool, disambiguated only by date);
 *   · `indefinite` overriding a nominal `valid_until` — the shape every current
 *     KSCW slot actually has, so getting this backwards would blank the whole
 *     inventory rather than dirty it;
 *   · the boundary days, which is where an off-by-one would hide.
 */
import { describe, it, expect } from 'vitest'
import { slotLiveOn } from '../game-scheduling.js'

// The two real D4 Thursday blocks that collided in the incident.
const D4_LAST_SEASON = { valid_from: '2025-09-01', valid_until: '2026-06-27', indefinite: false } // KWI C
const D4_THIS_SEASON = { valid_from: '2026-08-17', valid_until: '2027-08-17', indefinite: true }  // KWI A

describe('slotLiveOn', () => {
  it('excludes an expired block on a date after it ended', () => {
    expect(slotLiveOn(D4_LAST_SEASON, '2026-10-22')).toBe(false)
  })

  it('includes the successor block on that same date', () => {
    expect(slotLiveOn(D4_THIS_SEASON, '2026-10-22')).toBe(true)
  })

  it('picks exactly one of the two on every Thursday of the season', () => {
    // The incident in miniature: both blocks come back from the pool query, and
    // only the date can tell them apart. Never both, never neither.
    for (const date of ['2026-09-03', '2026-10-22', '2026-12-10', '2027-03-25']) {
      const live = [D4_LAST_SEASON, D4_THIS_SEASON].filter((hs) => slotLiveOn(hs, date))
      expect(live).toHaveLength(1)
      expect(live[0]).toBe(D4_THIS_SEASON)
    }
  })

  it('honours indefinite over a nominal valid_until', () => {
    // Every current KSCW slot carries an end date it is not meant to respect.
    expect(slotLiveOn(D4_THIS_SEASON, '2028-01-01')).toBe(true)
  })

  it('still respects valid_from on an indefinite block', () => {
    expect(slotLiveOn(D4_THIS_SEASON, '2026-08-16')).toBe(false)
    expect(slotLiveOn(D4_THIS_SEASON, '2026-08-17')).toBe(true)
  })

  it('treats both boundary days as inclusive', () => {
    expect(slotLiveOn(D4_LAST_SEASON, '2025-09-01')).toBe(true)
    expect(slotLiveOn(D4_LAST_SEASON, '2025-08-31')).toBe(false)
    expect(slotLiveOn(D4_LAST_SEASON, '2026-06-27')).toBe(true)
    expect(slotLiveOn(D4_LAST_SEASON, '2026-06-28')).toBe(false)
  })

  it('treats a missing valid_until as open-ended', () => {
    expect(slotLiveOn({ valid_from: '2026-08-17', valid_until: null, indefinite: false }, '2030-01-01')).toBe(true)
  })

  it('treats a missing valid_from as unbounded in the past', () => {
    expect(slotLiveOn({ valid_from: null, valid_until: '2026-06-27', indefinite: false }, '2020-01-01')).toBe(true)
  })
})
