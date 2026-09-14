/**
 * fineWindowStart — the JS offense-counter window.
 *
 * This function is a mirror of `kscw_fine_window_start(text, timestamptz)` in
 * Postgres, and the two MUST agree: the JS side quotes the amount in the
 * issue-fine modal (computeFineAmount → useFineQuote), the SQL side is the
 * authority when the fine is written. A disagreement shows up as a member being
 * quoted one amount and charged another.
 *
 * The 'season' case is the one with teeth. The club rolls over on **Jun 1**, but
 * the season's fixture calendar starts Sep 1 — so anchoring the window on Sep 1
 * puts its start in the FUTURE for a third of the season, and every offense
 * issued over the summer sorts before its own window start and is never counted.
 * Both sides therefore anchor on the Jun 1 rollover (migration 268).
 */
import { describe, it, expect } from 'vitest'
import { computeFineAmount, fineWindowStart, pickFineRule } from './useFines'
import type { Fine, FineRule } from '../types'

/** Local-midnight Date → 'YYYY-MM-DD', matching how the window is compared. */
const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

describe('fineWindowStart', () => {
  describe("'season' — anchors on the Jun 1 rollover, never Sep 1", () => {
    it('inside the season (Sep–Dec) counts from that June', () => {
      expect(ymd(fineWindowStart('season', new Date(2026, 9, 15)))).toBe('2026-06-01')
      expect(ymd(fineWindowStart('season', new Date(2026, 8, 1)))).toBe('2026-06-01')
    })

    it('Jan–May still belongs to the season that rolled over last June', () => {
      expect(ymd(fineWindowStart('season', new Date(2027, 0, 15)))).toBe('2026-06-01')
      expect(ymd(fineWindowStart('season', new Date(2027, 4, 31)))).toBe('2026-06-01')
    })

    it('the summer gap is covered — a July offense is INSIDE its own window', () => {
      // The regression this pins: with a Sep 1 anchor the window start would be
      // 2026-09-01, i.e. after the offense, so it would never be counted.
      const july = new Date(2026, 6, 10)
      const windowStart = fineWindowStart('season', july)
      expect(ymd(windowStart)).toBe('2026-06-01')
      expect(july >= windowStart).toBe(true)
    })

    it('never returns a window start in the future', () => {
      for (const now of [
        new Date(2026, 5, 1), new Date(2026, 6, 29), new Date(2026, 7, 31),
        new Date(2026, 8, 1), new Date(2027, 0, 1), new Date(2027, 4, 31),
      ]) {
        expect(fineWindowStart('season', now) <= now).toBe(true)
      }
    })
  })

  describe('the other windows are unchanged by migration 268', () => {
    it('calendar_month is the 1st of the current month', () => {
      expect(ymd(fineWindowStart('calendar_month', new Date(2026, 6, 29)))).toBe('2026-07-01')
    })

    it('rolling windows subtract N days', () => {
      const now = new Date(2026, 6, 29)
      expect(ymd(fineWindowStart('rolling_30d', now))).toBe('2026-06-29')
      expect(ymd(fineWindowStart('rolling_90d', now))).toBe('2026-04-30')
    })

    it('never reaches back to the epoch', () => {
      expect(fineWindowStart('never', new Date(2026, 6, 29)).getTime()).toBe(0)
    })
  })
})

/**
 * Per-activity-type rules (migration 361). The JS engine must pick the same
 * rule and count the same offenses as `kscw_compute_fine_amount` — a
 * disagreement shows up as a quote of CHF 5 followed by a charge of CHF 20.
 */
const rule = (over: Partial<FineRule>): FineRule => ({
  id: '1', team: '7', category: 'late_signin', activity_type: null, enabled: true,
  reset_window: 'never', tiers: [{ offense: 1, amount: 5 }, { offense: 2, amount: 10 }, { offense_min: 3, amount: 15 }],
  currency: 'CHF', ...over,
} as FineRule)
const fine = (over: Partial<Fine>): Fine => ({
  id: '1', member: '42', team: '7', category: 'late_signin', amount: 5, currency: 'CHF', status: 'open',
  activity_type: null, activity_id: null, activity_date: null, tier_offense: 1, reset_window_at_issue: 'never',
  reason: null, issued_by: null, issued_at: '2026-09-01T10:00:00Z', auto_issued: false,
  ...over,
} as Fine)
const general = rule({ id: 'g' })
const games = rule({ id: 'o', activity_type: 'game', tiers: [{ offense: 1, amount: 20 }, { offense_min: 2, amount: 40 }] })

describe('pickFineRule — the override wins only when it is enabled', () => {
  it('no activity type → the general rule', () => {
    expect(pickFineRule([general, games], 7, 'late_signin', null)?.id).toBe('g')
  })
  it('a type with an enabled override → that override', () => {
    expect(pickFineRule([general, games], 7, 'late_signin', 'game')?.id).toBe('o')
  })
  it('a type without an override → the general rule', () => {
    expect(pickFineRule([general, games], 7, 'late_signin', 'training')?.id).toBe('g')
  })
  it('a DISABLED override is no override — falls back to the general rule', () => {
    expect(pickFineRule([general, rule({ ...games, enabled: false })], 7, 'late_signin', 'game')?.id).toBe('g')
  })
  it('an override alone still prices its type, and nothing else', () => {
    expect(pickFineRule([games], 7, 'late_signin', 'game')?.id).toBe('o')
    expect(pickFineRule([games], 7, 'late_signin', 'training')).toBeNull()
  })
})

describe('computeFineAmount — counters are per rule, not per category', () => {
  const trainingFine = fine({ id: 'a', activity_type: 'training' })
  const gameFine = fine({ id: 'b', activity_type: 'game', amount: 20 })

  it('the Games ladder ignores training history: first late game is offense #1', () => {
    const r = computeFineAmount([general, games], [trainingFine, trainingFine], 42, 7, 'late_signin', new Date(), 'game')
    expect(r).toEqual({ amount: 20, tier_offense: 1, reset_window_at_issue: 'never' })
  })
  it('the general ladder ignores fines an enabled override claims', () => {
    const r = computeFineAmount([general, games], [gameFine, trainingFine], 42, 7, 'late_signin', new Date(), 'training')
    expect(r).toEqual({ amount: 10, tier_offense: 2, reset_window_at_issue: 'never' })
  })
  it('without an override, every fine of the category counts', () => {
    const r = computeFineAmount([general], [gameFine, trainingFine], 42, 7, 'late_signin', new Date(), 'training')
    expect(r).toEqual({ amount: 15, tier_offense: 3, reset_window_at_issue: 'never' })
  })
  it('a fine with no activity always counts for the general rule', () => {
    const r = computeFineAmount([general, games], [fine({ id: 'c' })], 42, 7, 'late_signin', new Date(), 'event')
    expect(r?.tier_offense).toBe(2)
  })
  it('the override uses its own reset window', () => {
    const monthly = rule({ ...games, reset_window: 'calendar_month' })
    const old = fine({ id: 'd', activity_type: 'game', issued_at: '2020-01-01T00:00:00Z' })
    const r = computeFineAmount([general, monthly], [old], 42, 7, 'late_signin', new Date(), 'game')
    expect(r).toEqual({ amount: 20, tier_offense: 1, reset_window_at_issue: 'calendar_month' })
  })
})
