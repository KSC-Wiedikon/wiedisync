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
import { fineWindowStart } from './useFines'

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
