import { describe, it, expect } from 'vitest'
import { monthGridRange } from './monthRange'
import { startOfMonth, endOfMonth } from '../../utils/dateUtils'

const DAY_MS = 24 * 60 * 60 * 1000

// `endOfWeek` returns 23:59:59.999, so the raw difference is one millisecond short
// of a whole number of days — hence the +1 before dividing.
const spanInDays = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime() + 1) / DAY_MS)

describe('monthGridRange', () => {
  it('covers the whole visible grid, not just the month', () => {
    // September 2026 starts on a Tuesday and ends on a Wednesday, so the grid has
    // both a leading and a trailing stub week.
    const { rangeStart, rangeEnd } = monthGridRange(new Date(2026, 8, 1))
    expect(rangeStart.getDay()).toBe(1) // Monday — dateUtils pins weekStartsOn: 1
    expect(rangeEnd.getDay()).toBe(0) // Sunday
    expect(rangeStart.getTime()).toBeLessThanOrEqual(startOfMonth(new Date(2026, 8, 1)).getTime())
    expect(rangeEnd.getTime()).toBeGreaterThanOrEqual(endOfMonth(new Date(2026, 8, 1)).getTime())
    expect(spanInDays(rangeStart, rangeEnd)).toBe(35)
  })

  it('adds no stub week when the month already starts Monday and ends Sunday', () => {
    // February 2027 is exactly four weeks: 01.02 is a Monday, 28.02 a Sunday. The
    // edge that catches an implementation which always pads to 35 or 42 days.
    const { rangeStart, rangeEnd } = monthGridRange(new Date(2027, 1, 1))
    expect(rangeStart.getTime()).toBe(startOfMonth(new Date(2027, 1, 1)).getTime())
    expect(spanInDays(rangeStart, rangeEnd)).toBe(28)
  })

  it('always spans whole weeks', () => {
    // Every month of the 2026/27 season, so a grid can never be short a row.
    for (let i = 0; i < 12; i++) {
      const { rangeStart, rangeEnd } = monthGridRange(new Date(2026, 7 + i, 1))
      expect(spanInDays(rangeStart, rangeEnd) % 7).toBe(0)
      expect([28, 35, 42]).toContain(spanInDays(rangeStart, rangeEnd))
    }
  })
})
